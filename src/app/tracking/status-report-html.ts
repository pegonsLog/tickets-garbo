import { cssBaseRelatorio, escaparHtml as esc, multilinhaHtml } from '../shared/report-css';
import {
  ItemComparacao,
  ROTULO_SITUACAO_COMPARACAO,
  ResultadoAuditoria,
  ResultadoComparacao,
  SituacaoComparacao
} from './audit.model';

/**
 * Relatório HTML da comparação de status: o status de cada ticket no arquivo
 * enviado versus o status atual na lista. Separado do relatório de auditoria
 * do acompanhamento, embora venha da mesma leitura do PDF.
 * Todo texto dinâmico é escapado.
 */
export function montarComparacaoHtml(r: ResultadoAuditoria): string {
  const c = r.comparacao;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(`Comparação de status — ${r.geradoEm.toLocaleDateString('pt-BR')}`)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${css()}</style>
</head>
<body>
<div class="toolbar no-print">
  <button type="button" onclick="window.print()">Imprimir / Salvar em PDF</button>
</div>

<div class="sheet">
  <header class="cover">
    <div class="cover-tag">Tickets Garbo</div>
    <h1>Comparação de status</h1>
    <p class="cover-sub">Status dos tickets no arquivo enviado comparado ao status atual na lista</p>
    <div class="cover-meta">
      <span>Arquivo: ${esc(r.arquivo)}</span>
      <span>Gerado em ${esc(r.geradoEm.toLocaleString('pt-BR'))}</span>
    </div>
  </header>

  ${c ? corpo(c) : `<section class="bloco"><div class="vazio">A comparação de status não foi executada.</div></section>`}

  <footer class="rodape">
    <div>
      Status do arquivo transcrito por IA (${esc(r.modelo)}); a comparação com a lista é feita pela aplicação,
      ignorando diferenças de maiúsculas, acentos e espaços. O parecer é gerado por IA a partir dos quantitativos.
    </div>
    <div class="rodape-tec">${esc(r.geradoEm.toLocaleString('pt-BR'))}</div>
  </footer>
</div>
</body>
</html>`;
}

function corpo(c: ResultadoComparacao): string {
  const avisos: string[] = [];
  if (c.listaIndisponivel) {
    avisos.push('A lista de tickets não estava carregada no momento da análise, então não houve com o que comparar. '
      + 'Recarregue a lista e execute a análise novamente.');
  }
  if (c.arquivoSemStatus) {
    avisos.push('O arquivo enviado não informa o status dos tickets. A comparação depende de um relatório que '
      + 'tenha a coluna de status.');
  }

  return `
  ${avisos.length ? `<section class="avisos">${avisos.map(a => `<p>${esc(a)}</p>`).join('')}</section>` : ''}

  <section class="kpis">
    ${kpi(String(c.total), 'Tickets no arquivo')}
    ${kpi(String(c.iguais), 'Sem alteração', 'bom')}
    ${kpi(`${c.alterados}`, `Status alterado (${c.percentualAlterado}%)`, 'destaque')}
    ${kpi(String(c.semStatusPdf), 'Sem status no arquivo', c.semStatusPdf ? 'atencao' : '')}
    ${kpi(String(c.foraDaLista), 'Fora da lista', c.foraDaLista ? 'ruim' : '')}
  </section>

  ${c.parecer ? `<section class="bloco">
    <h2>Parecer</h2>
    <p class="parecer">${multilinhaHtml(c.parecer)}</p>
  </section>` : ''}

  ${transicoesHtml(c)}

  <section class="bloco">
    <h2>Comparação por ticket</h2>
    <p class="seccao-sub">Os tickets com status alterado aparecem primeiro.</p>
    <table class="tabela">
      <thead>
        <tr>
          <th class="c-tk">Número</th>
          <th>Assunto</th>
          <th class="c-st">No arquivo</th>
          <th class="c-st">Na lista hoje</th>
          <th class="c-st">Acompanhamento</th>
          <th class="c-sit">Resultado</th>
        </tr>
      </thead>
      <tbody>
        ${c.itens.map(linha).join('')}
      </tbody>
    </table>
  </section>`;
}

function transicoesHtml(c: ResultadoComparacao): string {
  if (!c.transicoes.length) return '';
  const maximo = Math.max(...c.transicoes.map(t => t.quantidade), 1);
  return `<section class="bloco">
    <h2>Mudanças de status</h2>
    <p class="seccao-sub">Como o status mudou entre a emissão do arquivo e hoje.</p>
    <table class="tabela compacta">
      <thead><tr><th>No arquivo</th><th class="c-seta"></th><th>Na lista hoje</th><th class="c-num">Tickets</th><th class="c-graf">Volume</th></tr></thead>
      <tbody>
        ${c.transicoes.map(t => `<tr>
          <td>${esc(t.de)}</td>
          <td class="c-seta">→</td>
          <td><strong>${esc(t.para)}</strong></td>
          <td class="c-num">${t.quantidade}</td>
          <td class="c-graf"><span class="mini"><span style="width:${Math.round((t.quantidade / maximo) * 100)}%"></span></span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>`;
}

function linha(i: ItemComparacao): string {
  const destaque = i.situacao === 'alterado' ? ' class="mudou"' : '';
  return `<tr${destaque}>
    <td class="c-tk"><span class="tk">${esc(i.numero)}</span></td>
    <td>${esc(i.assunto || '—')}</td>
    <td class="c-st">${esc(i.statusPdf || '—')}</td>
    <td class="c-st">${i.situacao === 'alterado' ? `<strong>${esc(i.statusLista || '—')}</strong>` : esc(i.statusLista || '—')}</td>
    <td class="c-st">${esc(i.statusAcompanhamento || '—')}</td>
    <td class="c-sit">${selo(i.situacao)}</td>
  </tr>`;
}

function selo(s: SituacaoComparacao): string {
  const classe = s === 'igual' ? 'ok' : s === 'alterado' ? 'andamento' : s === 'fora_da_lista' ? 'ruim' : 'neutro';
  return `<span class="badge ${classe}">${esc(ROTULO_SITUACAO_COMPARACAO[s])}</span>`;
}

function kpi(valor: string, rotulo: string, classe = ''): string {
  return `<div class="kpi ${classe}">
    <span class="kpi-valor">${esc(valor)}</span>
    <span class="kpi-rotulo">${esc(rotulo)}</span>
  </div>`;
}

function css(): string {
  return cssBaseRelatorio() + `
.avisos {
  margin-top: 18px;
  padding: 12px 16px;
  border-radius: 12px;
  background: var(--warn-bg);
  color: var(--warn-fg);
  border-left: 5px solid var(--warn-fg);
}
.avisos p { margin: 0; font-size: 12px; font-weight: 500; }
.avisos p + p { margin-top: 6px; }
.parecer { margin: 0; font-size: 12.5px; color: var(--ink-700); }
.c-st { width: 104px; }
.c-sit { width: 128px; }
.c-seta { width: 26px; text-align: center; color: var(--ink-500); font-weight: 700; }
.c-graf { width: 120px; }
.tabela tbody tr.mudou td { background: var(--warn-bg); }
.mini { display: block; height: 7px; border-radius: 999px; background: var(--brand-100); overflow: hidden; }
.mini span { display: block; height: 100%; background: var(--brand-600); border-radius: 999px; }
@media print {
  .avisos { break-inside: avoid; page-break-inside: avoid; }
}
`;
}
