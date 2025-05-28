import { Component, Input, Output, EventEmitter } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-editar-resposta',
  standalone: true,
  imports: [
    FormsModule
  ],
  templateUrl: './editar-resposta.component.html',
  styleUrls: ['./editar-resposta.component.scss']
})
export class EditarRespostaComponent {
  @Input() textoEditavel: string = '';
  @Output() close = new EventEmitter<void>();
  fechar() {
    this.close.emit();
  }
}
