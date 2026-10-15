import { Injectable } from '@angular/core';
import { AI, GenerativeModel, GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { obterFirebaseApp } from './firebase-init';
import { MODELO_PADRAO } from './ai-analysis.service';
import { FirestoreTrackingService } from './firestore-tracking.service';
import {
  META_ATINGIDA,
  META_PARCIAL,
  PeriodoAuditoria,
  ResultadoAuditoria,
  chaveNumero,
  descreverPeriodo
} from '../tracking/audit.model';
import { indexarPorChave, montarResultado } from '../tracking/audit-crossing';

/**
 * Tamanho máximo do PDF.
 * O arquivo vai em linha na requisição, codificado em base64 (+33%), e a requisição
 * inteira tem limite de 20 MB — por isso o teto fica em 12 MB, com folga.
 */
export const TAMANHO_MAX_PDF = 12 * 1024 * 1024;

/** Esquema da extração: apenas a lista de números encontrados no PDF. */
const ESQUEMA_EXTRACAO = Schema.object({
  properties: {
    numeros: Schema.array({
      items: Schema.string({ description: 'Número do ticket exatamente como aparece no documento' })
    })
  }
});

const INSTRUCAO_EXTRACAO = [
  'Você recebe um documento PDF com uma relação de tickets (solicitações) que foram encaminhados para atendimento.',
  'Extraia APENAS os números identificadores dos tickets presentes no documento.',
  '',
  'Regras:',
  '- Transcreva cada número exatamente como aparece, preservando pontos, barras e hifens.',
  '- Não repita números. Não invente números que não estejam no documento.',
  '- Ignore cabeçalhos, rodapés, totalizadores, números de página e datas.',
  '- Se o documento não tiver nenhum número de ticket, devolva a lista vazia.'
].join('\n');

const INSTRUCAO_PARECER = [
  'Você é analista de desempenho de atendimento ao cidadão.',
  'Com base apenas nos números apresentados, escreva um parecer curto (3 a 6 frases) em português do Brasil',
  'avaliando se a produção de respostas aos tickets está atingindo os objetivos.',
  '',
  'Oriente-se por estas faixas, considerando o percentual de tickets com alguma atividade registrada:',
  `- ${META_ATINGIDA}% ou mais: meta atingida;`,
  `- ${META_PARCIAL}% a ${META_ATINGIDA - 1}%: parcialmente atingida, com pontos de atenção;`,
  `- abaixo de ${META_PARCIAL}%: meta não atingida.`,
  '',
  'Comente a proporção de atividades concluídas em relação às que seguem em andamento e, se houver tickets',
  'sem nenhum registro, aponte isso como risco. Se a produção estiver concentrada em poucas pessoas,',
  'mencione isso de forma neutra, sem julgar indivíduos. Seja objetivo e não invente dados.',
  'Responda em texto corrido, sem títulos, listas ou marcação.'
].join('\n');

/**
 * Auditoria de acompanhamento a partir de um PDF.
 *
 * A divisão de responsabilidades é intencional:
 *   1. a IA apenas LÊ o PDF e extrai os números dos tickets (tarefa de leitura);
 *   2. o cruzamento com as atividades registradas é feito em código
 *      (montarResultado), de forma determinística;
 *   3. a IA volta a ser usada só para redigir o parecer, recebendo os números prontos.
 */
@Injectable({ providedIn: 'root' })
export class AiAuditService {
  private ai?: AI;
  private extratores = new Map<string, GenerativeModel>();
  private pareceristas = new Map<string, GenerativeModel>();

  constructor(private tracking: FirestoreTrackingService) {}

  /** Executa a auditoria: lê o PDF, cruza com o acompanhamento e monta o resultado. */
  async auditar(
    arquivo: File,
    periodo: PeriodoAuditoria = {},
    modelo: string = MODELO_PADRAO,
    aoProgredir: (etapa: string) => void = () => {}
  ): Promise<ResultadoAuditoria> {
    validarArquivo(arquivo);
    if (periodo.inicio && periodo.fim && periodo.inicio > periodo.fim) {
      throw new Error('A data inicial do período é posterior à data final.');
    }

    aoProgredir('Lendo o PDF com a IA...');
    const numeros = await this.extrairNumeros(arquivo, modelo);
    if (numeros.length === 0) {
      throw new Error('Nenhum número de ticket foi encontrado no PDF. Verifique se o arquivo contém a relação de tickets.');
    }

    aoProgredir(`Cruzando ${numeros.length} ticket(s) com o acompanhamento...`);
    let acompanhados;
    try {
      acompanhados = await this.tracking.listar();
    } catch (erro: any) {
      throw new Error(`Não foi possível ler o acompanhamento no Firestore: ${erro?.message ?? erro}`);
    }

    // Só os tickets do PDF que estão em acompanhamento precisam ter as atividades lidas
    const porChave = indexarPorChave(acompanhados);
    const numerosAcompanhados = numeros
      .map(n => porChave.get(chaveNumero(n))?.numero)
      .filter((n): n is string => !!n);
    const atividades = await this.tracking.listarAtividadesDe(numerosAcompanhados);

    const resultado = montarResultado(numeros, acompanhados, atividades, periodo, arquivo.name, modelo);

    aoProgredir('Redigindo o parecer...');
    try {
      resultado.parecer = await this.gerarParecer(resultado, modelo);
    } catch (erro) {
      // O parecer é complementar: sem ele o relatório continua válido
      console.error('[Auditoria] Falha ao gerar o parecer da IA', erro);
    }

    return resultado;
  }

  // ===== IA =====

  private obterAi(): AI {
    if (!this.ai) {
      this.ai = getAI(obterFirebaseApp(), { backend: new GoogleAIBackend() });
    }
    return this.ai;
  }

  private extrator(modelo: string): GenerativeModel {
    let m = this.extratores.get(modelo);
    if (!m) {
      m = getGenerativeModel(this.obterAi(), {
        model: modelo,
        systemInstruction: INSTRUCAO_EXTRACAO,
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA_EXTRACAO
        }
      });
      this.extratores.set(modelo, m);
    }
    return m;
  }

  private parecerista(modelo: string): GenerativeModel {
    let m = this.pareceristas.get(modelo);
    if (!m) {
      m = getGenerativeModel(this.obterAi(), {
        model: modelo,
        systemInstruction: INSTRUCAO_PARECER,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
      });
      this.pareceristas.set(modelo, m);
    }
    return m;
  }

  /** Envia o PDF ao modelo e devolve os números de ticket encontrados, sem repetição. */
  private async extrairNumeros(arquivo: File, modelo: string): Promise<string[]> {
    const base64 = await paraBase64(arquivo);

    let resposta;
    try {
      resposta = await this.extrator(modelo).generateContent([
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        { text: 'Extraia os números dos tickets listados neste documento.' }
      ]);
    } catch (erro: any) {
      console.error('[Auditoria] Falha ao ler o PDF', erro);
      throw new Error(traduzirErroIa(erro, modelo));
    }

    if (resposta.response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      throw new Error('O PDF tem tickets demais para uma única leitura. Divida a relação em arquivos menores.');
    }

    const texto = resposta.response.text();
    if (!texto?.trim()) {
      throw new Error('A IA não retornou conteúdo ao ler o PDF. Tente novamente.');
    }

    let bruto: { numeros?: unknown };
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error('A leitura do PDF retornou um formato inesperado. Tente novamente.');
    }

    return deduplicarNumeros(Array.isArray(bruto.numeros) ? bruto.numeros : []);
  }

  /** Pede à IA um parecer textual sobre os quantitativos já calculados. */
  private async gerarParecer(r: ResultadoAuditoria, modelo: string): Promise<string> {
    const linhas = [
      `Período avaliado: ${descreverPeriodo(r.periodo)}`,
      `Tickets na relação: ${r.totalNoPdf}`,
      `Com alguma atividade registrada: ${r.comAtividade} (${r.percentualComAtividade}%)`,
      `Sem nenhuma atividade: ${r.semAtividade}`,
      `Com atividade concluída: ${r.concluidos} (${r.percentualConcluidos}%)`,
      `Apenas em andamento: ${r.comAtividade - r.concluidos}`,
      `Não levados para acompanhamento: ${r.naoAcompanhados}`,
      `Pessoas que registraram atividades: ${r.porUsuario.length}`,
      ...r.porUsuario.slice(0, 10).map(u =>
        `- ${u.usuario}: ${u.atividades} atividade(s), ${u.concluidas} concluída(s), em ${u.tickets} ticket(s)`)
    ];

    const resposta = await this.parecerista(modelo).generateContent(
      `Avalie o desempenho do atendimento com base nestes números:\n\n${linhas.join('\n')}`
    );
    return (resposta.response.text() ?? '').trim();
  }
}

/**
 * Remove repetições (comparando só os dígitos) e descarta ruído: exige ao menos
 * 6 dígitos, para não confundir número de página ou ano solto com ticket.
 */
export function deduplicarNumeros(lista: unknown[]): string[] {
  const vistos = new Set<string>();
  const numeros: string[] = [];
  lista.forEach(item => {
    const numero = String(item ?? '').trim();
    const chave = chaveNumero(numero);
    if (!numero || chave.length < 6 || vistos.has(chave)) return;
    vistos.add(chave);
    numeros.push(numero);
  });
  return numeros;
}

function validarArquivo(arquivo: File): void {
  const ehPdf = arquivo.type === 'application/pdf' || /\.pdf$/i.test(arquivo.name);
  if (!ehPdf) {
    throw new Error('Selecione um arquivo PDF.');
  }
  if (arquivo.size > TAMANHO_MAX_PDF) {
    const mb = (arquivo.size / 1024 / 1024).toFixed(1);
    throw new Error(`O PDF tem ${mb} MB e excede o limite de 12 MB. Divida o arquivo e tente novamente.`);
  }
}

function traduzirErroIa(erro: any, modelo: string): string {
  const status = erro?.customErrorData?.status;
  const detalhe = String(erro?.message ?? erro);
  if (/app check/i.test(detalhe)) {
    return 'O token do App Check foi recusado. Confira a configuração do App Check (a mesma da análise de similaridade).';
  }
  if (status === 429) return 'A cota gratuita da IA foi atingida. Aguarde alguns instantes e tente novamente.';
  if (status === 404) return `O modelo "${modelo}" não está disponível. Selecione outro modelo.`;
  if (status === 400) {
    return `A IA não conseguiu processar este PDF (HTTP 400). Verifique se o arquivo não está protegido por senha. (${detalhe})`;
  }
  return `Não foi possível ler o PDF: ${detalhe}`;
}

/** Converte o arquivo para base64 puro (sem o prefixo data:). */
function paraBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const resultado = String(leitor.result ?? '');
      const virgula = resultado.indexOf(',');
      resolve(virgula >= 0 ? resultado.slice(virgula + 1) : resultado);
    };
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    leitor.readAsDataURL(arquivo);
  });
}
