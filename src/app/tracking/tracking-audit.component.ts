import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AiAuditService, TAMANHO_MAX_PDF } from '../services/ai-audit.service';
import { MODELOS_DISPONIVEIS, MODELO_PADRAO } from '../services/ai-analysis.service';
import { ResultadoAuditoria } from './audit.model';
import { montarAuditoriaHtml } from './audit-report-html';
import { montarComparacaoHtml } from './status-report-html';

/**
 * Auditoria do acompanhamento: o usuário envia o PDF com a relação de tickets
 * passados para andamento, e o relatório mostra quais tiveram atividade.
 */
@Component({
  selector: 'app-tracking-audit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './tracking-audit.component.html',
  styleUrls: ['./tracking-audit.component.scss']
})
export class TrackingAuditComponent {
  @Input() aberto: boolean = false;
  /**
   * Todas as linhas da planilha carregada na tela (não só as filtradas): a comparação
   * de status precisa encontrar qualquer ticket do arquivo, independente dos filtros.
   */
  @Input() lista: Record<string, string>[] = [];
  @Output() fechar = new EventEmitter<void>();

  @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;
  @ViewChild('arquivoInput') arquivoInput?: ElementRef<HTMLInputElement>;

  readonly modelos = MODELOS_DISPONIVEIS;
  readonly limiteMb = Math.round(TAMANHO_MAX_PDF / 1024 / 1024);

  arquivo: File | null = null;
  periodoInicio: string = '';
  periodoFim: string = '';
  modelo: string = MODELO_PADRAO;

  processando: boolean = false;
  etapa: string = '';
  erro: string = '';
  arrastando: boolean = false;

  resultado: ResultadoAuditoria | null = null;

  /** Qual dos dois relatórios está na tela. */
  aba: 'acompanhamento' | 'status' = 'acompanhamento';
  private htmlAcompanhamento: string = '';
  private htmlStatus: string = '';
  private seguroAcompanhamento: SafeHtml | null = null;
  private seguroStatus: SafeHtml | null = null;

  /** Documento da aba atual (usado para imprimir, abrir e baixar). */
  get html(): string {
    return this.aba === 'status' ? this.htmlStatus : this.htmlAcompanhamento;
  }

  get htmlSeguro(): SafeHtml | null {
    return this.aba === 'status' ? this.seguroStatus : this.seguroAcompanhamento;
  }

  trocarAba(aba: 'acompanhamento' | 'status'): void {
    this.aba = aba;
  }

  constructor(private auditoria: AiAuditService, private sanitizer: DomSanitizer) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.aberto && !this.processando) {
      this.fechar.emit();
    }
  }

  get tamanhoArquivo(): string {
    if (!this.arquivo) return '';
    const kb = this.arquivo.size / 1024;
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.ceil(kb)} KB`;
  }

  selecionar(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    this.definirArquivo(input.files?.[0] ?? null);
  }

  soltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastando = false;
    this.definirArquivo(evento.dataTransfer?.files?.[0] ?? null);
  }

  sobre(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastando = true;
  }

  removerArquivo(): void {
    this.arquivo = null;
    if (this.arquivoInput) this.arquivoInput.nativeElement.value = '';
  }

  private definirArquivo(arquivo: File | null): void {
    this.erro = '';
    if (!arquivo) return;
    if (arquivo.type !== 'application/pdf' && !/\.pdf$/i.test(arquivo.name)) {
      this.erro = 'Selecione um arquivo PDF.';
      return;
    }
    this.arquivo = arquivo;
  }

  async analisar(): Promise<void> {
    if (!this.arquivo || this.processando) return;
    this.processando = true;
    this.erro = '';
    this.etapa = 'Preparando...';

    try {
      const resultado = await this.auditoria.auditar(
        this.arquivo,
        { inicio: this.periodoInicio || undefined, fim: this.periodoFim || undefined },
        this.modelo,
        etapa => (this.etapa = etapa),
        this.lista
      );
      this.resultado = resultado;
      this.aba = 'acompanhamento';
      // HTML montado pela aplicação; todo texto dinâmico é escapado nos geradores
      this.htmlAcompanhamento = montarAuditoriaHtml(resultado);
      this.htmlStatus = montarComparacaoHtml(resultado);
      this.seguroAcompanhamento = this.sanitizer.bypassSecurityTrustHtml(this.htmlAcompanhamento);
      this.seguroStatus = this.sanitizer.bypassSecurityTrustHtml(this.htmlStatus);
    } catch (e: any) {
      this.erro = e?.message || 'Não foi possível concluir a auditoria.';
    } finally {
      this.processando = false;
      this.etapa = '';
    }
  }

  /** Volta ao formulário para auditar outro arquivo/período. */
  novaAuditoria(): void {
    this.resultado = null;
    this.htmlAcompanhamento = '';
    this.htmlStatus = '';
    this.seguroAcompanhamento = null;
    this.seguroStatus = null;
    this.aba = 'acompanhamento';
    this.removerArquivo();
  }

  imprimir(): void {
    const janela = this.frame?.nativeElement?.contentWindow;
    if (janela) {
      janela.focus();
      janela.print();
    }
  }

  abrirEmNovaAba(): void {
    if (!this.html) return;
    const janela = window.open('', '_blank');
    if (!janela) return;
    janela.document.open();
    janela.document.write(this.html);
    janela.document.close();
  }

  baixarHtml(): void {
    if (!this.html) return;
    const dataStr = new Date().toISOString().slice(0, 10);
    const blob = new Blob([this.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.aba === 'status'
      ? `comparacao-status-${dataStr}.html`
      : `auditoria-acompanhamento-${dataStr}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
