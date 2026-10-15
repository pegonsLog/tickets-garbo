/**
 * CSS base compartilhado pelos relatórios em HTML (similaridade e auditoria).
 *
 * Fica em um único lugar para que os dois relatórios tenham a mesma identidade
 * visual e as mesmas regras de impressão em A4. Cada relatório acrescenta,
 * depois, apenas o CSS dos seus blocos próprios.
 */
export function cssBaseRelatorio(): string {
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

/* Indicadores */
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
.kpi.bom { border-left-color: var(--ok-fg); }
.kpi.atencao { border-left-color: var(--warn-fg); }
.kpi.ruim { border-left-color: var(--dang-fg); }
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

/* Selos */
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
.badge.alta, .badge.ok { background: var(--ok-bg); color: var(--ok-fg); }
.badge.media, .badge.andamento { background: var(--warn-bg); color: var(--warn-fg); }
.badge.baixa, .badge.ruim { background: var(--dang-bg); color: var(--dang-fg); }
.badge.neutro { background: var(--bg); color: var(--ink-500); }

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
  .grupo, .kpi, .cover, .card { break-inside: avoid; page-break-inside: avoid; }
  .bloco { break-inside: auto; }
  .bloco h2 { break-after: avoid; page-break-after: avoid; }
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

/** Escapa caracteres com significado em HTML. Use em todo texto dinâmico. */
export function escaparHtml(valor: string): string {
  return (valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapa e preserva as quebras de linha do texto. */
export function multilinhaHtml(valor: string): string {
  return escaparHtml(valor).replace(/\r?\n/g, '<br>');
}
