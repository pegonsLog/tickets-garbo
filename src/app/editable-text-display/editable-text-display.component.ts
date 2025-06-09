import { Component, Input } from '@angular/core';
import { TextFieldModule } from '@angular/cdk/text-field';
import { FormsModule } from '@angular/forms'; // Adicionado FormsModule

@Component({
  selector: 'app-editable-text-display',
  standalone: true,
  imports: [TextFieldModule, FormsModule], // Adicionado FormsModule
  templateUrl: './editable-text-display.component.html',
  styleUrl: './editable-text-display.component.scss'
})
export class EditableTextDisplayComponent {
copiarTexto() {
  navigator.clipboard.writeText(this.textoParaExibir);
}
  @Input() textoParaExibir: string = '';


}
