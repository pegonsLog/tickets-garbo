import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AiAuditService, TAMANHO_MAX_PDF } from '../services/ai-audit.service';
import { MODELOS_DISPONIVEIS, MODELO_PADRAO } from '../services/ai-analysis.service';
import { ResultadoAuditoria } from './audit.model';
import { montarAuditoriaHtml } from './audit-report-html';

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
  html: string = '';
  htmlSeguro: SafeHtml | null = null;

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
        etapa => (this.etapa = etapa)
      );
      this.resultado = resultado;
      this.html = montarAuditoriaHtml(resultado);
      // HTML montado pela aplicação; todo texto dinâmico é escapado em montarAuditoriaHtml
      this.htmlSeguro = this.sanitizer.bypassSecurityTrustHtml(this.html);
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
    this.html = '';
    this.htmlSeguro = null;
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
    link.download = `auditoria-acompanhamento-${dataStr}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
