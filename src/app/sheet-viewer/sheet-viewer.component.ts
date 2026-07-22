import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GoogleSheetsService, SheetData } from '../services/google-sheets.service';

@Component({
  selector: 'app-sheet-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, MatProgressSpinnerModule],
  templateUrl: './sheet-viewer.component.html',
  styleUrls: ['./sheet-viewer.component.scss']
})
export class SheetViewerComponent implements OnInit {
  // Planilha exibida por padrão (mesma usada na busca por rua)
  private readonly spreadsheetId = '1C8gFU2yms0jAvGBtKOcqlgNY6psW5JJ47pWbiFJlZSM';
  private readonly sheetName = 'TODAS';

  headers: string[] = [];
  rows: Record<string, string>[] = [];
  filtroGeral: string = '';

  loading: boolean = false;
  error: string = '';

  constructor(
    private googleSheetsService: GoogleSheetsService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.carregarPlanilha();
  }

  carregarPlanilha(): void {
    this.loading = true;
    this.error = '';
    this.googleSheetsService.getSheetData(this.spreadsheetId, this.sheetName).subscribe({
      next: (data: SheetData) => {
        this.headers = data.headers;
        this.rows = data.rows;
        this.loading = false;
      },
      error: (err: any) => {
        this.error = err.message || 'Erro ao carregar a planilha.';
        this.loading = false;
      }
    });
  }

  get linhasFiltradas(): Record<string, string>[] {
    const termo = this.filtroGeral.trim().toLowerCase();
    if (!termo) {
      return this.rows;
    }
    return this.rows.filter(row =>
      this.headers.some(header => (row[header] ?? '').toLowerCase().includes(termo))
    );
  }

  navigateToStreetSearch(): void {
    this.router.navigate(['/street-search']);
  }
}
