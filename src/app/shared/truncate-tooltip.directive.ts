import { Directive, ElementRef, HostListener } from '@angular/core';

/**
 * Exibe um tooltip (title nativo) com o conteúdo completo apenas quando o
 * texto do elemento está realmente truncado por CSS (text-overflow: ellipsis).
 *
 * A medição é feita sob demanda, no momento em que o ponteiro entra no
 * elemento (ou ele recebe foco), evitando leituras de layout durante os
 * ciclos de detecção de mudanças — que causariam reflows desnecessários.
 */
@Directive({
  selector: '[appTruncateTooltip]',
  standalone: true
})
export class TruncateTooltipDirective {
  constructor(private el: ElementRef<HTMLElement>) {}

  @HostListener('mouseenter')
  @HostListener('focus')
  onEnter(): void {
    const node = this.el.nativeElement;
    // Margem de 1px evita falsos positivos por arredondamento de subpixel
    const truncadoHorizontal = node.scrollWidth - node.clientWidth > 1;
    const truncadoVertical = node.scrollHeight - node.clientHeight > 1;

    if (truncadoHorizontal || truncadoVertical) {
      const texto = (node.textContent ?? '').trim();
      if (texto) {
        node.setAttribute('title', texto);
        return;
      }
    }

    node.removeAttribute('title');
  }
}
