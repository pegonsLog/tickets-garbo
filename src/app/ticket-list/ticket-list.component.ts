import { Component, OnInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { GoogleSheetsService, SheetData } from '../services/google-sheets.service';
import { TruncateTooltipDirective } from '../shared/truncate-tooltip.directive';
import { AiContextComponent, FiltroAtivo } from '../ai-context/ai-context.component';
import { FirestoreTrackingService } from '../services/firestore-tracking.service';
import { TicketTrackingComponent } from '../tracking/ticket-tracking.component';
import { TrackingAuditComponent } from '../tracking/tracking-audit.component';
import { chaveNumero } from '../tracking/audit.model';
import {
  ROTULO_STATUS_ATUAL, StatusAtual, TicketAcompanhado, dataHoraLegivel, statusAtualDe
} from '../tracking/tracking.model';

type FiltroAcompanhamento = 'TODOS' | 'ACOMPANHADOS' | 'NAO_ACOMPANHADOS' | StatusAtual;

/** Chave de comparação de nomes: sem acentos, minúsculas e espaços simples. */
function chaveNome(nome: string): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Lista de nomes sem repetição, em ordem alfabética.
 * "Maria Silva", "maria  silva" e "María Silva" viram uma única opção
 * (mantém a primeira grafia encontrada).
 */
function nomesDistintos(nomes: string[]): string[] {
  const porChave = new Map<string, string>();
  nomes.forEach(n => {
    const limpo = (n ?? '').replace(/\s+/g, ' ').trim();
    const chave = chaveNome(limpo);
    if (chave && !porChave.has(chave)) porChave.set(chave, limpo);
  });
  return Array.from(porChave.values()).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

@Component({
  selector: 'app-ticket-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, TruncateTooltipDirective, AiContextComponent,
    TicketTrackingComponent, TrackingAuditComponent
  ],
  templateUrl: './ticket-list.component.html',
  styleUrls: ['./ticket-list.component.scss']
})
export class TicketListComponent implements OnInit {
  // Planilha oficial de tickets (aba ABERTAS)
  private readonly spreadsheetId = '1olwRI5-sZ_SsD9yQUZPj6iim7vCajNRM7BotV7w2a5E';
  private readonly sheetName = 'ABERTAS';

  allTickets: Record<string, string>[] = [];
  filteredTickets: Record<string, string>[] = [];

  statusOptions: string[] = [];
  responsavelOptions: string[] = [];
  origemOptions: string[] = [];
  assuntoOptions: string[] = [];

  numeroFilter: string = '';
  statusFilter: string = 'TODOS';
  responsavelFilter: string = 'TODOS';
  origemFilter: string = 'TODOS';
  assuntoFilter: string = '';
  solicitanteFilter: string = '';
  localFilter: string = '';
  dataInicioFilter: string = '';
  dataFimFilter: string = '';
  /**
   * Filtro de acompanhamento:
   * TODOS | ACOMPANHADOS (qualquer status) | NAO_ACOMPANHADOS | um StatusAtual específico.
   */
  acompanhamentoFilter: FiltroAcompanhamento = 'TODOS';
  /** Quem registrou a atividade mais recente ('TODOS' = sem filtro). */
  ultimoUsuarioFilter: string = 'TODOS';
  /** Nomes distintos de quem fez a última atividade, montados a partir do Firestore. */
  ultimoUsuarioOptions: string[] = [];

  readonly opcoesAcompanhamento: { valor: FiltroAcompanhamento; rotulo: string }[] = [
    { valor: 'TODOS', rotulo: 'Acompanhamento: todos' },
    { valor: 'ACOMPANHADOS', rotulo: 'Em acompanhamento' },
    { valor: 'aguardando', rotulo: '— Aguardando atividade' },
    { valor: 'em_andamento', rotulo: '— Em andamento' },
    { valor: 'concluida', rotulo: '— Concluída' },
    { valor: 'NAO_ACOMPANHADOS', rotulo: 'Não acompanhados' }
  ];

  expandedIndex: number | null = null;

  // ===== Ordenação =====
  /** Coluna atualmente ordenada (chave da planilha) ou null para ordem original. */
  sortColumn: string | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';
  /** Colunas que devem ser comparadas como data, não como texto. */
  private readonly dateColumns = ['DATA_ENTRADA', 'DATA_CRIAÇÃO', 'DATA_ENCERRADA'];

  loading: boolean = false;
  error: string = '';

  // ===== Relatório =====
  reportModalOpen: boolean = false;

  repInicio: string = '';
  repFim: string = '';
  repResponsavel: string = 'TODOS';
  repStatus: string = 'TODOS';
  repOrigem: string = 'TODOS';
  repAssunto: string = '';
  repSolicitante: string = '';
  repLocal: string = '';
  repQtd: number | null = 200;
  repOrdem: 'recentes' | 'antigas' = 'recentes';

  reportRows: Record<string, string>[] | null = null;
  reportGeneratedAt: Date | null = null;

  // ===== Contexto para IA =====
  contextoModalOpen: boolean = false;

  // ===== Acompanhamento (Firestore) =====
  /** Resumo dos tickets em acompanhamento, indexado pela chave numérica (só dígitos). */
  private acompanhados = new Map<string, TicketAcompanhado>();
  /** Número do ticket sendo enviado ao Firestore, para mostrar o carregamento no botão. */
  enviandoNumero: string | null = null;
  acompanhamentoNumero: string = '';
  acompanhamentoAberto: boolean = false;
  auditoriaAberta: boolean = false;
  erroAcompanhamento: string = '';

  // Largura da tabela para dimensionar a barra de rolagem superior
  @ViewChild('tableEl') tableEl?: ElementRef<HTMLElement>;
  contentWidth = 0;

  constructor(
    private googleSheetsService: GoogleSheetsService,
    private tracking: FirestoreTrackingService
  ) {}

  ngOnInit(): void {
    this.carregarTickets();
    this.carregarAcompanhados();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.updateContentWidth();
  }

  /** Recalcula a largura da tabela (para dimensionar a barra superior). */
  private updateContentWidth(): void {
    // Agendado fora do ciclo de CD para evitar reflows repetidos
    setTimeout(() => {
      this.contentWidth = this.tableEl?.nativeElement.scrollWidth ?? 0;
    });
  }

  /** Sincroniza a rolagem entre a barra superior e o container da tabela. */
  syncScroll(source: HTMLElement, target: HTMLElement): void {
    if (target.scrollLeft !== source.scrollLeft) {
      target.scrollLeft = source.scrollLeft;
    }
  }

  carregarTickets(): void {
    this.loading = true;
    this.error = '';
    this.expandedIndex = null;
    this.googleSheetsService.getSheetData(this.spreadsheetId, this.sheetName).subscribe({
      next: (data: SheetData) => {
        this.allTickets = data.rows;
        this.statusOptions = this.getValoresUnicos('STATUS');
        this.responsavelOptions = this.getValoresUnicos('RESPONSAVEL');
        this.origemOptions = this.getValoresUnicos('ORIGEM');
        this.assuntoOptions = this.getValoresUnicos('ASSUNTO');
        this.aplicarFiltros();
        this.loading = false;
        this.updateContentWidth();
      },
      error: (err: any) => {
        this.error = err.message || 'Erro ao carregar os tickets.';
        this.loading = false;
      }
    });
  }

  private getValoresUnicos(coluna: string): string[] {
    const valores = new Set<string>();
    this.allTickets.forEach(row => {
      const valor = (row[coluna] ?? '').trim();
      if (valor) {
        valores.add(valor);
      }
    });
    return Array.from(valores).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Converte uma data em texto (dd/mm/yyyy, dd-mm-yyyy ou yyyy-mm-dd) para
   * timestamp em milissegundos. Retorna null se não conseguir interpretar.
   */
  private parseDataToTs(str: string): number | null {
    if (!str) return null;
    const s = str.trim();
    const br = s.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
    if (br) {
      const [, d, m, y] = br;
      const t = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
      return isNaN(t) ? null : t;
    }
    const iso = s.match(/^(\d{4})[\/-](\d{2})[\/-](\d{2})/);
    if (iso) {
      const [, y, m, d] = iso;
      const t = new Date(Number(y), Number(m) - 1, Number(d)).getTime();
      return isNaN(t) ? null : t;
    }
    return null;
  }

  aplicarFiltros(): void {
    const numero = this.numeroFilter.trim().toLowerCase();
    const assunto = this.assuntoFilter.trim().toLowerCase();
    const solicitante = this.solicitanteFilter.trim().toLowerCase();
    const local = this.localFilter.trim().toLowerCase();
    // Campos de data (type=date) chegam como yyyy-mm-dd
    const inicioTs = this.dataInicioFilter ? this.parseDataToTs(this.dataInicioFilter) : null;
    const fimTs = this.dataFimFilter ? this.parseDataToTs(this.dataFimFilter) : null;

    this.filteredTickets = this.allTickets.filter(row => {
      const numeroMatch = !numero || (row['NUMERO'] ?? '').toLowerCase().includes(numero);
      const statusMatch = this.statusFilter === 'TODOS' || row['STATUS'] === this.statusFilter;
      const responsavelMatch = this.responsavelFilter === 'TODOS' || row['RESPONSAVEL'] === this.responsavelFilter;
      const origemMatch = this.origemFilter === 'TODOS' || row['ORIGEM'] === this.origemFilter;
      const assuntoMatch = !assunto || (row['ASSUNTO'] ?? '').toLowerCase().includes(assunto);
      const solicitanteMatch = !solicitante || (row['SOLICITANTE'] ?? '').toLowerCase().includes(solicitante);
      // Local considera rua, número e bairro
      const localMatch = !local || [row['RUA'], row['NUM'], row['BAIRRO']]
        .map(v => (v ?? '').toLowerCase())
        .join(' ')
        .includes(local);

      let periodoMatch = true;
      if (inicioTs !== null || fimTs !== null) {
        const dataTs = this.parseDataToTs(row['DATA_ENTRADA'] ?? '');
        if (dataTs === null) {
          periodoMatch = false;
        } else {
          if (inicioTs !== null && dataTs < inicioTs) periodoMatch = false;
          if (fimTs !== null && dataTs > fimTs) periodoMatch = false;
        }
      }

      return numeroMatch && statusMatch && responsavelMatch && origemMatch && assuntoMatch
        && solicitanteMatch && localMatch && periodoMatch
        && this.passaFiltroAcompanhamento(row) && this.passaFiltroUltimoUsuario(row);
    });
    this.aplicarOrdenacao();
    this.expandedIndex = null;
    this.updateContentWidth();
  }

  private passaFiltroAcompanhamento(row: Record<string, string>): boolean {
    const filtro = this.acompanhamentoFilter;
    if (filtro === 'TODOS') return true;
    const status = this.statusAcompanhamento(row);
    if (filtro === 'ACOMPANHADOS') return status !== null;
    if (filtro === 'NAO_ACOMPANHADOS') return status === null;
    return status === filtro;
  }

  /** Compara nomes ignorando maiúsculas, acentos e espaços extras. */
  private passaFiltroUltimoUsuario(row: Record<string, string>): boolean {
    if (this.ultimoUsuarioFilter === 'TODOS') return true;
    return chaveNome(this.quemEstaCom(row)) === chaveNome(this.ultimoUsuarioFilter);
  }

  /** Ordena a lista filtrada conforme a coluna/direção selecionadas no cabeçalho. */
  private aplicarOrdenacao(): void {
    const coluna = this.sortColumn;
    if (!coluna) return;

    const fator = this.sortDirection === 'asc' ? 1 : -1;
    const isData = this.dateColumns.includes(coluna);

    this.filteredTickets = [...this.filteredTickets].sort((a, b) => {
      const va = (a[coluna] ?? '').trim();
      const vb = (b[coluna] ?? '').trim();

      // Valores vazios sempre no fim, independente da direção
      if (!va && !vb) return 0;
      if (!va) return 1;
      if (!vb) return -1;

      if (isData) {
        const ta = this.parseDataToTs(va);
        const tb = this.parseDataToTs(vb);
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return (ta - tb) * fator;
      }

      return va.localeCompare(vb, 'pt-BR', { numeric: true, sensitivity: 'base' }) * fator;
    });
  }

  /**
   * Alterna a ordenação da coluna: asc -> desc -> sem ordenação.
   */
  ordenarPor(coluna: string): void {
    if (this.sortColumn !== coluna) {
      this.sortColumn = coluna;
      this.sortDirection = 'asc';
    } else if (this.sortDirection === 'asc') {
      this.sortDirection = 'desc';
    } else {
      // Terceiro clique remove a ordenação e volta à ordem da planilha
      this.sortColumn = null;
      this.sortDirection = 'asc';
    }
    this.aplicarFiltros();
  }

  /** Ícone exibido no cabeçalho conforme o estado de ordenação da coluna. */
  sortIcon(coluna: string): string {
    if (this.sortColumn !== coluna) return 'unfold_more';
    return this.sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  limparFiltros(): void {
    this.numeroFilter = '';
    this.statusFilter = 'TODOS';
    this.responsavelFilter = 'TODOS';
    this.origemFilter = 'TODOS';
    this.assuntoFilter = '';
    this.solicitanteFilter = '';
    this.localFilter = '';
    this.dataInicioFilter = '';
    this.dataFimFilter = '';
    this.acompanhamentoFilter = 'TODOS';
    this.ultimoUsuarioFilter = 'TODOS';
    this.aplicarFiltros();
  }

  toggleExpand(index: number): void {
    this.expandedIndex = this.expandedIndex === index ? null : index;
  }

  get hasActiveFilters(): boolean {
    return this.numeroFilter.trim() !== ''
      || this.statusFilter !== 'TODOS'
      || this.responsavelFilter !== 'TODOS'
      || this.origemFilter !== 'TODOS'
      || this.assuntoFilter.trim() !== ''
      || this.solicitanteFilter.trim() !== ''
      || this.localFilter.trim() !== ''
      || this.dataInicioFilter !== ''
      || this.dataFimFilter !== ''
      || this.acompanhamentoFilter !== 'TODOS'
      || this.ultimoUsuarioFilter !== 'TODOS';
  }

  private countByStatus(list: Record<string, string>[], status: string): number {
    return list.filter(t => (t['STATUS'] ?? '').toUpperCase() === status).length;
  }

  // Totais (base completa)
  get totalCount(): number {
    return this.allTickets.length;
  }

  get abertasCount(): number {
    return this.countByStatus(this.allTickets, 'ABERTA');
  }

  get encerradasCount(): number {
    return this.countByStatus(this.allTickets, 'ENCERRADA');
  }

  // Totais do resultado filtrado
  get filteredCount(): number {
    return this.filteredTickets.length;
  }

  get filteredAbertasCount(): number {
    return this.countByStatus(this.filteredTickets, 'ABERTA');
  }

  get filteredEncerradasCount(): number {
    return this.countByStatus(this.filteredTickets, 'ENCERRADA');
  }

  statusClass(status: string): string {
    const s = (status ?? '').toUpperCase();
    if (s === 'ABERTA') return 'badge badge-open';
    if (s === 'ENCERRADA') return 'badge badge-closed';
    return 'badge badge-neutral';
  }

  iniciais(nome: string): string {
    const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean);
    if (partes.length === 0) return '?';
    if (partes.length === 1) return partes[0].charAt(0).toUpperCase();
    return (partes[0].charAt(0) + partes[partes.length - 1].charAt(0)).toUpperCase();
  }

  // ===== Acompanhamento =====

  /**
   * Carrega o resumo dos tickets acompanhados (status atual e quem está com o ticket).
   * Uma única consulta: o resumo fica no próprio documento, sem ler as atividades.
   */
  async carregarAcompanhados(): Promise<void> {
    try {
      const lista = await this.tracking.listar();
      const mapa = new Map<string, TicketAcompanhado>();
      lista.forEach(t => {
        const chave = chaveNumero(t.numero);
        if (chave) mapa.set(chave, t);
      });
      this.acompanhados = mapa;
      this.ultimoUsuarioOptions = nomesDistintos(lista.map(t => t.ultimaAtividadeUsuario ?? ''));

      // O resumo chega depois da planilha: refiltra se algum filtro de acompanhamento estiver em uso
      if (this.acompanhamentoFilter !== 'TODOS' || this.ultimoUsuarioFilter !== 'TODOS') {
        this.aplicarFiltros();
      }
    } catch (e: any) {
      // Não impede o uso da lista: apenas os botões não indicam o que já é acompanhado
      console.error('[Acompanhamento] Falha ao listar tickets acompanhados', e);
      this.erroAcompanhamento = this.mensagemFirestore(e);
    }
  }

  estaAcompanhado(ticket: Record<string, string>): boolean {
    return !!this.resumoDe(ticket);
  }

  private resumoDe(ticket: Record<string, string>): TicketAcompanhado | undefined {
    const chave = chaveNumero(ticket['NUMERO'] ?? '');
    return chave ? this.acompanhados.get(chave) : undefined;
  }

  /** Status atual do acompanhamento, ou null se o ticket não é acompanhado. */
  statusAcompanhamento(ticket: Record<string, string>): StatusAtual | null {
    const resumo = this.resumoDe(ticket);
    return resumo ? statusAtualDe(resumo) : null;
  }

  rotuloStatusAcompanhamento(status: StatusAtual): string {
    return ROTULO_STATUS_ATUAL[status];
  }

  /** Quem está com o ticket: quem registrou a atividade mais recente. */
  quemEstaCom(ticket: Record<string, string>): string {
    return (this.resumoDe(ticket)?.ultimaAtividadeUsuario ?? '').trim();
  }

  /** Data e hora da atividade mais recente (ex.: "12/08/2026 às 14:30"). */
  dataUltimaAtividade(ticket: Record<string, string>): string {
    const resumo = this.resumoDe(ticket);
    return resumo?.ultimaAtividadeData
      ? dataHoraLegivel(resumo.ultimaAtividadeData, resumo.ultimaAtividadeHora)
      : '';
  }

  /**
   * Botão da linha: leva o ticket para o Firestore (se ainda não estiver) e abre
   * o acompanhamento. O clique não expande a linha.
   */
  async acompanhar(ticket: Record<string, string>, evento: Event): Promise<void> {
    evento.stopPropagation();
    const numero = (ticket['NUMERO'] ?? '').trim();
    if (!numero || this.enviandoNumero) return;

    this.erroAcompanhamento = '';
    if (!this.estaAcompanhado(ticket)) {
      this.enviandoNumero = numero;
      try {
        const resumo = await this.tracking.acompanhar(ticket);
        this.acompanhados.set(chaveNumero(numero), resumo);
      } catch (e: any) {
        this.erroAcompanhamento = this.mensagemFirestore(e);
        return;
      } finally {
        this.enviandoNumero = null;
      }
    }

    this.acompanhamentoNumero = numero;
    this.acompanhamentoAberto = true;
  }

  fecharAcompanhamento(): void {
    this.acompanhamentoAberto = false;
  }

  /** Recarrega as marcações (ex.: o ticket foi removido do acompanhamento). */
  aoAlterarAcompanhamento(): void {
    this.carregarAcompanhados();
  }

  abrirAuditoria(): void {
    this.auditoriaAberta = true;
  }

  fecharAuditoria(): void {
    this.auditoriaAberta = false;
  }

  get totalAcompanhados(): number {
    return this.acompanhados.size;
  }

  private mensagemFirestore(e: any): string {
    if (e?.code === 'permission-denied') {
      return 'O Firestore recusou o acesso (permission-denied). Publique as regras de segurança do arquivo firestore.rules.';
    }
    if (e?.code === 'unavailable' || e?.code === 'failed-precondition' || e?.code === 'not-found') {
      return 'Não foi possível acessar o Firestore. Confirme que o banco de dados foi criado no Console do Firebase.';
    }
    return `Falha no acompanhamento: ${e?.message ?? e}`;
  }

  // ===== Contexto para IA =====
  abrirContexto(): void {
    this.contextoModalOpen = true;
  }

  fecharContexto(): void {
    this.contextoModalOpen = false;
  }

  /**
   * Descreve, em texto legível, apenas os filtros realmente aplicados na tela.
   * Serve para documentar no contexto qual recorte de dados a IA está analisando.
   */
  get filtrosContexto(): FiltroAtivo[] {
    const fmtData = (s: string) => {
      const ts = this.parseDataToTs(s);
      return ts !== null ? new Date(ts).toLocaleDateString('pt-BR') : s;
    };

    const filtros: FiltroAtivo[] = [];
    if (this.numeroFilter.trim()) filtros.push({ rotulo: 'Número contém', valor: this.numeroFilter.trim() });
    if (this.statusFilter !== 'TODOS') filtros.push({ rotulo: 'Status', valor: this.statusFilter });
    if (this.responsavelFilter !== 'TODOS') filtros.push({ rotulo: 'Responsável', valor: this.responsavelFilter });
    if (this.origemFilter !== 'TODOS') filtros.push({ rotulo: 'Origem', valor: this.origemFilter });
    if (this.assuntoFilter.trim()) filtros.push({ rotulo: 'Assunto contém', valor: this.assuntoFilter.trim() });
    if (this.solicitanteFilter.trim()) filtros.push({ rotulo: 'Solicitante contém', valor: this.solicitanteFilter.trim() });
    if (this.localFilter.trim()) filtros.push({ rotulo: 'Local contém', valor: this.localFilter.trim() });
    if (this.acompanhamentoFilter !== 'TODOS') {
      const opcao = this.opcoesAcompanhamento.find(o => o.valor === this.acompanhamentoFilter);
      filtros.push({ rotulo: 'Acompanhamento', valor: (opcao?.rotulo ?? '').replace(/^—\s*/, '') });
    }
    if (this.ultimoUsuarioFilter !== 'TODOS') {
      filtros.push({ rotulo: 'Última atividade por', valor: this.ultimoUsuarioFilter });
    }

    if (this.dataInicioFilter && this.dataFimFilter) {
      filtros.push({ rotulo: 'Data de entrada', valor: `${fmtData(this.dataInicioFilter)} até ${fmtData(this.dataFimFilter)}` });
    } else if (this.dataInicioFilter) {
      filtros.push({ rotulo: 'Data de entrada', valor: `a partir de ${fmtData(this.dataInicioFilter)}` });
    } else if (this.dataFimFilter) {
      filtros.push({ rotulo: 'Data de entrada', valor: `até ${fmtData(this.dataFimFilter)}` });
    }

    if (this.sortColumn) {
      filtros.push({
        rotulo: 'Ordenação',
        valor: `${this.sortColumn} (${this.sortDirection === 'asc' ? 'crescente' : 'decrescente'})`
      });
    }

    return filtros;
  }

  // ===== Relatório =====
  abrirRelatorio(): void {
    // Pré-preenche o modal com os filtros já aplicados na tela, se houver
    this.repInicio = this.dataInicioFilter;
    this.repFim = this.dataFimFilter;
    this.repResponsavel = this.responsavelFilter;
    this.repStatus = this.statusFilter;
    this.repOrigem = this.origemFilter;
    this.repAssunto = this.assuntoFilter;
    this.repSolicitante = this.solicitanteFilter;
    this.repLocal = this.localFilter;
    this.reportRows = null;
    this.reportGeneratedAt = null;
    this.reportModalOpen = true;
  }

  fecharRelatorio(): void {
    this.reportModalOpen = false;
  }

  gerarRelatorio(): void {
    const inicioTs = this.repInicio ? this.parseDataToTs(this.repInicio) : null;
    const fimTs = this.repFim ? this.parseDataToTs(this.repFim) : null;
    const assuntoRep = this.repAssunto.trim().toLowerCase();
    const solicitanteRep = this.repSolicitante.trim().toLowerCase();
    const localRep = this.repLocal.trim().toLowerCase();

    let rows = this.allTickets.filter(row => {
      const statusMatch = this.repStatus === 'TODOS' || row['STATUS'] === this.repStatus;
      const responsavelMatch = this.repResponsavel === 'TODOS' || row['RESPONSAVEL'] === this.repResponsavel;
      const origemMatch = this.repOrigem === 'TODOS' || row['ORIGEM'] === this.repOrigem;
      const assuntoMatch = !assuntoRep || (row['ASSUNTO'] ?? '').toLowerCase().includes(assuntoRep);
      const solicitanteMatch = !solicitanteRep || (row['SOLICITANTE'] ?? '').toLowerCase().includes(solicitanteRep);
      // Local considera rua, número e bairro
      const localMatch = !localRep || [row['RUA'], row['NUM'], row['BAIRRO']]
        .map(v => (v ?? '').toLowerCase())
        .join(' ')
        .includes(localRep);

      let periodoMatch = true;
      if (inicioTs !== null || fimTs !== null) {
        const dataTs = this.parseDataToTs(row['DATA_ENTRADA'] ?? '');
        if (dataTs === null) {
          periodoMatch = false;
        } else {
          if (inicioTs !== null && dataTs < inicioTs) periodoMatch = false;
          if (fimTs !== null && dataTs > fimTs) periodoMatch = false;
        }
      }
      return statusMatch && responsavelMatch && origemMatch && assuntoMatch
        && solicitanteMatch && localMatch && periodoMatch;
    });

    // Ordena por DATA_ENTRADA conforme a ordem escolhida (linhas sem data vão para o fim)
    rows = rows.sort((a, b) => {
      const ta = this.parseDataToTs(a['DATA_ENTRADA'] ?? '');
      const tb = this.parseDataToTs(b['DATA_ENTRADA'] ?? '');
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return this.repOrdem === 'recentes' ? tb - ta : ta - tb;
    });

    // Limita a quantidade de registros
    const qtd = this.repQtd && this.repQtd > 0 ? Math.floor(this.repQtd) : rows.length;
    this.reportRows = rows.slice(0, qtd);
    this.reportGeneratedAt = new Date();
  }

  /** Gera um PDF A4 do relatório e abre em nova aba (onde o usuário pode imprimir). */
  gerarPdf(): void {
    if (!this.reportRows || this.reportRows.length === 0) return;

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 14;

    // Cabeçalho
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Relatório de Tickets', marginX, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(90);
    doc.text('Relação de registros para atendimento', marginX, 23);
    doc.setTextColor(0);

    // Metadados
    doc.setFontSize(9);
    const metaLinhas = [
      `Responsável: ${this.repResponsavelLabel}`,
      `Período: ${this.repPeriodoLabel}`,
      `Status: ${this.repStatus === 'TODOS' ? 'Todos' : this.repStatus}    Origem: ${this.repOrigem === 'TODOS' ? 'Todas' : this.repOrigem}`,
      `Assunto: ${this.repAssunto.trim() ? this.repAssunto : 'Todos'}`,
      `Solicitante: ${this.repSolicitante.trim() ? this.repSolicitante : 'Todos'}    Local: ${this.repLocal.trim() ? this.repLocal : 'Todos'}`,
      `Registros: ${this.reportRows.length}    Gerado em: ${(this.reportGeneratedAt ?? new Date()).toLocaleString('pt-BR')}`
    ];
    let y = 30;
    metaLinhas.forEach(linha => {
      doc.text(linha, marginX, y);
      y += 5;
    });

    // Tabela
    const body = this.reportRows.map((t, i) => [
      String(i + 1),
      t['NUMERO'] || '—',
      t['STATUS'] || '—',
      t['RESPONSAVEL'] || '—',
      t['ORIGEM'] || '—',
      t['DATA_ENTRADA'] || '—',
      t['ASSUNTO'] || '—',
      t['RUA'] ? (t['RUA'] + (t['NUM'] ? ', ' + t['NUM'] : '')) : '—'
    ]);

    autoTable(doc, {
      startY: y + 2,
      head: [['#', 'Número', 'Status', 'Responsável', 'Origem', 'Data', 'Assunto', 'Local']],
      body,
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [26, 59, 173], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 247, 255] },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 30 },
        2: { cellWidth: 20 },
        5: { cellWidth: 18 }
      },
      margin: { left: marginX, right: marginX }
    });

    // Linha de assinatura ao final
    const finalY = (doc as any).lastAutoTable?.finalY ?? y;
    let signY = finalY + 24;
    if (signY > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      signY = 40;
    }
    const lineWidth = 70;
    const lineX = pageWidth - marginX - lineWidth;
    doc.setDrawColor(0);
    doc.line(lineX, signY, lineX + lineWidth, signY);
    doc.setFontSize(9);
    doc.text('Assinatura do responsável', lineX + lineWidth / 2, signY + 5, { align: 'center' });

    // Abre em nova aba (o visualizador de PDF do navegador tem o botão de imprimir)
    const blobUrl = doc.output('bloburl') as unknown as string;
    window.open(blobUrl, '_blank');

    // Fecha o modal após gerar o PDF
    this.fecharRelatorio();
  }

  /** Exporta o relatório atual para um arquivo Excel (.xlsx). */
  gerarExcel(): void {
    if (!this.reportRows || this.reportRows.length === 0) return;

    const dados = this.reportRows.map((t, i) => ({
      '#': i + 1,
      'Número': t['NUMERO'] || '',
      'Status': t['STATUS'] || '',
      'Responsável': t['RESPONSAVEL'] || '',
      'Origem': t['ORIGEM'] || '',
      'Solicitante': t['SOLICITANTE'] || '',
      'Data Entrada': t['DATA_ENTRADA'] || '',
      'Assunto': t['ASSUNTO'] || '',
      'Classe': t['CLASSE'] || '',
      'Rua': t['RUA'] || '',
      'Número Local': t['NUM'] || '',
      'Bairro': t['BAIRRO'] || '',
      'Regional': t['REGIONAL'] || '',
      'Descrição': t['DESCRICAO'] || '',
      'Resposta': t['RESPOSTA'] || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tickets');

    const dataStr = (this.reportGeneratedAt ?? new Date())
      .toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `relatorio-tickets-${dataStr}.xlsx`);

    // Fecha o modal após exportar
    this.fecharRelatorio();
  }

  get repResponsavelLabel(): string {
    return this.repResponsavel === 'TODOS' ? 'Todos os responsáveis' : this.repResponsavel;
  }

  get repPeriodoLabel(): string {
    const fmt = (s: string) => {
      const ts = this.parseDataToTs(s);
      return ts !== null ? new Date(ts).toLocaleDateString('pt-BR') : s;
    };
    if (this.repInicio && this.repFim) return `${fmt(this.repInicio)} até ${fmt(this.repFim)}`;
    if (this.repInicio) return `A partir de ${fmt(this.repInicio)}`;
    if (this.repFim) return `Até ${fmt(this.repFim)}`;
    return 'Todo o período';
  }
}
