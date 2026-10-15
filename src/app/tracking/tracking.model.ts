/**
 * Modelo do acompanhamento de tickets.
 *
 * Estrutura no Firestore:
 *   tickets_acompanhados/{idDoc}              -> dados do ticket (snapshot da planilha)
 *   tickets_acompanhados/{idDoc}/atividades/* -> atividades realizadas naquele ticket
 *
 * O id do documento é o número do ticket sanitizado, porque o número original contém
 * barras ("31.00450457/2022-58") e a barra é separador de caminho no Firestore.
 */

export type StatusAtividade = 'em_andamento' | 'concluida';

/** Uma atividade realizada no atendimento do ticket. */
export interface Atividade {
  id?: string;
  /** Data em que a atividade foi realizada (yyyy-mm-dd). */
  data: string;
  /** Hora em que a atividade foi realizada (HH:mm). Registros antigos podem não ter. */
  hora?: string;
  descricao: string;
  status: StatusAtividade;
  /**
   * Nome de quem realizou a atividade.
   * Informado no formulário: o app não tem login, então o nome é declarado
   * por quem registra, e não comprovado por autenticação.
   */
  usuario: string;
  /** Momento do registro no sistema (ISO). */
  criadoEm?: string;
}

/** Ticket levado para acompanhamento, com um retrato dos dados da planilha. */
export interface TicketAcompanhado {
  /** Número original do ticket, como aparece na planilha. */
  numero: string;
  status?: string;
  responsavel?: string;
  origem?: string;
  solicitante?: string;
  dataEntrada?: string;
  assunto?: string;
  classe?: string;
  rua?: string;
  num?: string;
  bairro?: string;
  regional?: string;
  descricao?: string;
  resposta?: string;

  criadoEm?: string;
  atualizadoEm?: string;

  // Resumo mantido no próprio documento, para listar sem ler as subcoleções
  totalAtividades?: number;
  atividadesConcluidas?: number;
  ultimaAtividadeData?: string;
  /** Hora da atividade mais recente (HH:mm). */
  ultimaAtividadeHora?: string;
  /** Quem realizou a atividade mais recente. */
  ultimaAtividadeUsuario?: string;
  /** Status da atividade mais recente (define o status atual do ticket). */
  ultimaAtividadeStatus?: StatusAtividade;

  /** Carregado sob demanda ao abrir o acompanhamento. */
  atividades?: Atividade[];
}

export type SituacaoAcompanhamento = 'sem_atividade' | 'em_andamento' | 'concluido';

/** Formato aceito para a hora da atividade. */
export const PADRAO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Ordena as atividades da mais recente para a mais antiga: data, depois hora e,
 * no empate, a registrada por último no sistema. Sem hora conta como 00:00.
 */
export function ordenarAtividades(atividades: Atividade[]): Atividade[] {
  const chave = (a: Atividade) => `${a.data ?? ''} ${a.hora || '00:00'} ${a.criadoEm ?? ''}`;
  return [...atividades].sort((a, b) => chave(b).localeCompare(chave(a)));
}

/** Resumo gravado no documento do ticket, calculado a partir das atividades. */
export function resumoDasAtividades(atividades: Atividade[]) {
  const ordenadas = ordenarAtividades(atividades);
  const ultima = ordenadas[0];
  return {
    totalAtividades: ordenadas.length,
    atividadesConcluidas: ordenadas.filter(a => a.status === 'concluida').length,
    ultimaAtividadeData: ultima?.data ?? '',
    ultimaAtividadeHora: ultima?.hora ?? '',
    ultimaAtividadeUsuario: ultima?.usuario ?? '',
    ultimaAtividadeStatus: ultima?.status as StatusAtividade | undefined
  };
}

/** "dd/mm/aaaa" ou "dd/mm/aaaa às HH:mm", conforme houver hora. */
export function dataHoraLegivel(data?: string, hora?: string): string {
  const m = (data ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return data || '—';
  const dia = `${m[3]}/${m[2]}/${m[1]}`;
  return hora ? `${dia} às ${hora}` : dia;
}

/** Converte o número do ticket em um id de documento válido. */
export function idDocumento(numero: string): string {
  const limpo = (numero ?? '').trim();
  if (!limpo) return '';
  return limpo.replace(/[^\w.\-]/g, '_');
}

/** Deriva a situação do ticket a partir do resumo das atividades. */
export function situacaoDe(ticket: TicketAcompanhado): SituacaoAcompanhamento {
  const total = ticket.totalAtividades ?? 0;
  if (total === 0) return 'sem_atividade';
  return (ticket.atividadesConcluidas ?? 0) > 0 ? 'concluido' : 'em_andamento';
}

/** Status atual do ticket na lista: o da atividade mais recente. */
export type StatusAtual = 'aguardando' | 'em_andamento' | 'concluida';

/**
 * Deriva o status atual pelo resumo do ticket.
 * Documentos gravados antes do campo `ultimaAtividadeStatus` existir caem na
 * regra antiga (alguma concluída = concluída), até receberem nova atividade.
 */
export function statusAtualDe(ticket: TicketAcompanhado): StatusAtual {
  if ((ticket.totalAtividades ?? 0) === 0) return 'aguardando';
  if (ticket.ultimaAtividadeStatus) return ticket.ultimaAtividadeStatus;
  return (ticket.atividadesConcluidas ?? 0) > 0 ? 'concluida' : 'em_andamento';
}

export const ROTULO_STATUS_ATUAL: Record<StatusAtual, string> = {
  aguardando: 'Aguardando atividade',
  em_andamento: 'Em andamento',
  concluida: 'Concluída'
};

export const ROTULO_SITUACAO: Record<SituacaoAcompanhamento, string> = {
  sem_atividade: 'Sem atividade',
  em_andamento: 'Em andamento',
  concluido: 'Com atividade concluída'
};

export const ROTULO_STATUS_ATIVIDADE: Record<StatusAtividade, string> = {
  em_andamento: 'Atividade em andamento',
  concluida: 'Atividade concluída'
};
