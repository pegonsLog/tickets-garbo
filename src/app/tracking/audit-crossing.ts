import {
  ItemAuditoria,
  PeriodoAuditoria,
  ProducaoUsuario,
  ResultadoAuditoria,
  SituacaoAuditada,
  chaveNumero,
  dentroDoPeriodo
} from './audit.model';
import { Atividade, TicketAcompanhado, ordenarAtividades } from './tracking.model';

/**
 * Cruza os números extraídos do PDF com o acompanhamento salvo no Firestore.
 *
 * Função pura e determinística (sem Firestore nem IA): todos os quantitativos
 * do relatório de auditoria saem daqui, nunca da aritmética do modelo.
 *
 * @param numeros            números do PDF, já sem repetição
 * @param acompanhados       todos os tickets em acompanhamento
 * @param atividadesPorTicket atividades de cada ticket, indexadas pelo número original
 * @param periodo            quando informado, só atividades com data dentro dele contam
 */
export function montarResultado(
  numeros: string[],
  acompanhados: TicketAcompanhado[],
  atividadesPorTicket: Map<string, Atividade[]>,
  periodo: PeriodoAuditoria,
  arquivo: string,
  modelo: string
): ResultadoAuditoria {
  const porChave = indexarPorChave(acompanhados);
  const chavesDoPdf = new Set<string>();
  const producao = new Map<string, { usuario: string; atividades: number; concluidas: number; tickets: Set<string> }>();

  const itens: ItemAuditoria[] = numeros.map(numero => {
    const chave = chaveNumero(numero);
    chavesDoPdf.add(chave);
    const ticket = porChave.get(chave);

    if (!ticket) {
      return {
        numero,
        acompanhado: false,
        totalAtividades: 0,
        atividadesConcluidas: 0,
        usuarios: [],
        situacao: 'nao_acompanhado' as SituacaoAuditada
      };
    }

    // Mesma ordem usada no app: data, hora e momento do registro
    const doPeriodo = ordenarAtividades(
      (atividadesPorTicket.get(ticket.numero) ?? []).filter(a => dentroDoPeriodo(a.data, periodo)));

    const concluidas = doPeriodo.filter(a => a.status === 'concluida').length;
    const usuarios: string[] = [];

    doPeriodo.forEach(a => {
      const nome = (a.usuario ?? '').replace(/\s+/g, ' ').trim() || 'Não informado';
      // Mesmo nome com caixa diferente conta como a mesma pessoa
      const chaveUsuario = nome.toLowerCase();
      if (!usuarios.some(u => u.toLowerCase() === chaveUsuario)) usuarios.push(nome);

      let p = producao.get(chaveUsuario);
      if (!p) {
        p = { usuario: nome, atividades: 0, concluidas: 0, tickets: new Set() };
        producao.set(chaveUsuario, p);
      }
      p.atividades++;
      if (a.status === 'concluida') p.concluidas++;
      p.tickets.add(chave);
    });

    const situacao: SituacaoAuditada = doPeriodo.length === 0
      ? 'sem_atividade'
      : concluidas > 0 ? 'concluido' : 'em_andamento';

    return {
      numero: ticket.numero || numero,
      acompanhado: true,
      totalAtividades: doPeriodo.length,
      atividadesConcluidas: concluidas,
      ultimaAtividadeData: doPeriodo[0]?.data,
      ultimaAtividadeHora: doPeriodo[0]?.hora,
      ultimaAtividadeUsuario: doPeriodo[0]?.usuario,
      usuarios,
      situacao,
      assunto: ticket.assunto
    };
  });

  const total = itens.length;
  const comAtividade = itens.filter(i => i.totalAtividades > 0).length;
  const concluidos = itens.filter(i => i.situacao === 'concluido').length;

  const porUsuario: ProducaoUsuario[] = Array.from(producao.values())
    .map(p => ({ usuario: p.usuario, atividades: p.atividades, concluidas: p.concluidas, tickets: p.tickets.size }))
    .sort((a, b) => b.atividades - a.atividades || a.usuario.localeCompare(b.usuario, 'pt-BR'));

  return {
    arquivo,
    geradoEm: new Date(),
    modelo,
    periodo,
    itens: ordenar(itens),
    porUsuario,
    totalNoPdf: total,
    comAtividade,
    semAtividade: total - comAtividade,
    concluidos,
    naoAcompanhados: itens.filter(i => !i.acompanhado).length,
    percentualComAtividade: total ? Math.round((comAtividade / total) * 100) : 0,
    percentualConcluidos: total ? Math.round((concluidos / total) * 100) : 0,
    acompanhadosForaDoPdf: acompanhados.filter(t => !chavesDoPdf.has(chaveNumero(t.numero))).length
  };
}

/** Indexa os tickets acompanhados pela chave numérica (só dígitos). */
export function indexarPorChave(acompanhados: TicketAcompanhado[]): Map<string, TicketAcompanhado> {
  const mapa = new Map<string, TicketAcompanhado>();
  acompanhados.forEach(t => {
    const chave = chaveNumero(t.numero);
    if (chave) mapa.set(chave, t);
  });
  return mapa;
}

/** Problemas primeiro (sem acompanhamento, sem atividade), depois os resolvidos. */
function ordenar(itens: ItemAuditoria[]): ItemAuditoria[] {
  const peso: Record<SituacaoAuditada, number> = {
    nao_acompanhado: 0,
    sem_atividade: 1,
    em_andamento: 2,
    concluido: 3
  };
  return [...itens].sort((a, b) =>
    peso[a.situacao] - peso[b.situacao]
    || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}
