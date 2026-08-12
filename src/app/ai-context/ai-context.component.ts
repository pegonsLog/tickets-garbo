import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiAnalysisService, MODELOS_DISPONIVEIS, MODELO_PADRAO } from '../services/ai-analysis.service';
import { AiReportComponent } from '../ai-report/ai-report.component';
import { MetaRelatorio, RelatorioIa } from '../ai-report/ai-report.model';

/** Um campo da planilha que pode ser incluído (ou não) no contexto enviado à IA. */
export interface CampoContexto {
  /** Chave da coluna na planilha (ex.: 'DATA_ENTRADA'). */
  chave: string;
  /** Rótulo legível usado no texto gerado. */
  rotulo: string;
  incluir: boolean;
}

/** Descrição legível de um filtro aplicado na tela, para constar no cabeçalho do contexto. */
export interface FiltroAtivo {
  rotulo: string;
  valor: string;
}

/** Agrupamento preliminar por local, calculado localmente para orientar a IA. */
interface GrupoLocal {
  id: string;
  rotulo: string;
  registros: Record<string, string>[];
}

/** Instrução padrão enviada à IA antes dos dados. O usuário pode editá-la no modal. */
const INSTRUCAO_PADRAO = [
  'Você é analista de atendimento a solicitações de cidadãos.',
  'Abaixo está uma lista de tickets registrados por pessoas diferentes. Como cada pessoa descreve o problema com',
  'as próprias palavras, vários tickets podem se referir ao MESMO problema no MESMO local.',
  '',
  'Tarefa:',
  '1. Agrupe os tickets que tratam do mesmo problema no mesmo local — ou em locais tão próximos que uma única',
  '   providência atenderia todos eles.',
  '2. Para comparar, use rua, número, bairro, regional, assunto, classe e o texto da descrição. Ignore diferenças',
  '   de redação, erros de digitação, abreviações (R., Av., Jd.), maiúsculas/minúsculas e acentuação.',
  '3. Para cada grupo formado, informe:',
  '   - o local consolidado;',
  '   - os números dos tickets que o compõem;',
  '   - o problema em comum, em uma frase;',
  '   - a confiança do agrupamento (alta, média ou baixa) e o motivo;',
  '   - UMA única resposta padrão que atenda todos os tickets do grupo.',
  '4. Liste separadamente os tickets que não puderam ser agrupados e precisam de resposta individual.',
  '5. Feche com um resumo: total de tickets analisados, total de grupos e quantas respostas seriam economizadas.',
  '',
  'Entregue um relatório em Markdown, começando por uma tabela de grupos e depois o detalhamento de cada um.',
  'Os agrupamentos por local apresentados abaixo são apenas uma sugestão automática por semelhança de endereço:',
  'confirme, corrija ou descarte cada um deles com base no conteúdo das descrições.',
  'Não invente dados que não estejam nos registros.'
].join('\n');

/**
 * Monta um "pacote de contexto" com todos os registros atualmente filtrados,
 * pronto para ser colado em um chat de IA.
 *
 * O objetivo é permitir que a IA analise os registros e aponte quais poderiam ser
 * atendidos por uma única resposta — casos em que várias pessoas abriram tickets
 * diferentes para o mesmo problema no mesmo local, apenas descrevendo com outras palavras.
 *
 * Para facilitar esse trabalho, o componente já faz um agrupamento preliminar por
 * logradouro/bairro normalizados (sem acentos, sem abreviações e sem pontuação),
 * deixando as prováveis duplicidades lado a lado no texto.
 */
@Component({
  selector: 'app-ai-context',
  standalone: true,
  imports: [CommonModule, FormsModule, AiReportComponent],
  templateUrl: './ai-context.component.html',
  styleUrls: ['./ai-context.component.scss']
})
export class AiContextComponent implements OnChanges {
  /** Registros já filtrados e ordenados pela tela de listagem. */
  @Input() registros: Record<string, string>[] = [];
  /** Filtros aplicados na tela, apenas para documentar o contexto. */
  @Input() filtros: FiltroAtivo[] = [];
  /** Total da base completa, para dar noção de proporção à IA. */
  @Input() totalBase: number = 0;
  @Input() aberto: boolean = false;

  @Output() fechar = new EventEmitter<void>();

  @ViewChild('previewEl') previewEl?: ElementRef<HTMLTextAreaElement>;

  /** Campos disponíveis. Os desmarcados por padrão pesam muito e ajudam pouco na comparação. */
  campos: CampoContexto[] = [
    { chave: 'NUMERO', rotulo: 'Número', incluir: true },
    { chave: 'STATUS', rotulo: 'Status', incluir: true },
    { chave: 'DATA_ENTRADA', rotulo: 'Data de entrada', incluir: true },
    { chave: 'ORIGEM', rotulo: 'Origem', incluir: true },
    { chave: 'RESPONSAVEL', rotulo: 'Responsável', incluir: false },
    { chave: 'SOLICITANTE', rotulo: 'Solicitante', incluir: true },
    { chave: 'ASSUNTO', rotulo: 'Assunto', incluir: true },
    { chave: 'CLASSE', rotulo: 'Classe', incluir: true },
    { chave: 'RUA', rotulo: 'Rua', incluir: true },
    { chave: 'NUM', rotulo: 'Número do local', incluir: true },
    { chave: 'BAIRRO', rotulo: 'Bairro', incluir: true },
    { chave: 'REGIONAL', rotulo: 'Regional', incluir: true },
    { chave: 'DESCRICAO', rotulo: 'Descrição', incluir: true },
    { chave: 'RESPOSTA', rotulo: 'Resposta já dada', incluir: true },
    { chave: 'DATA_CRIAÇÃO', rotulo: 'Data de criação', incluir: false },
    { chave: 'DATA_ENCERRADA', rotulo: 'Data de encerramento', incluir: false }
  ];

  /** Máximo de registros levados ao contexto (0 ou vazio = todos). */
  limite: number | null = 300;
  formato: 'markdown' | 'compacto' | 'json' = 'markdown';
  /** Reordena os registros agrupando prováveis duplicidades de local. */
  agruparPorLocal: boolean = true;
  /** Inclui a instrução de análise antes dos dados. */
  incluirInstrucao: boolean = true;

  instrucao: string = INSTRUCAO_PADRAO;

  /** Texto final montado, exibido na pré-visualização. */
  texto: string = '';
  gruposDuplicados: number = 0;
  registrosNoContexto: number = 0;
  copiado: boolean = false;
  erroCopia: string = '';

  // ===== Análise pela IA (Firebase AI Logic) =====
  readonly modelosDisponiveis = MODELOS_DISPONIVEIS;
  modeloIa: string = MODELO_PADRAO;
  analisando: boolean = false;
  erroAnalise: string = '';
  relatorio: RelatorioIa | null = null;
  metaRelatorio: MetaRelatorio | null = null;
  relatorioAberto: boolean = false;

  private copiadoTimer: any = null;

  constructor(private aiAnalysis: AiAnalysisService) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Remonta o texto sempre que o modal abre ou a lista filtrada muda.
    if (changes['aberto']?.currentValue === true || (this.aberto && changes['registros'])) {
      this.gerar();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // Com o relatório aberto, o Esc deve fechar apenas o relatório
    if (this.aberto && !this.relatorioAberto) {
      this.fechar.emit();
    }
  }

  /** Campos marcados, na ordem em que aparecem na lista. */
  get camposSelecionados(): CampoContexto[] {
    return this.campos.filter(c => c.incluir);
  }

  get totalCaracteres(): number {
    return this.texto.length;
  }

  /** Estimativa grosseira de tokens (~4 caracteres por token). */
  get tokensEstimados(): number {
    return Math.ceil(this.texto.length / 4);
  }

  get caracteresLabel(): string {
    return this.totalCaracteres.toLocaleString('pt-BR');
  }

  get tokensLabel(): string {
    return this.tokensEstimados.toLocaleString('pt-BR');
  }

  get limiteAplicado(): boolean {
    return this.registrosNoContexto < this.registros.length;
  }

  restaurarInstrucao(): void {
    this.instrucao = INSTRUCAO_PADRAO;
    this.gerar();
  }

  marcarTodosCampos(incluir: boolean): void {
    this.campos.forEach(c => (c.incluir = incluir));
    this.gerar();
  }

  /** Monta o texto do contexto conforme as opções escolhidas. */
  gerar(): void {
    this.copiado = false;
    this.erroCopia = '';
    this.texto = this.construirTexto(this.incluirInstrucao);
  }

  /**
   * Constrói o texto do contexto.
   *
   * `comInstrucao = false` devolve apenas os dados: é o formato usado na análise
   * pelo Firebase AI, em que a instrução é enviada separadamente (systemInstruction).
   */
  private construirTexto(comInstrucao: boolean): string {
    const limite = this.limite && this.limite > 0 ? Math.floor(this.limite) : this.registros.length;
    const selecionados = this.registros.slice(0, limite);
    this.registrosNoContexto = selecionados.length;

    const grupos = this.agruparPorLocal ? this.montarGrupos(selecionados) : [];
    this.gruposDuplicados = grupos.filter(g => g.registros.length > 1).length;

    if (selecionados.length === 0) {
      return '';
    }

    if (this.formato === 'json') {
      return this.montarJson(selecionados, grupos, comInstrucao);
    }

    const partes: string[] = [];
    if (comInstrucao && this.instrucao.trim()) {
      partes.push(this.instrucao.trim(), '');
    }
    partes.push(this.montarCabecalho(selecionados.length), '');
    partes.push(this.agruparPorLocal ? this.montarCorpoAgrupado(grupos) : this.montarCorpoSimples(selecionados));

    return partes.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ===== Montagem do texto =====

  private montarCabecalho(quantidade: number): string {
    const linhas: string[] = ['## Dados', ''];
    linhas.push(`- Registros neste contexto: ${quantidade}`);
    if (this.totalBase > 0) {
      linhas.push(`- Registros na base completa: ${this.totalBase}`);
    }
    if (this.limiteAplicado) {
      linhas.push(`- Atenção: o resultado filtrado tem ${this.registros.length} registros e foi limitado aos ${quantidade} primeiros.`);
    }
    linhas.push(`- Gerado em: ${new Date().toLocaleString('pt-BR')}`);
    linhas.push('- Filtros aplicados na consulta:');
    if (this.filtros.length === 0) {
      linhas.push('  - nenhum (base completa)');
    } else {
      this.filtros.forEach(f => linhas.push(`  - ${f.rotulo}: ${f.valor}`));
    }
    return linhas.join('\n');
  }

  private montarCorpoSimples(registros: Record<string, string>[]): string {
    const blocos = registros.map((r, i) => this.montarRegistro(r, i + 1));
    return ['## Registros', '', blocos.join('\n')].join('\n');
  }

  private montarCorpoAgrupado(grupos: GrupoLocal[]): string {
    const linhas: string[] = ['## Registros agrupados por semelhança de local', ''];
    let indice = 0;
    grupos.forEach(grupo => {
      const marca = grupo.registros.length > 1 ? ' — possível duplicidade' : '';
      linhas.push(`### Local ${grupo.id}: ${grupo.rotulo} (${grupo.registros.length} registro(s)${marca})`);
      linhas.push('');
      grupo.registros.forEach(r => {
        indice++;
        linhas.push(this.montarRegistro(r, indice));
      });
    });
    return linhas.join('\n');
  }

  private montarRegistro(registro: Record<string, string>, indice: number): string {
    const campos = this.camposSelecionados;

    if (this.formato === 'compacto') {
      const pares = campos
        .map(c => ({ c, v: this.valor(registro, c.chave) }))
        .filter(p => p.v !== '')
        .map(p => `${p.c.rotulo}: ${p.v.replace(/\s*\|\s*/g, ' / ').replace(/\s*\n\s*/g, ' ')}`);
      return `[${indice}] ${pares.join(' | ')}`;
    }

    // Markdown: identificação no título e demais campos em lista
    const numero = this.valor(registro, 'NUMERO') || 'sem número';
    const linhas: string[] = [`#### [${indice}] Ticket ${numero}`];
    campos.forEach(campo => {
      if (campo.chave === 'NUMERO') return;
      const v = this.valor(registro, campo.chave);
      if (!v) return;
      linhas.push(v.includes('\n')
        ? `- **${campo.rotulo}:**\n${v.split('\n').map(l => `  ${l.trim()}`).join('\n')}`
        : `- **${campo.rotulo}:** ${v}`);
    });
    linhas.push('');
    return linhas.join('\n');
  }

  private montarJson(registros: Record<string, string>[], grupos: GrupoLocal[], comInstrucao: boolean): string {
    const grupoPorRegistro = new Map<Record<string, string>, GrupoLocal>();
    grupos.forEach(g => g.registros.forEach(r => grupoPorRegistro.set(r, g)));

    const ordenados = this.agruparPorLocal ? grupos.flatMap(g => g.registros) : registros;

    const dados = {
      instrucao: comInstrucao ? this.instrucao.trim() : undefined,
      meta: {
        gerado_em: new Date().toISOString(),
        registros_no_contexto: registros.length,
        registros_no_resultado_filtrado: this.registros.length,
        registros_na_base: this.totalBase || undefined,
        filtros: this.filtros.length
          ? this.filtros.reduce<Record<string, string>>((acc, f) => ({ ...acc, [f.rotulo]: f.valor }), {})
          : 'nenhum (base completa)',
        agrupamento_preliminar_por_local: this.agruparPorLocal,
        grupos_com_possivel_duplicidade: this.gruposDuplicados
      },
      registros: ordenados.map((r, i) => {
        const item: Record<string, string | number> = { indice: i + 1 };
        if (this.agruparPorLocal) {
          const g = grupoPorRegistro.get(r);
          if (g) {
            item['grupo_local'] = g.id;
          }
        }
        this.camposSelecionados.forEach(campo => {
          const v = this.valor(r, campo.chave);
          if (v) {
            item[campo.chave] = v;
          }
        });
        return item;
      })
    };

    return JSON.stringify(dados, null, 2);
  }

  private valor(registro: Record<string, string>, chave: string): string {
    return (registro[chave] ?? '').trim();
  }

  // ===== Agrupamento preliminar por local =====

  /**
   * Agrupa por logradouro + bairro normalizados. Grupos com mais de um registro
   * (prováveis duplicidades) vêm primeiro, dos maiores para os menores.
   */
  private montarGrupos(registros: Record<string, string>[]): GrupoLocal[] {
    const mapa = new Map<string, Record<string, string>[]>();
    const rotulos = new Map<string, string>();

    registros.forEach(r => {
      const rua = this.valor(r, 'RUA');
      const bairro = this.valor(r, 'BAIRRO');
      const chave = `${this.normalizarLogradouro(rua)}|${this.normalizarTexto(bairro)}`;

      if (!mapa.has(chave)) {
        mapa.set(chave, []);
        const partes = [rua || 'Local não informado'];
        if (bairro) partes.push(bairro);
        rotulos.set(chave, partes.join(' — '));
      }
      mapa.get(chave)!.push(r);
    });

    const grupos: GrupoLocal[] = Array.from(mapa.entries()).map(([chave, itens]) => ({
      id: '',
      rotulo: rotulos.get(chave) ?? 'Local não informado',
      registros: itens
    }));

    // Maiores grupos primeiro; empates mantêm a ordem alfabética do local
    grupos.sort((a, b) => b.registros.length - a.registros.length
      || a.rotulo.localeCompare(b.rotulo, 'pt-BR', { sensitivity: 'base' }));

    grupos.forEach((g, i) => (g.id = `L${i + 1}`));
    return grupos;
  }

  /** Remove acentos, pontuação e espaços duplicados, deixando tudo em minúsculas. */
  private normalizarTexto(valor: string): string {
    return (valor ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Normaliza o logradouro descartando o tipo da via (rua, av., travessa...). */
  private normalizarLogradouro(rua: string): string {
    const s = this.normalizarTexto(rua);
    return s.replace(
      /^(r|rua|av|avenida|al|alameda|tv|trav|travessa|pc|praca|estr|estrada|rod|rodovia|lgo|largo|vl|vila|jd|jardim)\s+/,
      ''
    );
  }

  // ===== Ações =====

  /** Copia o contexto para a área de transferência, com alternativa para navegadores antigos. */
  async copiar(): Promise<void> {
    if (!this.texto) return;
    this.erroCopia = '';
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(this.texto);
      } else if (!this.copiarViaSelecao()) {
        throw new Error('sem suporte');
      }
      this.sinalizarCopia();
    } catch {
      if (this.copiarViaSelecao()) {
        this.sinalizarCopia();
      } else {
        this.erroCopia = 'Não foi possível copiar automaticamente. Selecione o texto abaixo e copie com Ctrl+C.';
      }
    }
  }

  private copiarViaSelecao(): boolean {
    const el = this.previewEl?.nativeElement;
    if (!el) return false;
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    el.setSelectionRange(0, 0);
    return ok;
  }

  private sinalizarCopia(): void {
    this.copiado = true;
    clearTimeout(this.copiadoTimer);
    this.copiadoTimer = setTimeout(() => (this.copiado = false), 3000);
  }

  /**
   * Envia os registros para a IA do Firebase e abre o relatório resultante.
   *
   * Enviamos apenas os dados: as regras de análise vão como systemInstruction e o
   * formato da resposta é imposto por responseSchema, dentro do serviço.
   */
  async analisar(): Promise<void> {
    if (this.analisando || this.registros.length === 0) return;

    this.analisando = true;
    this.erroAnalise = '';
    this.relatorio = null;
    this.metaRelatorio = null;

    try {
      const dados = this.construirTexto(false);
      const resultado = await this.aiAnalysis.analisar(dados, this.modeloIa);

      this.relatorio = resultado.relatorio;
      this.metaRelatorio = {
        geradoEm: new Date(),
        modelo: resultado.modelo,
        registrosAnalisados: this.registrosNoContexto,
        filtros: this.filtros,
        tokensEntrada: resultado.tokensEntrada,
        tokensSaida: resultado.tokensSaida
      };
      this.relatorioAberto = true;
    } catch (erro: any) {
      this.erroAnalise = erro?.message || 'Não foi possível concluir a análise.';
    } finally {
      this.analisando = false;
    }
  }

  fecharRelatorio(): void {
    this.relatorioAberto = false;
  }

  /** Reabre o último relatório gerado, sem consumir uma nova chamada à IA. */
  reabrirRelatorio(): void {
    if (this.relatorio) {
      this.relatorioAberto = true;
    }
  }

  /** Baixa o contexto como arquivo, para anexar no chat da IA. */
  baixar(): void {
    if (!this.texto) return;
    const ext = this.formato === 'json' ? 'json' : 'md';
    const tipo = this.formato === 'json' ? 'application/json' : 'text/markdown';
    const dataStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([this.texto], { type: `${tipo};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `contexto-tickets-${dataStr}.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
