import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MetaRelatorio, RelatorioIa } from './ai-report.model';
import { montarRelatorioHtml } from './ai-report-html';

/**
 * Exibe o relatório de similaridade gerado pela IA.
 *
 * A pré-visualização usa o mesmo documento HTML que é baixado e impresso — assim
 * o que aparece na tela é exatamente o que vai para o PDF. A impressão é feita pelo
 * navegador (Imprimir > Salvar como PDF), respeitando o CSS de página A4 do relatório.
 */
@Component({
  selector: 'app-ai-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-report.component.html',
  styleUrls: ['./ai-report.component.scss']
})
export class AiReportComponent implements OnChanges {
  @Input() relatorio: RelatorioIa | null = null;
  @Input() meta: MetaRelatorio | null = null;
  @Input() aberto: boolean = false;

  @Output() fechar = new EventEmitter<void>();

  @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;

  /** Documento HTML completo do relatório. */
  html: string = '';
  /** Mesmo documento, liberado para uso no srcdoc do iframe. */
  htmlSeguro: SafeHtml | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    // Remonta apenas quando o conteúdo muda; abrir/fechar não deve recarregar o iframe
    if (!changes['relatorio'] && !changes['meta']) return;

    if (this.relatorio && this.meta) {
      this.html = montarRelatorioHtml(this.relatorio, this.meta);
      // O HTML é montado pela aplicação e todo texto da IA é escapado em montarRelatorioHtml
      this.htmlSeguro = this.sanitizer.bypassSecurityTrustHtml(this.html);
    } else {
      this.html = '';
      this.htmlSeguro = null;
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.aberto) {
      this.fechar.emit();
    }
  }

  get totalGrupos(): number {
    return this.relatorio?.grupos?.length ?? 0;
  }

  get respostasEconomizadas(): number {
    return (this.relatorio?.grupos ?? [])
      .reduce((soma, g) => soma + Math.max((g.tickets?.length ?? 0) - 1, 0), 0);
  }

  /** Abre a caixa de impressão do navegador para salvar o relatório em PDF. */
  imprimir(): void {
    const janela = this.frame?.nativeElement?.contentWindow;
    if (janela) {
      janela.focus();
      janela.print();
      return;
    }
    this.imprimirViaIframe();
  }

  /** Alternativa: cria um iframe temporário quando a pré-visualização não está acessível. */
  private imprimirViaIframe(): void {
    if (!this.html) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(this.html);
    doc.close();

    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    };
  }

  /** Abre o relatório em uma nova aba (onde também é possível imprimir). */
  abrirEmNovaAba(): void {
    if (!this.html) return;
    const janela = window.open('', '_blank');
    if (!janela) return;
    janela.document.open();
    janela.document.write(this.html);
    janela.document.close();
  }

  /** Baixa o relatório como arquivo .html autocontido. */
  baixarHtml(): void {
    if (!this.html) return;
    const dataStr = (this.meta?.geradoEm ?? new Date()).toISOString().slice(0, 10);
    const blob = new Blob([this.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `relatorio-similaridade-${dataStr}.html`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
