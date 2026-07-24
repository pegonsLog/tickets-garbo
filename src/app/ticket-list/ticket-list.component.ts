import { Component, OnInit, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { GoogleSheetsService, SheetData } from '../services/google-sheets.service';

@Component({
  selector: 'app-ticket-list',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
  dataInicioFilter: string = '';
  dataFimFilter: string = '';

  expandedIndex: number | null = null;

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
  repQtd: number | null = 200;
  repOrdem: 'recentes' | 'antigas' = 'recentes';

  reportRows: Record<string, string>[] | null = null;
  reportGeneratedAt: Date | null = null;

  // Largura da tabela para dimensionar a barra de rolagem superior
  @ViewChild('tableEl') tableEl?: ElementRef<HTMLElement>;
  contentWidth = 0;

  constructor(private googleSheetsService: GoogleSheetsService) {}

  ngOnInit(): void {
    this.carregarTickets();
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
    // Campos de data (type=date) chegam como yyyy-mm-dd
    const inicioTs = this.dataInicioFilter ? this.parseDataToTs(this.dataInicioFilter) : null;
    const fimTs = this.dataFimFilter ? this.parseDataToTs(this.dataFimFilter) : null;

    this.filteredTickets = this.allTickets.filter(row => {
      const numeroMatch = !numero || (row['NUMERO'] ?? '').toLowerCase().includes(numero);
      const statusMatch = this.statusFilter === 'TODOS' || row['STATUS'] === this.statusFilter;
      const responsavelMatch = this.responsavelFilter === 'TODOS' || row['RESPONSAVEL'] === this.responsavelFilter;
      const origemMatch = this.origemFilter === 'TODOS' || row['ORIGEM'] === this.origemFilter;
      const assuntoMatch = !assunto || (row['ASSUNTO'] ?? '').toLowerCase().includes(assunto);

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

      return numeroMatch && statusMatch && responsavelMatch && origemMatch && assuntoMatch && periodoMatch;
    });
    this.expandedIndex = null;
    this.updateContentWidth();
  }

  limparFiltros(): void {
    this.numeroFilter = '';
    this.statusFilter = 'TODOS';
    this.responsavelFilter = 'TODOS';
    this.origemFilter = 'TODOS';
    this.assuntoFilter = '';
    this.dataInicioFilter = '';
    this.dataFimFilter = '';
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
      || this.dataInicioFilter !== ''
      || this.dataFimFilter !== '';
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

  // ===== Relatório =====
  abrirRelatorio(): void {
    // Pré-preenche o modal com os filtros já aplicados na tela, se houver
    this.repInicio = this.dataInicioFilter;
    this.repFim = this.dataFimFilter;
    this.repResponsavel = this.responsavelFilter;
    this.repStatus = this.statusFilter;
    this.repOrigem = this.origemFilter;
    this.repAssunto = this.assuntoFilter;
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

    let rows = this.allTickets.filter(row => {
      const statusMatch = this.repStatus === 'TODOS' || row['STATUS'] === this.repStatus;
      const responsavelMatch = this.repResponsavel === 'TODOS' || row['RESPONSAVEL'] === this.repResponsavel;
      const origemMatch = this.repOrigem === 'TODOS' || row['ORIGEM'] === this.repOrigem;
      const assuntoMatch = !assuntoRep || (row['ASSUNTO'] ?? '').toLowerCase().includes(assuntoRep);

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
      return statusMatch && responsavelMatch && origemMatch && assuntoMatch && periodoMatch;
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
