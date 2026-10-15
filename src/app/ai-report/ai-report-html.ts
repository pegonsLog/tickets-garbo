import { GrupoRelatorio, MetaRelatorio, RelatorioIa } from './ai-report.model';
import { cssBaseRelatorio, escaparHtml, multilinhaHtml } from '../shared/report-css';

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
const esc = escaparHtml;

/** Escapa e preserva as quebras de linha do texto. */
const multilinha = multilinhaHtml;

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

/** CSS base compartilhado + apenas os blocos próprios do relatório de similaridade. */
function css(): string {
  return cssBaseRelatorio() + `
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

@media print {
  .detalhes .grupo:first-of-type { break-before: auto; }
}
`;
}
