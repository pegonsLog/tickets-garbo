export interface StreetSearchResult {
  NUM_SOLICITACAO: string;
  RUA: string;
  NUMERO: string | number;
  DATA_ENTRADA: string;
  STATUS: string;
  DESCRICAO: string;
  ORIGEM?: string;
  MENSAGEM?: string;
  RESUMO?: string;
}
