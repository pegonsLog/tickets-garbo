import { Injectable } from '@angular/core';
import { AI, GenerativeModel, GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import {
  comDiagnosticoAppCheck, ehErroAppCheck, ehErroModoTemplate, explicarErroAppCheck, explicarErroModoTemplate,
  obterFirebaseApp
} from './firebase-init';
import { MODELO_PADRAO } from './ai-analysis.service';
import { FirestoreTrackingService } from './firestore-tracking.service';
import {
  ItemPdf,
  META_ATINGIDA,
  META_PARCIAL,
  PeriodoAuditoria,
  ResultadoAuditoria,
  ResultadoComparacao,
  chaveNumero,
  descreverPeriodo
} from '../tracking/audit.model';
import { indexarPorChave, montarResultado } from '../tracking/audit-crossing';
import { compararStatus } from '../tracking/status-comparison';

/**
 * Tamanho máximo do PDF.
 * O arquivo vai em linha na requisição, codificado em base64 (+33%), e a requisição
 * inteira tem limite de 20 MB — por isso o teto fica em 12 MB, com folga.
 */
export const TAMANHO_MAX_PDF = 12 * 1024 * 1024;

/**
 * Esquema da extração: número de cada ticket e, se o documento trouxer, o status.
 * Uma única leitura do PDF alimenta as duas análises (auditoria e comparação de status).
 */
const ESQUEMA_EXTRACAO = Schema.object({
  properties: {
    tickets: Schema.array({
      items: Schema.object({
        properties: {
          numero: Schema.string({ description: 'Número do ticket exatamente como aparece no documento' }),
          status: Schema.string({
            description: 'Status do ticket como aparece no documento (ex.: ABERTA, ENCERRADA). '
              + 'Vazio se o documento não informar status para este ticket.'
          })
        },
        optionalProperties: ['status']
      })
    })
  }
});

const INSTRUCAO_EXTRACAO = [
  'Você recebe um documento PDF com uma relação de tickets (solicitações) que foram encaminhados para atendimento.',
  'Extraia, para cada ticket presente no documento, o número identificador e o status.',
  '',
  'Regras:',
  '- Transcreva cada número exatamente como aparece, preservando pontos, barras e hifens.',
  '- Transcreva o status exatamente como está no documento, sem traduzir nem interpretar.',
  '- Se o documento não tiver coluna ou indicação de status para um ticket, deixe o status vazio.',
  '  Nunca deduza o status a partir de datas, cores ou outros campos.',
  '- Não repita tickets. Não invente tickets que não estejam no documento.',
  '- Ignore cabeçalhos, rodapés, totalizadores, números de página e datas.',
  '- Se o documento não tiver nenhum número de ticket, devolva a lista vazia.'
].join('\n');

const INSTRUCAO_PARECER_STATUS = [
  'Você é analista de atendimento ao cidadão.',
  'Recebe a comparação entre o status dos tickets em um relatório emitido anteriormente (o arquivo)',
  'e o status atual desses mesmos tickets no sistema (a lista).',
  'Com base apenas nos números apresentados, escreva um parecer curto (3 a 5 frases) em português do Brasil.',
  '',
  'Explique quanto o cenário mudou desde a emissão do arquivo, quais mudanças de status predominam e o que',
  'isso indica sobre o andamento dos atendimentos (por exemplo, tickets que passaram a encerrados indicam',
  'resolução). Se muitos tickets não puderam ser comparados, mencione isso como limitação da análise.',
  'Não invente dados. Responda em texto corrido, sem títulos, listas ou marcação.'
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

  /**
   * Executa a auditoria: lê o PDF uma única vez e produz duas análises separadas:
   *   1. auditoria do acompanhamento (atividades registradas em cada ticket);
   *   2. comparação entre o status no arquivo e o status atual da lista.
   *
   * @param lista linhas da planilha carregada na tela, usadas na comparação de status
   */
  async auditar(
    arquivo: File,
    periodo: PeriodoAuditoria = {},
    modelo: string = MODELO_PADRAO,
    aoProgredir: (etapa: string) => void = () => {},
    lista: Record<string, string>[] = []
  ): Promise<ResultadoAuditoria> {
    validarArquivo(arquivo);
    if (periodo.inicio && periodo.fim && periodo.inicio > periodo.fim) {
      throw new Error('A data inicial do período é posterior à data final.');
    }

    aoProgredir('Lendo o PDF com a IA...');
    const itensPdf = await this.extrairTickets(arquivo, modelo);
    const numeros = itensPdf.map(i => i.numero);
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

    aoProgredir('Comparando o status do arquivo com a lista atual...');
    const comparacao = compararStatus(itensPdf, lista, acompanhados);
    resultado.comparacao = comparacao;

    aoProgredir('Redigindo os pareceres...');
    // Os dois pareceres são independentes e complementares: falha em um não afeta o outro
    const [parecer, parecerStatus] = await Promise.allSettled([
      this.gerarParecer(resultado, modelo),
      podeOpinarSobreStatus(comparacao) ? this.gerarParecerStatus(comparacao, modelo) : Promise.resolve('')
    ]);
    if (parecer.status === 'fulfilled') {
      resultado.parecer = parecer.value;
    } else {
      console.error('[Auditoria] Falha ao gerar o parecer da IA', parecer.reason);
    }
    if (parecerStatus.status === 'fulfilled') {
      comparacao.parecer = parecerStatus.value || undefined;
    } else {
      console.error('[Auditoria] Falha ao gerar o parecer da comparação de status', parecerStatus.reason);
    }

    return resultado;
  }

  // ===== IA =====

  private obterAi(): AI {
    if (!this.ai) {
      // Tokens de uso único: aceitos com a proteção contra repetição do App Check ligada ou não
      this.ai = getAI(obterFirebaseApp(), { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
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
          // Cada ticket agora traz número e status: mais espaço para relações longas
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA_EXTRACAO
        }
      });
      this.extratores.set(modelo, m);
    }
    return m;
  }

  /** Modelo de texto livre, com cache por (modelo, instrução). */
  private parecerista(modelo: string, instrucao: string = INSTRUCAO_PARECER): GenerativeModel {
    const chave = `${modelo}|${instrucao === INSTRUCAO_PARECER ? 'auditoria' : 'status'}`;
    let m = this.pareceristas.get(chave);
    if (!m) {
      m = getGenerativeModel(this.obterAi(), {
        model: modelo,
        systemInstruction: instrucao,
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
      });
      this.pareceristas.set(chave, m);
    }
    return m;
  }

  /** Envia o PDF ao modelo e devolve os tickets (número + status) encontrados, sem repetição. */
  private async extrairTickets(arquivo: File, modelo: string): Promise<ItemPdf[]> {
    const base64 = await paraBase64(arquivo);

    let resposta;
    try {
      resposta = await this.extrator(modelo).generateContent([
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        { text: 'Extraia os números dos tickets listados neste documento.' }
      ]);
    } catch (erro: any) {
      console.error('[Auditoria] Falha ao ler o PDF', erro);
      throw new Error(await comDiagnosticoAppCheck(erro, traduzirErroIa(erro, modelo)));
    }

    if (resposta.response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      throw new Error('O PDF tem tickets demais para uma única leitura. Divida a relação em arquivos menores.');
    }

    const texto = resposta.response.text();
    if (!texto?.trim()) {
      throw new Error('A IA não retornou conteúdo ao ler o PDF. Tente novamente.');
    }

    let bruto: { tickets?: unknown };
    try {
      bruto = JSON.parse(texto);
    } catch {
      throw new Error('A leitura do PDF retornou um formato inesperado. Tente novamente.');
    }

    return deduplicarTickets(Array.isArray(bruto.tickets) ? bruto.tickets : []);
  }

  /** Parecer textual da comparação de status, a partir dos números já calculados. */
  private async gerarParecerStatus(c: ResultadoComparacao, modelo: string): Promise<string> {
    const linhas = [
      `Tickets no arquivo: ${c.total}`,
      `Mesmo status hoje: ${c.iguais}`,
      `Status alterado desde o arquivo: ${c.alterados} (${c.percentualAlterado}% dos comparáveis)`,
      `Sem status no arquivo (não comparáveis): ${c.semStatusPdf}`,
      `Não encontrados na lista atual: ${c.foraDaLista}`,
      'Mudanças de status mais frequentes:',
      ...(c.transicoes.length
        ? c.transicoes.slice(0, 10).map(t => `- ${t.de} → ${t.para}: ${t.quantidade}`)
        : ['- nenhuma'])
    ];

    const resposta = await this.parecerista(modelo, INSTRUCAO_PARECER_STATUS).generateContent(
      `Avalie a comparação de status com base nestes números:\n\n${linhas.join('\n')}`
    );
    return (resposta.response.text() ?? '').trim();
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
 * Se o mesmo ticket aparecer duas vezes, mantém o primeiro status não vazio.
 */
export function deduplicarTickets(lista: unknown[]): ItemPdf[] {
  const porChave = new Map<string, ItemPdf>();
  lista.forEach(item => {
    const bruto = (item ?? {}) as { numero?: unknown; status?: unknown };
    const numero = String(bruto.numero ?? '').trim();
    const status = String(bruto.status ?? '').replace(/\s+/g, ' ').trim();
    const chave = chaveNumero(numero);
    if (!numero || chave.length < 6) return;

    const existente = porChave.get(chave);
    if (!existente) {
      porChave.set(chave, status ? { numero, status } : { numero });
    } else if (!existente.status && status) {
      existente.status = status;
    }
  });
  return Array.from(porChave.values());
}

/** Só vale pedir parecer à IA quando houve ao menos um ticket comparável. */
function podeOpinarSobreStatus(c: ResultadoComparacao): boolean {
  return !c.listaIndisponivel && !c.arquivoSemStatus && c.iguais + c.alterados > 0;
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
  if (ehErroModoTemplate(detalhe)) {
    return explicarErroModoTemplate();
  }
  if (ehErroAppCheck(detalhe)) {
    return explicarErroAppCheck(detalhe);
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
