import { cssBaseRelatorio, escaparHtml as esc, multilinhaHtml } from '../shared/report-css';
import {
  ItemAuditoria,
  META_ATINGIDA,
  META_PARCIAL,
  ROTULO_META,
  ROTULO_SITUACAO_AUDITADA,
  ResultadoAuditoria,
  SituacaoAuditada,
  avaliarMeta,
  descreverPeriodo
} from './audit.model';

/**
 * Monta o documento HTML do relatório de auditoria do acompanhamento.
 * Todo texto dinâmico (do PDF, do Firestore e da IA) é escapado.
 */
export function montarAuditoriaHtml(r: ResultadoAuditoria): string {
  const meta = avaliarMeta(r.percentualComAtividade);
  const classeMeta = meta === 'atingida' ? 'bom' : meta === 'parcial' ? 'atencao' : 'ruim';
  const classeSelo = meta === 'atingida' ? 'ok' : meta === 'parcial' ? 'andamento' : 'ruim';
  const emAndamento = r.comAtividade - r.concluidos;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(`Auditoria do acompanhamento — ${r.geradoEm.toLocaleDateString('pt-BR')}`)}</title>
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
    <h1>Auditoria do acompanhamento</h1>
    <p class="cover-sub">Verificação das atividades registradas nos tickets encaminhados para andamento</p>
    <div class="cover-meta">
      <span>Período: ${esc(descreverPeriodo(r.periodo))}</span>
      <span>Arquivo: ${esc(r.arquivo)}</span>
      <span>Gerado em ${esc(r.geradoEm.toLocaleString('pt-BR'))}</span>
    </div>
  </header>

  <section class="meta-faixa ${classeMeta}">
    <div>
      <span class="badge ${classeSelo}">${esc(ROTULO_META[meta])}</span>
      <p>
        <strong>${r.percentualComAtividade}%</strong> dos tickets da relação tiveram ao menos uma atividade registrada.
      </p>
    </div>
    <div class="barra" role="img" aria-label="${r.percentualComAtividade}% com atividade">
      <span style="width:${limitar(r.percentualComAtividade)}%"></span>
      <i style="left:${META_PARCIAL}%"></i>
      <i style="left:${META_ATINGIDA}%"></i>
    </div>
    <small>Referência: ${META_ATINGIDA}% ou mais = meta atingida · ${META_PARCIAL}% a ${META_ATINGIDA - 1}% = parcial · abaixo de ${META_PARCIAL}% = não atingida</small>
  </section>

  <section class="kpis">
    ${kpi(String(r.totalNoPdf), 'Tickets na relação')}
    ${kpi(`${r.comAtividade}`, `Com atividade (${r.percentualComAtividade}%)`, 'bom')}
    ${kpi(`${r.concluidos}`, `Concluídos (${r.percentualConcluidos}%)`, 'destaque')}
    ${kpi(String(emAndamento), 'Só em andamento', 'atencao')}
    ${kpi(String(r.semAtividade), 'Sem atividade', r.semAtividade > 0 ? 'ruim' : '')}
  </section>

  ${r.parecer ? `<section class="bloco">
    <h2>Parecer</h2>
    <p class="parecer">${multilinhaHtml(r.parecer)}</p>
  </section>` : ''}

  ${producaoHtml(r)}

  <section class="bloco">
    <h2>Situação de cada ticket</h2>
    <p class="seccao-sub">Os tickets sem atividade aparecem primeiro.</p>
    <table class="tabela">
      <thead>
        <tr>
          <th class="c-tk">Número</th>
          <th>Assunto</th>
          <th class="c-sit">Situação</th>
          <th class="c-num">Ativ.</th>
          <th class="c-dt">Última</th>
          <th class="c-usr">Realizada por</th>
        </tr>
      </thead>
      <tbody>
        ${r.itens.map(linhaItem).join('')}
      </tbody>
    </table>
  </section>

  ${observacoesHtml(r)}

  <footer class="rodape">
    <div>
      Números extraídos do PDF por IA (${esc(r.modelo)}) e cruzados automaticamente com as atividades registradas.
      Quantitativos calculados pela aplicação; o parecer é gerado por IA a partir deles.
      O nome de quem realizou cada atividade é informado por quem a registrou.
    </div>
    <div class="rodape-tec">${esc(r.geradoEm.toLocaleString('pt-BR'))}</div>
  </footer>
</div>
</body>
</html>`;
}

function kpi(valor: string, rotulo: string, classe = ''): string {
  return `<div class="kpi ${classe}">
    <span class="kpi-valor">${esc(valor)}</span>
    <span class="kpi-rotulo">${esc(rotulo)}</span>
  </div>`;
}

function producaoHtml(r: ResultadoAuditoria): string {
  if (!r.porUsuario.length) {
    return `<section class="bloco">
      <h2>Produção por pessoa</h2>
      <div class="vazio">Nenhuma atividade foi registrada nos tickets da relação${r.periodo.inicio || r.periodo.fim ? ' no período' : ''}.</div>
    </section>`;
  }
  const maximo = Math.max(...r.porUsuario.map(u => u.atividades), 1);
  return `<section class="bloco">
    <h2>Produção por pessoa</h2>
    <p class="seccao-sub">Atividades registradas nos tickets da relação${r.periodo.inicio || r.periodo.fim ? ', dentro do período' : ''}.</p>
    <table class="tabela compacta">
      <thead>
        <tr><th>Pessoa</th><th class="c-num">Tickets</th><th class="c-num">Ativ.</th><th class="c-num">Concl.</th><th class="c-graf">Volume</th></tr>
      </thead>
      <tbody>
        ${r.porUsuario.map(u => `<tr>
          <td>${esc(u.usuario)}</td>
          <td class="c-num">${u.tickets}</td>
          <td class="c-num">${u.atividades}</td>
          <td class="c-num">${u.concluidas}</td>
          <td class="c-graf"><span class="mini"><span style="width:${limitar(Math.round((u.atividades / maximo) * 100))}%"></span></span></td>
        </tr>`).join('')}
      </tbody>
    </table>
  </section>`;
}

function linhaItem(i: ItemAuditoria): string {
  const ultima = i.ultimaAtividadeData
    ? i.ultimaAtividadeData.split('-').reverse().join('/') + (i.ultimaAtividadeHora ? ` ${i.ultimaAtividadeHora}` : '')
    : '—';
  const atividades = i.acompanhado ? `${i.atividadesConcluidas}/${i.totalAtividades}` : '—';
  const pessoas = i.usuarios.length > 1
    ? `${esc(i.ultimaAtividadeUsuario || i.usuarios[0])} <span class="mais">+${i.usuarios.length - 1}</span>`
    : esc(i.ultimaAtividadeUsuario || '—');
  return `<tr>
    <td class="c-tk"><span class="tk">${esc(i.numero)}</span></td>
    <td>${esc(i.assunto || '—')}</td>
    <td class="c-sit">${selo(i.situacao)}</td>
    <td class="c-num" title="concluídas/total">${atividades}</td>
    <td class="c-dt">${esc(ultima)}</td>
    <td class="c-usr">${pessoas}</td>
  </tr>`;
}

function observacoesHtml(r: ResultadoAuditoria): string {
  const notas: string[] = [];
  if (r.naoAcompanhados > 0) {
    notas.push(`<strong>${r.naoAcompanhados}</strong> ticket(s) da relação não foram levados para acompanhamento e, por isso, não têm atividades registradas no sistema.`);
  }
  if (r.acompanhadosForaDoPdf > 0) {
    notas.push(`<strong>${r.acompanhadosForaDoPdf}</strong> ticket(s) estão em acompanhamento mas não constam nesta relação.`);
  }
  if (!notas.length) return '';
  return `<section class="bloco">
    <h2>Observações</h2>
    <ul class="notas">${notas.map(n => `<li>${n}</li>`).join('')}</ul>
  </section>`;
}

function selo(s: SituacaoAuditada): string {
  const classe = s === 'concluido' ? 'ok' : s === 'em_andamento' ? 'andamento' : s === 'sem_atividade' ? 'ruim' : 'neutro';
  return `<span class="badge ${classe}">${esc(ROTULO_SITUACAO_AUDITADA[s])}</span>`;
}

function limitar(valor: number): number {
  return Math.min(Math.max(Math.round(valor), 0), 100);
}

function css(): string {
  return cssBaseRelatorio() + `
.meta-faixa {
  margin-top: 18px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid var(--ink-200);
  border-left: 5px solid var(--brand-500);
  background: #fff;
}
.meta-faixa.bom { border-left-color: var(--ok-fg); }
.meta-faixa.atencao { border-left-color: var(--warn-fg); }
.meta-faixa.ruim { border-left-color: var(--dang-fg); }
.meta-faixa > div:first-child { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.meta-faixa p { margin: 0; font-size: 12.5px; color: var(--ink-700); }
.meta-faixa strong { font-size: 15px; color: var(--ink-900); }
.meta-faixa small { display: block; margin-top: 6px; font-size: 9.5px; color: var(--ink-500); }
.barra {
  position: relative;
  height: 10px;
  margin-top: 10px;
  border-radius: 999px;
  background: var(--brand-100);
  overflow: hidden;
}
.barra span {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--brand-600), var(--brand-500));
}
.barra i { position: absolute; top: 0; bottom: 0; width: 2px; background: rgba(15,23,42,.35); }
.parecer { margin: 0; font-size: 12.5px; color: var(--ink-700); }
.c-sit { width: 128px; }
.c-usr { width: 130px; }
.c-graf { width: 120px; }
.mais {
  display: inline-block;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--brand-100);
  color: var(--brand-700);
  font-size: 9.5px;
  font-weight: 700;
}
.mini { display: block; height: 7px; border-radius: 999px; background: var(--brand-100); overflow: hidden; }
.mini span { display: block; height: 100%; background: var(--brand-600); border-radius: 999px; }
.notas { margin: 0; padding-left: 18px; color: var(--ink-700); }
.notas li { margin-bottom: 4px; }
@media print {
  .meta-faixa { break-inside: avoid; page-break-inside: avoid; }
}
`;
}
