import { SituacaoAcompanhamento } from './tracking.model';

/** Situação de um ticket listado no PDF auditado. */
export type SituacaoAuditada = SituacaoAcompanhamento | 'nao_acompanhado';

/** Um ticket encontrado no PDF, já cruzado com o acompanhamento. */
export interface ItemAuditoria {
  numero: string;
  /** Existe no Firestore (foi levado para acompanhamento). */
  acompanhado: boolean;
  /** Atividades consideradas (dentro do período, quando informado). */
  totalAtividades: number;
  atividadesConcluidas: number;
  ultimaAtividadeData?: string;
  ultimaAtividadeHora?: string;
  ultimaAtividadeUsuario?: string;
  /** Pessoas que registraram atividade neste ticket no período. */
  usuarios: string[];
  situacao: SituacaoAuditada;
  assunto?: string;
}

/** Produção de uma pessoa nos tickets da relação. */
export interface ProducaoUsuario {
  usuario: string;
  atividades: number;
  concluidas: number;
  /** Tickets distintos em que a pessoa registrou atividade. */
  tickets: number;
}

/** Período opcional da auditoria (datas yyyy-mm-dd). */
export interface PeriodoAuditoria {
  inicio?: string;
  fim?: string;
}

/** Resultado completo da auditoria de um período. */
export interface ResultadoAuditoria {
  arquivo: string;
  geradoEm: Date;
  modelo: string;
  periodo: PeriodoAuditoria;

  itens: ItemAuditoria[];
  porUsuario: ProducaoUsuario[];

  // Quantitativos (calculados em código, não pelo modelo)
  totalNoPdf: number;
  comAtividade: number;
  semAtividade: number;
  concluidos: number;
  naoAcompanhados: number;
  percentualComAtividade: number;
  percentualConcluidos: number;

  /** Tickets em acompanhamento que não constavam no PDF. */
  acompanhadosForaDoPdf: number;

  /** Parecer textual gerado pela IA a partir dos quantitativos. */
  parecer?: string;
}

export const ROTULO_SITUACAO_AUDITADA: Record<SituacaoAuditada, string> = {
  concluido: 'Atividade concluída',
  em_andamento: 'Em andamento',
  sem_atividade: 'Sem atividade',
  nao_acompanhado: 'Não acompanhado'
};

/**
 * Faixas de avaliação da meta, pelo percentual de tickets com atividade.
 * Usadas tanto no selo do relatório quanto na orientação do parecer da IA,
 * para que os dois nunca discordem.
 */
export const META_ATINGIDA = 90;
export const META_PARCIAL = 70;

export type AvaliacaoMeta = 'atingida' | 'parcial' | 'nao_atingida';

export function avaliarMeta(percentualComAtividade: number): AvaliacaoMeta {
  if (percentualComAtividade >= META_ATINGIDA) return 'atingida';
  if (percentualComAtividade >= META_PARCIAL) return 'parcial';
  return 'nao_atingida';
}

export const ROTULO_META: Record<AvaliacaoMeta, string> = {
  atingida: 'Meta atingida',
  parcial: 'Meta parcialmente atingida',
  nao_atingida: 'Meta não atingida'
};

/**
 * Normaliza o número do ticket para comparação, mantendo apenas os dígitos.
 *
 * O mesmo ticket pode aparecer com pontuação diferente no PDF e na planilha
 * ("31.00450457/2022-58", "31004504572022-58"), então a comparação ignora
 * qualquer separador.
 */
export function chaveNumero(numero: string): string {
  return (numero ?? '').replace(/\D/g, '');
}

export function descreverPeriodo(periodo: PeriodoAuditoria): string {
  const fmt = (d: string) => d.split('-').reverse().join('/');
  if (periodo.inicio && periodo.fim) return `${fmt(periodo.inicio)} a ${fmt(periodo.fim)}`;
  if (periodo.inicio) return `a partir de ${fmt(periodo.inicio)}`;
  if (periodo.fim) return `até ${fmt(periodo.fim)}`;
  return 'todas as atividades registradas';
}

/** Indica se a data (yyyy-mm-dd) está dentro do período. Sem período, tudo conta. */
export function dentroDoPeriodo(data: string, periodo: PeriodoAuditoria): boolean {
  if (!data) return !periodo.inicio && !periodo.fim;
  if (periodo.inicio && data < periodo.inicio) return false;
  if (periodo.fim && data > periodo.fim) return false;
  return true;
}
