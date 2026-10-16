import {
  ItemComparacao,
  ItemPdf,
  ResultadoComparacao,
  SituacaoComparacao,
  TransicaoStatus,
  chaveNumero
} from './audit.model';
import { ROTULO_STATUS_ATUAL, TicketAcompanhado, statusAtualDe } from './tracking.model';

/**
 * Compara o status de cada ticket no arquivo enviado com o status atual da lista
 * (planilha carregada na tela) e, quando houver, com o status do acompanhamento.
 *
 * Função pura e determinística: a IA só transcreve o status do PDF; a decisão de
 * "igual" ou "alterado" é feita aqui, com normalização de texto.
 *
 * @param itensPdf     tickets lidos do PDF (número + status, se houver)
 * @param lista        linhas da planilha carregada na tela (todas, não só as filtradas)
 * @param acompanhados tickets em acompanhamento no Firestore
 */
export function compararStatus(
  itensPdf: ItemPdf[],
  lista: Record<string, string>[],
  acompanhados: TicketAcompanhado[]
): ResultadoComparacao {
  const listaPorChave = new Map<string, Record<string, string>>();
  lista.forEach(linha => {
    const chave = chaveNumero(linha['NUMERO'] ?? '');
    if (chave) listaPorChave.set(chave, linha);
  });

  const acompPorChave = new Map<string, TicketAcompanhado>();
  acompanhados.forEach(t => {
    const chave = chaveNumero(t.numero);
    if (chave) acompPorChave.set(chave, t);
  });

  const transicoes = new Map<string, TransicaoStatus>();

  const itens: ItemComparacao[] = itensPdf.map(item => {
    const chave = chaveNumero(item.numero);
    const linha = listaPorChave.get(chave);
    const acomp = acompPorChave.get(chave);

    const statusPdf = limpar(item.status);
    const statusLista = limpar(linha?.['STATUS']);

    let situacao: SituacaoComparacao;
    if (!linha) {
      situacao = 'fora_da_lista';
    } else if (!statusPdf) {
      situacao = 'sem_status_pdf';
    } else if (normalizar(statusPdf) === normalizar(statusLista)) {
      situacao = 'igual';
    } else {
      situacao = 'alterado';
      // Agrupa pela forma normalizada, mas exibe a grafia encontrada
      const id = `${normalizar(statusPdf)}→${normalizar(statusLista)}`;
      const t = transicoes.get(id) ?? { de: statusPdf, para: statusLista || '(vazio)', quantidade: 0 };
      t.quantidade++;
      transicoes.set(id, t);
    }

    return {
      numero: linha?.['NUMERO']?.trim() || item.numero,
      assunto: limpar(linha?.['ASSUNTO']) || acomp?.assunto || undefined,
      statusPdf,
      statusLista,
      statusAcompanhamento: acomp ? ROTULO_STATUS_ATUAL[statusAtualDe(acomp)] : undefined,
      situacao
    };
  });

  const contar = (s: SituacaoComparacao) => itens.filter(i => i.situacao === s).length;
  const iguais = contar('igual');
  const alterados = contar('alterado');
  const comparaveis = iguais + alterados;

  return {
    itens: ordenar(itens),
    transicoes: Array.from(transicoes.values()).sort((a, b) => b.quantidade - a.quantidade),
    total: itens.length,
    iguais,
    alterados,
    semStatusPdf: contar('sem_status_pdf'),
    foraDaLista: contar('fora_da_lista'),
    percentualAlterado: comparaveis ? Math.round((alterados / comparaveis) * 100) : 0,
    listaIndisponivel: lista.length === 0,
    arquivoSemStatus: itensPdf.length > 0 && itensPdf.every(i => !limpar(i.status))
  };
}

/** Alterados primeiro, depois os que não puderam ser comparados, por fim os iguais. */
function ordenar(itens: ItemComparacao[]): ItemComparacao[] {
  const peso: Record<SituacaoComparacao, number> = {
    alterado: 0,
    fora_da_lista: 1,
    sem_status_pdf: 2,
    igual: 3
  };
  return [...itens].sort((a, b) =>
    peso[a.situacao] - peso[b.situacao]
    || a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true }));
}

function limpar(valor: string | undefined): string {
  return (valor ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Forma de comparação do status: sem acentos, maiúsculas e espaços extras.
 * "Encerrada", "ENCERRADA" e "encerrada " contam como o mesmo status.
 */
export function normalizar(valor: string | undefined): string {
  return limpar(valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}
