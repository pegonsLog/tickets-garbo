import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface SheetData {
  headers: string[];
  rows: Record<string, string>[];
}

@Injectable({
  providedIn: 'root'
})
export class GoogleSheetsService {
  private readonly apiKey = environment.apiKey;

  constructor(private http: HttpClient) {}

  /**
   * Busca todos os valores de uma planilha do Google Sheets e converte
   * a primeira linha em cabeçalho, retornando as demais linhas como objetos.
   */
  getSheetData(spreadsheetId: string, sheetName: string, range: string = 'A1:Z'): Observable<SheetData> {
    const fullRange = `${encodeURIComponent(sheetName)}!${range}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${fullRange}?key=${this.apiKey}`;

    return this.http.get<{ values?: string[][] }>(url).pipe(
      map(data => {
        const values = data?.values ?? [];
        if (values.length === 0) {
          return { headers: [], rows: [] };
        }
        const headers = values[0].map(h => (h ?? '').toString().trim());
        const rows = values.slice(1).map(row => {
          const rowObj: Record<string, string> = {};
          headers.forEach((header, index) => {
            rowObj[header] = row[index] !== undefined ? String(row[index]) : '';
          });
          return rowObj;
        });
        return { headers, rows };
      }),
      catchError(err => throwError(() => new Error('Erro ao acessar a planilha: ' + (err?.message || err))))
    );
  }
}
