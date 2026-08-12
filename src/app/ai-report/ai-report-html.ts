import { GrupoRelatorio, MetaRelatorio, RelatorioIa } from './ai-report.model';

/**
 * Monta o documento HTML do relatório de similaridade.
 *
 * O HTML é gerado pela aplicação (e não pela IA) a partir do JSON estruturado,
 * o que garante layout consistente e paginação previsível na conversão para PDF.
 * Todo texto vindo do modelo é escapado antes de entrar no documento.
 *
 * O resultado é um documento autocontido (CSS embutido, sem dependências externas
 * obrigatórias), adequado para visualizar, baixar e imprimir em A4.
 */
export function montarRelatorioHtml(relatorio: RelatorioIa, meta: MetaRelatorio): string {
  const resumo = relatorio.resumo ?? {
    total_registros: meta.registrosAnalisados,
    total_grupos: relatorio.grupos.length,
    respostas_economizadas: 0,
    panorama: ''
  };

  const economia = calcularEconomia(relatorio, resumo.respostas_economizadas);
  const ticketsAgrupados = contarTicketsDistintos(relatorio);
  // Quantitativo dos que ficaram fora: calculado localmente, sem depender do modelo listá-los
  const naoAgrupados = Math.max(meta.registrosAnalisados - ticketsAgrupados, 0);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(`Relatório de similaridade de tickets — ${formatarData(meta.geradoEm)}`)}</title>
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
    <h1>Relatório de solicitações semelhantes</h1>
    <p class="cover-sub">Agrupamento de tickets que podem ser atendidos por uma única resposta</p>
    <div class="cover-meta">
      <span>Gerado em ${esc(formatarDataHora(meta.geradoEm))}</span>
      <span>${esc(String(meta.registrosAnalisados))} registros analisados</span>
      <span>Modelo: ${esc(meta.modelo)}</span>
    </div>
  </header>

  <section class="kpis">
    ${kpi(String(meta.registrosAnalisados), 'Tickets analisados')}
    ${kpi(String(relatorio.grupos.length), 'Grupos identificados')}
    ${kpi(String(ticketsAgrupados), 'Tickets agrupados')}
    ${kpi(String(naoAgrupados), 'Atendimento individual')}
    ${kpi(String(economia), 'Respostas economizadas', 'destaque')}
  </section>

  ${resumo.panorama ? `<section class="bloco">
    <h2>Panorama</h2>
    <p class="panorama">${multilinha(resumo.panorama)}</p>
  </section>` : ''}

  ${filtrosHtml(meta)}

  ${relatorio.grupos.length ? `<section class="bloco">
    <h2>Grupos identificados</h2>
    <table class="tabela">
      <thead>
        <tr><th class="c-id">#</th><th>Local</th><th>Problema em comum</th><th class="c-num">Tickets</th><th class="c-conf">Confiança</th></tr>
      </thead>
      <tbody>
        ${relatorio.grupos.map((g, i) => `<tr>
          <td class="c-id">G${i + 1}</td>
          <td>${esc(g.local || '—')}</td>
          <td>${esc(g.problema_comum || g.titulo || '—')}</td>
          <td class="c-num">${g.tickets?.length ?? 0}</td>
          <td class="c-conf">${badge(g.confianca)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>

  <section class="bloco detalhes">
    <h2>Detalhamento dos grupos</h2>
    ${relatorio.grupos.map((g, i) => grupoHtml(g, i + 1)).join('')}
  </section>` : `<section class="bloco">
    <div class="vazio">Nenhum grupo de solicitações semelhantes foi identificado no conjunto analisado.</div>
  </section>`}

  <section class="bloco">
    <h2>Atendimento individual</h2>
    <p class="individual">
      <strong>${naoAgrupados}</strong> ticket(s) não apresentaram semelhança suficiente para agrupamento
      e seguem para resposta individual.${naoAgrupados > 0
        ? ' Eles não são listados neste relatório: consulte-os na própria aplicação.'
        : ''}
    </p>
  </section>

  <footer class="rodape">
    <div>
      Relatório gerado por IA (${esc(meta.modelo)}) a partir dos registros filtrados na aplicação.
      Os agrupamentos são sugestões e devem ser conferidos antes do envio das respostas.
    </div>
    <div class="rodape-tec">
      ${esc(formatarDataHora(meta.geradoEm))}${tokensTexto(meta)}
    </div>
  </footer>
</div>
</body>
</html>`;
}

// ===== Blocos =====

function kpi(valor: string, rotulo: string, classe = ''): string {
  return `<div class="kpi ${classe}">
    <span class="kpi-valor">${esc(valor)}</span>
    <span class="kpi-rotulo">${esc(rotulo)}</span>
  </div>`;
}

function filtrosHtml(meta: MetaRelatorio): string {
  if (!meta.filtros?.length) {
    return `<section class="bloco">
      <h2>Recorte analisado</h2>
      <p class="filtros-vazio">Sem filtros aplicados — base completa de tickets.</p>
    </section>`;
  }
  return `<section class="bloco">
    <h2>Recorte analisado</h2>
    <ul class="filtros">
      ${meta.filtros.map(f => `<li><strong>${esc(f.rotulo)}:</strong> ${esc(f.valor)}</li>`).join('')}
    </ul>
  </section>`;
}

function grupoHtml(grupo: GrupoRelatorio, indice: number): string {
  const tickets = grupo.tickets ?? [];
  return `<article class="grupo">
    <div class="grupo-head">
      <span class="grupo-id">G${indice}</span>
      <div class="grupo-titulo">
        <h3>${esc(grupo.titulo || grupo.problema_comum || `Grupo ${indice}`)}</h3>
        <span class="grupo-local">${esc(grupo.local || 'Local não informado')}</span>
      </div>
      ${badge(grupo.confianca)}
    </div>

    <div class="grupo-corpo">
      <div class="campo">
        <span class="campo-rotulo">Problema em comum</span>
        <p>${esc(grupo.problema_comum || '—')}</p>
      </div>

      ${grupo.justificativa ? `<div class="campo">
        <span class="campo-rotulo">Por que estão juntos</span>
        <p>${esc(grupo.justificativa)}</p>
      </div>` : ''}

      <div class="campo">
        <span class="campo-rotulo">Tickets atendidos (${tickets.length})</span>
        <table class="tabela compacta">
          <thead><tr><th class="c-tk">Número</th><th>Solicitante</th><th class="c-dt">Entrada</th><th>O que foi pedido</th></tr></thead>
          <tbody>
            ${tickets.map(t => `<tr>
              <td class="c-tk"><span class="tk">${esc(t.numero || '—')}</span></td>
              <td>${esc(t.solicitante || '—')}</td>
              <td class="c-dt">${esc(t.data_entrada || '—')}</td>
              <td>${esc(t.trecho || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="resposta">
        <span class="resposta-rotulo">Resposta única sugerida</span>
        <p>${multilinha(grupo.resposta_padrao || '—')}</p>
      </div>
    </div>
  </article>`;
}

function badge(confianca: string): string {
  const c = (confianca ?? '').toLowerCase();
  const classe = c === 'alta' ? 'alta' : c === 'baixa' ? 'baixa' : 'media';
  const texto = c === 'alta' ? 'Confiança alta' : c === 'baixa' ? 'Confiança baixa' : 'Confiança média';
  return `<span class="badge ${classe}">${esc(texto)}</span>`;
}

// ===== Utilidades =====

/** Escapa caracteres com significado em HTML. Aplicado a todo texto vindo da IA. */
function esc(valor: string): string {
  return (valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa e preserva as quebras de linha do texto. */
function multilinha(valor: string): string {
  return esc(valor).replace(/\r?\n/g, '<br>');
}

/**
 * Conta os tickets presentes nos grupos sem contar duas vezes o mesmo número,
 * caso o modelo repita um ticket em mais de um grupo.
 */
function contarTicketsDistintos(relatorio: RelatorioIa): number {
  const numeros = new Set<string>();
  let semNumero = 0;
  relatorio.grupos.forEach(g => (g.tickets ?? []).forEach(t => {
    const chave = (t.numero ?? '').trim().toLowerCase();
    if (chave) {
      numeros.add(chave);
    } else {
      semNumero++;
    }
  }));
  return numeros.size + semNumero;
}

function calcularEconomia(relatorio: RelatorioIa, informado: number): number {
  const calculado = relatorio.grupos.reduce((soma, g) => soma + Math.max((g.tickets?.length ?? 0) - 1, 0), 0);
  // Prefere o cálculo local: o modelo às vezes erra a aritmética do resumo
  return calculado || (Number.isFinite(informado) ? informado : 0);
}

function tokensTexto(meta: MetaRelatorio): string {
  if (!meta.tokensEntrada && !meta.tokensSaida) return '';
  const entrada = meta.tokensEntrada?.toLocaleString('pt-BR') ?? '—';
  const saida = meta.tokensSaida?.toLocaleString('pt-BR') ?? '—';
  return ` · ${entrada} tokens de entrada / ${saida} de saída`;
}

function formatarData(data: Date): string {
  return data.toLocaleDateString('pt-BR');
}

function formatarDataHora(data: Date): string {
  return data.toLocaleString('pt-BR');
}

// ===== Estilos =====

function css(): string {
  return `
:root {
  --brand-900: #0b1e5b;
  --brand-700: #1a3bad;
  --brand-600: #2451d6;
  --brand-500: #3b6ef5;
  --brand-100: #e6edff;
  --brand-50: #f2f6ff;
  --ink-900: #0f172a;
  --ink-700: #334155;
  --ink-500: #64748b;
  --ink-200: #e2e8f0;
  --bg: #f5f7fb;
  --ok-bg: #e7f7ee; --ok-fg: #0f7b46;
  --warn-bg: #fff4e0; --warn-fg: #b26a00;
  --dang-bg: #fdecec; --dang-fg: #c62828;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--ink-900);
  font-family: 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 12px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.toolbar {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  background: rgba(255,255,255,.85);
  backdrop-filter: blur(6px);
  border-bottom: 1px solid var(--ink-200);
  z-index: 5;
}
.toolbar button {
  font: inherit;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, var(--brand-600), var(--brand-500));
  border: none;
  border-radius: 10px;
  padding: 9px 16px;
  cursor: pointer;
}
.sheet {
  max-width: 210mm;
  margin: 18px auto 40px;
  padding: 16mm 14mm;
  background: #fff;
  box-shadow: 0 18px 46px rgba(15,23,42,.12);
}

/* Capa */
.cover {
  padding: 26px 28px;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(135deg, var(--brand-900), var(--brand-600));
}
.cover-tag {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255,255,255,.18);
  margin-bottom: 12px;
}
.cover h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -.02em; }
.cover-sub { margin: 6px 0 0; font-size: 12.5px; color: rgba(255,255,255,.86); }
.cover-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,.24);
  font-size: 11px;
  color: rgba(255,255,255,.9);
}

/* KPIs */
.kpis {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 9px;
  margin: 18px 0 6px;
}
.kpi {
  padding: 12px 13px;
  border: 1px solid var(--ink-200);
  border-radius: 12px;
  background: #fff;
  border-left: 4px solid var(--brand-500);
}
.kpi.destaque { background: var(--brand-50); border-left-color: var(--brand-900); }
.kpi-valor { display: block; font-size: 21px; font-weight: 800; line-height: 1.1; }
.kpi-rotulo { display: block; margin-top: 2px; font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-500); }

/* Blocos */
.bloco { margin-top: 22px; }
.bloco h2 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 800;
  color: var(--brand-900);
  padding-bottom: 6px;
  border-bottom: 2px solid var(--brand-100);
}
.seccao-sub { margin: -4px 0 10px; font-size: 11px; color: var(--ink-500); }
.panorama { margin: 0; font-size: 12.5px; color: var(--ink-700); }
.individual {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--brand-50);
  border-left: 4px solid var(--ink-200);
  color: var(--ink-700);
}
.individual strong { font-size: 15px; color: var(--ink-900); }
.filtros { margin: 0; padding-left: 18px; color: var(--ink-700); }
.filtros li { margin-bottom: 2px; }
.filtros-vazio { margin: 0; color: var(--ink-500); }
.vazio {
  padding: 22px;
  text-align: center;
  color: var(--ink-500);
  background: var(--brand-50);
  border: 1px dashed var(--ink-200);
  border-radius: 12px;
}

/* Tabelas */
.tabela { width: 100%; border-collapse: collapse; font-size: 11px; }
.tabela th {
  text-align: left;
  padding: 8px 10px;
  background: var(--brand-900);
  color: #fff;
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.tabela th:first-child { border-radius: 8px 0 0 0; }
.tabela th:last-child { border-radius: 0 8px 0 0; }
.tabela td { padding: 7px 10px; border-bottom: 1px solid var(--ink-200); vertical-align: top; }
.tabela tbody tr:nth-child(even) { background: var(--brand-50); }
.tabela.compacta th { background: var(--brand-100); color: var(--brand-900); }
.c-id { width: 34px; font-weight: 800; color: var(--brand-700); }
.c-num { width: 52px; text-align: center; }
.c-conf { width: 104px; }
.c-tk { width: 96px; }
.c-dt { width: 70px; }
.tk { font-family: Consolas, 'SFMono-Regular', Menlo, monospace; font-size: 10.5px; font-weight: 600; }

/* Badges */
.badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  white-space: nowrap;
}
.badge.alta { background: var(--ok-bg); color: var(--ok-fg); }
.badge.media { background: var(--warn-bg); color: var(--warn-fg); }
.badge.baixa { background: var(--dang-bg); color: var(--dang-fg); }

/* Grupos */
.grupo {
  border: 1px solid var(--ink-200);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 14px;
  background: #fff;
}
.grupo-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: var(--brand-50);
  border-bottom: 1px solid var(--ink-200);
}
.grupo-id {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--brand-700), var(--brand-500));
  color: #fff;
  font-weight: 800;
  font-size: 11px;
}
.grupo-titulo { flex: 1 1 auto; min-width: 0; }
.grupo-titulo h3 { margin: 0; font-size: 13px; font-weight: 700; color: var(--ink-900); }
.grupo-local { display: block; font-size: 11px; color: var(--ink-500); }
.grupo-corpo { padding: 12px 14px; }
.campo { margin-bottom: 10px; }
.campo-rotulo {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--ink-500);
  margin-bottom: 3px;
}
.campo p { margin: 0; color: var(--ink-700); }
.resposta {
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--brand-50);
  border-left: 4px solid var(--brand-600);
}
.resposta-rotulo {
  display: block;
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .05em;
  color: var(--brand-700);
  margin-bottom: 4px;
}
.resposta p { margin: 0; color: var(--ink-900); }

/* Rodapé */
.rodape {
  margin-top: 26px;
  padding-top: 12px;
  border-top: 1px solid var(--ink-200);
  font-size: 10px;
  color: var(--ink-500);
  display: flex;
  justify-content: space-between;
  gap: 16px;
}
.rodape-tec { white-space: nowrap; }

/* Impressão / PDF */
@page { size: A4; margin: 12mm 11mm; }
@media print {
  html, body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  .sheet { margin: 0; padding: 0; max-width: none; box-shadow: none; }
  .grupo, .kpi, .cover { break-inside: avoid; page-break-inside: avoid; }
  .bloco { break-inside: auto; }
  .bloco h2 { break-after: avoid; page-break-after: avoid; }
  .detalhes .grupo:first-of-type { break-before: auto; }
  .tabela thead { display: table-header-group; }
  .tabela tr { break-inside: avoid; page-break-inside: avoid; }
  .rodape { position: static; }
}
@media (max-width: 860px) {
  .kpis { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 640px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .sheet { padding: 18px 14px; }
}
`;
}
