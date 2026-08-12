import { Injectable } from '@angular/core';
import { AI, GenerativeModel, GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai';
import { RelatorioIa } from '../ai-report/ai-report.model';
import { appCheckAtivo, obterFirebaseApp } from './firebase-init';

/** Resultado da análise, já com o consumo de tokens informado pelo modelo. */
export interface ResultadoAnalise {
  relatorio: RelatorioIa;
  modelo: string;
  tokensEntrada?: number;
  tokensSaida?: number;
}

/**
 * Modelos oferecidos na interface.
 *
 * Todos são das famílias Gemini 3.x Flash / Flash-Lite, que NÃO exigem o plano Blaze
 * quando usadas com o Gemini Developer API — ou seja, funcionam no nível sem custo.
 * Modelos Pro ficam de fora de propósito: exigem plano pago.
 *
 * Manutenção: o Google restringe modelos antigos a quem já os usava (as famílias 2.5
 * deixaram de aceitar novos projetos, retornando HTTP 404). Datas de encerramento
 * informadas pela documentação em agosto de 2026:
 *   - gemini-3.5-flash ....... estável, encerramento não antes de 19/05/2027
 *   - gemini-3.5-flash-lite .. estável, encerramento não antes de 21/07/2027
 *   - gemini-3.6-flash ....... mais recente, porém de disponibilidade curta
 * Lista oficial: https://firebase.google.com/docs/ai-logic/models
 * Aliases "-latest" são evitados: a documentação não os recomenda, pois trocam de
 * versão sem aviso.
 */
export const MODELOS_DISPONIVEIS = [
  { id: 'gemini-3.5-flash', rotulo: 'Gemini 3.5 Flash (equilibrado)' },
  { id: 'gemini-3.5-flash-lite', rotulo: 'Gemini 3.5 Flash-Lite (mais rápido)' },
  { id: 'gemini-3.6-flash', rotulo: 'Gemini 3.6 Flash (mais recente)' }
];

export const MODELO_PADRAO = 'gemini-3.5-flash';

/**
 * Instrução de sistema: define o papel do modelo e as regras de agrupamento.
 * O formato da resposta é garantido pelo responseSchema, por isso aqui tratamos
 * apenas do critério de análise.
 */
const INSTRUCAO_SISTEMA = [
  'Você é analista de atendimento a solicitações de cidadãos de uma prefeitura.',
  'Você recebe uma lista de tickets registrados por pessoas diferentes. Como cada pessoa descreve o problema com',
  'as próprias palavras, vários tickets podem se referir ao MESMO problema no MESMO local.',
  '',
  'Sua tarefa é agrupar os tickets que poderiam ser atendidos por UMA ÚNICA resposta, porque tratam do mesmo',
  'problema no mesmo local — ou em locais tão próximos que uma única providência atenderia todos eles.',
  '',
  'Regras:',
  '- Compare rua, número, bairro, regional, assunto, classe e o texto da descrição.',
  '- Ignore diferenças de redação, erros de digitação, abreviações (R., Av., Jd.), maiúsculas/minúsculas e acentuação.',
  '- Só agrupe tickets quando houver evidência real de que é o mesmo problema. Na dúvida, marque confiança baixa',
  '  e explique o motivo, ou deixe o ticket fora de qualquer grupo.',
  '- Um grupo precisa ter no mínimo 2 tickets. Tickets sem par simplesmente não entram em nenhum grupo',
  '  e NÃO devem ser listados na resposta — o relatório apenas informa quantos foram.',
  '- Os agrupamentos por local que aparecem nos dados são apenas uma sugestão automática por semelhança de',
  '  endereço: confirme, corrija ou descarte cada um com base no conteúdo das descrições.',
  '- Em "resposta_padrao", escreva um texto pronto para ser enviado aos solicitantes do grupo, em português',
  '  formal, impessoal e cordial, cobrindo o pedido de todos os tickets do grupo.',
  '- Em "panorama", resuma em 2 a 4 frases o que foi encontrado e onde estão as maiores concentrações.',
  '- Use apenas informações presentes nos registros. Nunca invente números de ticket, endereços ou datas.',
  '- Responda inteiramente em português do Brasil.'
].join('\n');

/** Esquema da resposta. Obriga o modelo a devolver JSON no formato de RelatorioIa. */
const ESQUEMA_RELATORIO = Schema.object({
  properties: {
    resumo: Schema.object({
      properties: {
        total_registros: Schema.integer({ description: 'Quantidade de tickets analisados' }),
        total_grupos: Schema.integer({ description: 'Quantidade de grupos formados' }),
        respostas_economizadas: Schema.integer({
          description: 'Soma de (tickets do grupo - 1) em todos os grupos'
        }),
        panorama: Schema.string({ description: 'Resumo de 2 a 4 frases sobre o que foi encontrado' })
      }
    }),
    grupos: Schema.array({
      items: Schema.object({
        properties: {
          titulo: Schema.string({ description: 'Título curto do grupo, ex.: "Buraco na Rua das Flores"' }),
          local: Schema.string({ description: 'Local consolidado: rua, número(s), bairro' }),
          problema_comum: Schema.string({ description: 'O problema em comum, em uma frase' }),
          confianca: Schema.enumString({ enum: ['alta', 'media', 'baixa'] }),
          justificativa: Schema.string({ description: 'Por que a confiança é essa' }),
          tickets: Schema.array({
            items: Schema.object({
              properties: {
                numero: Schema.string(),
                solicitante: Schema.string(),
                data_entrada: Schema.string(),
                trecho: Schema.string({ description: 'Resumo curto do que essa pessoa pediu' })
              },
              optionalProperties: ['solicitante', 'data_entrada', 'trecho']
            })
          }),
          resposta_padrao: Schema.string({ description: 'Resposta única que atende todos os tickets do grupo' })
        },
        optionalProperties: ['justificativa']
      })
    })
  }
});

/**
 * Executa a análise de similaridade dos tickets usando o Firebase AI Logic.
 *
 * Usa o backend Gemini Developer API (GoogleAIBackend), que é o provedor com
 * nível de uso sem custo — diferente do backend Vertex AI, que exige o plano Blaze.
 *
 * A resposta vem como JSON estruturado (responseSchema), e não como HTML: o layout
 * do relatório é montado pela própria aplicação, garantindo formatação consistente
 * e confiável na conversão para PDF.
 */
@Injectable({ providedIn: 'root' })
export class AiAnalysisService {
  private ai?: AI;
  private modelos = new Map<string, GenerativeModel>();

  private obterModelo(nomeModelo: string): GenerativeModel {
    const existente = this.modelos.get(nomeModelo);
    if (existente) return existente;

    if (!this.ai) {
      // GoogleAIBackend = Gemini Developer API (possui nível sem custo)
      this.ai = getAI(obterFirebaseApp(), { backend: new GoogleAIBackend() });
    }

    const modelo = getGenerativeModel(this.ai, {
      model: nomeModelo,
      systemInstruction: INSTRUCAO_SISTEMA,
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA_RELATORIO
      }
    });

    this.modelos.set(nomeModelo, modelo);
    return modelo;
  }

  /**
   * Envia os registros para análise e devolve o relatório estruturado.
   * @param dados Texto com os registros filtrados (sem instrução; ela vai no systemInstruction).
   */
  async analisar(dados: string, nomeModelo: string = MODELO_PADRAO): Promise<ResultadoAnalise> {
    if (!dados.trim()) {
      throw new Error('Não há registros para analisar.');
    }

    const modelo = this.obterModelo(nomeModelo);

    let resposta;
    try {
      resposta = await modelo.generateContent(
        `Analise os tickets abaixo e devolva o relatório de agrupamentos.\n\n${dados}`
      );
    } catch (erro) {
      throw new Error(this.traduzirErro(erro, nomeModelo));
    }

    const candidato = resposta.response.candidates?.[0];
    if (candidato?.finishReason === 'MAX_TOKENS') {
      throw new Error(
        'A resposta da IA excedeu o tamanho máximo. Reduza a quantidade de registros analisados e tente novamente.'
      );
    }
    if (resposta.response.promptFeedback?.blockReason) {
      throw new Error(
        `A solicitação foi bloqueada pelos filtros de segurança (${resposta.response.promptFeedback.blockReason}).`
      );
    }

    const texto = resposta.response.text();
    if (!texto?.trim()) {
      throw new Error('A IA não retornou conteúdo. Tente novamente em alguns instantes.');
    }

    let relatorio: RelatorioIa;
    try {
      relatorio = JSON.parse(texto) as RelatorioIa;
    } catch {
      throw new Error('A resposta da IA não veio no formato esperado (JSON inválido). Tente novamente.');
    }

    // Blindagem: o relatório é usado direto na montagem do HTML
    relatorio.grupos = Array.isArray(relatorio.grupos) ? relatorio.grupos : [];
    relatorio.grupos.forEach(g => (g.tickets = Array.isArray(g.tickets) ? g.tickets : []));

    const uso = resposta.response.usageMetadata;
    return {
      relatorio,
      modelo: nomeModelo,
      tokensEntrada: uso?.promptTokenCount,
      tokensSaida: uso?.candidatesTokenCount
    };
  }

  /**
   * Converte os erros do SDK em mensagens acionáveis em português.
   *
   * Atenção: o código 'fetch-error' do SDK NÃO significa apenas falha de rede — ele é
   * usado para qualquer resposta HTTP com erro (403, 400, 404, 429...), com o status
   * disponível em customErrorData. Por isso o diagnóstico aqui é feito pelo status HTTP,
   * e a mensagem sempre carrega o detalhe técnico devolvido pela API.
   */
  private traduzirErro(erro: unknown, nomeModelo: string): string {
    const e = erro as any;
    const codigo: string | undefined = e?.code;
    const dados = e?.customErrorData;
    const status: number | undefined = typeof dados?.status === 'number' ? dados.status : undefined;
    const statusText: string = dados?.statusText ?? '';
    const detalhe = this.extrairDetalhe(dados?.errorDetails) || e?.message || String(erro);

    // Registro completo no console para investigação
    console.error('[IA] Falha ao chamar o Firebase AI Logic', {
      codigo, status, statusText, modelo: nomeModelo, erro
    });

    const sufixo = ` (detalhe: ${this.encurtar(detalhe)})`;

    // O App Check é verificado antes do status: um token ausente/inválido chega como 401
    if (/app check/i.test(String(detalhe))) {
      return appCheckAtivo()
        ? 'O App Check está ativo, mas o token foi recusado. Em desenvolvimento (localhost), registre o token '
          + 'de depuração exibido no console do navegador em: Console do Firebase > App Check > seu app > '
          + 'Gerenciar tokens de depuração.' + sufixo
        : 'Este projeto exige App Check para usar a IA, e o app ainda não envia um token. '
          + 'Escolha uma das opções: (1) configure o App Check — crie a chave reCAPTCHA v3 no Console do '
          + 'Firebase (App Check > registrar app) e preencha "appCheck.recaptchaV3SiteKey" em '
          + 'src/environments/environment.ts; ou (2) desative o enforcement em Console do Firebase > '
          + 'App Check > APIs > Firebase AI Logic.' + sufixo;
    }

    if (codigo === 'api-not-enabled') {
      return 'A API do Firebase AI Logic (firebasevertexai.googleapis.com) não está habilitada neste projeto. '
        + 'No Console do Firebase abra "AI Logic" e clique em "Começar". '
        + 'Se você acabou de habilitar, aguarde alguns minutos e tente novamente.' + sufixo;
    }
    if (codigo === 'no-api-key') {
      return 'A chave de API do Firebase não foi encontrada na configuração do ambiente.';
    }
    if (codigo === 'no-project-id') {
      return 'O projectId do Firebase não foi encontrado na configuração do ambiente.';
    }

    if (status !== undefined) {
      if (status === 400) {
        return `A IA recusou a requisição (HTTP 400). Normalmente indica modelo indisponível para este `
          + `projeto ou parâmetro inválido.${sufixo}`;
      }
      if (status === 401 || status === 403) {
        return `Acesso negado pela API (HTTP ${status}). Verifique, nesta ordem: `
          + `1) se a API "firebasevertexai.googleapis.com" está habilitada no projeto; `
          + `2) se a chave de API do Firebase tem restrição de sites/domínios que bloqueia o endereço atual; `
          + `3) se o provedor escolhido no AI Logic é o "Gemini Developer API".${sufixo}`;
      }
      if (status === 404) {
        return `O modelo "${nomeModelo}" não está disponível (HTTP 404). O Google encerra modelos `
          + `periodicamente e restringe os antigos a projetos que já os usavam. `
          + `Selecione outro modelo na lista; se nenhum funcionar, é preciso atualizar `
          + `MODELOS_DISPONIVEIS conforme https://firebase.google.com/docs/ai-logic/models.${sufixo}`;
      }
      if (status === 429) {
        return 'A cota gratuita da IA foi atingida (limite por minuto ou por dia). '
          + 'Aguarde alguns instantes ou reduza a quantidade de registros analisados.' + sufixo;
      }
      if (status >= 500) {
        return `O serviço de IA está instável (HTTP ${status}). Tente novamente em alguns instantes.${sufixo}`;
      }
      return `A chamada à IA falhou (HTTP ${status} ${statusText}).${sufixo}`;
    }

    // Sem status HTTP: a requisição não chegou a ser respondida
    if (codigo === 'fetch-error' || /failed to fetch|networkerror|load failed/i.test(String(detalhe))) {
      return 'Não foi possível contatar o serviço de IA: a requisição para '
        + 'firebasevertexai.googleapis.com não obteve resposta. Causas comuns: bloqueador de anúncios ou '
        + 'extensão do navegador, proxy/firewall corporativo, ou a API ainda propagando após a habilitação. '
        + 'Abra o console do navegador (F12) para ver o erro completo.' + sufixo;
    }

    return `Erro ao chamar a IA: ${this.encurtar(detalhe)}`;
  }

  /** Extrai a razão detalhada devolvida pela API, quando houver. */
  private extrairDetalhe(errorDetails: unknown): string {
    if (!Array.isArray(errorDetails)) return '';
    return errorDetails
      .map((d: any) => d?.reason || d?.message || (typeof d === 'string' ? d : ''))
      .filter(Boolean)
      .join(' | ');
  }

  private encurtar(texto: string, max = 300): string {
    const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
    return limpo.length > max ? `${limpo.slice(0, max)}...` : limpo;
  }
}
