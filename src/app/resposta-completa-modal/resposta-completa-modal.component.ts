import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-resposta-completa-modal',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  templateUrl: './resposta-completa-modal.component.html',
  styleUrls: ['./resposta-completa-modal.component.scss']
})
export class RespostaCompletaModalComponent {
  constructor(
    public dialogRef: MatDialogRef<RespostaCompletaModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { textoCompleto: string }
  ) {}

  fechar(): void {
    this.dialogRef.close();
  }

  copiarEFechar(): void {
    this.dialogRef.close(this.data.textoCompleto);
  }
}
