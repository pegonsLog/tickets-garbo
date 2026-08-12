/**
 * Estrutura do relatório de similaridade devolvido pela IA.
 *
 * O modelo é obrigado a responder exatamente neste formato (saída estruturada
 * com responseSchema), o que permite montar o HTML do relatório com layout
 * controlado pela aplicação, sem depender de HTML gerado pelo modelo.
 */

/** Um ticket citado dentro de um grupo. */
export interface TicketRelatorio {
  numero: string;
  solicitante?: string;
  data_entrada?: string;
  /** Trecho/resumo do que essa pessoa pediu, para evidenciar a diferença de redação. */
  trecho?: string;
}

/** Grupo de tickets que podem ser atendidos por uma única resposta. */
export interface GrupoRelatorio {
  titulo: string;
  local: string;
  problema_comum: string;
  confianca: 'alta' | 'media' | 'baixa' | string;
  justificativa?: string;
  tickets: TicketRelatorio[];
  resposta_padrao: string;
}

export interface ResumoRelatorio {
  total_registros: number;
  total_grupos: number;
  respostas_economizadas: number;
  panorama: string;
}

/**
 * Os tickets que não entram em nenhum grupo não são pedidos ao modelo nem listados:
 * o relatório mostra apenas o quantitativo, calculado a partir dos grupos e do total
 * de registros analisados.
 */
export interface RelatorioIa {
  resumo: ResumoRelatorio;
  grupos: GrupoRelatorio[];
}

/** Metadados de execução, exibidos no rodapé do relatório. */
export interface MetaRelatorio {
  geradoEm: Date;
  modelo: string;
  registrosAnalisados: number;
  filtros: { rotulo: string; valor: string }[];
  tokensEntrada?: number;
  tokensSaida?: number;
}
