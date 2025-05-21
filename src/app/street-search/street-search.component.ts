import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { GroqService } from './groq.service';

@Component({
  selector: 'app-street-search',
  standalone: true,
  imports: [CommonModule, FormsModule, HttpClientModule],
  templateUrl: './street-search.component.html',
  styleUrls: ['./street-search.component.scss']
})
export class StreetSearchComponent {
  constructor(private groqService: GroqService) {}
  streetName: string = '';
  streetNumber: string = '';
  results: any[] = [];
  loading: boolean = false;
  error: string = '';


  // ID da sua planilha
  private spreadsheetId = '1C8gFU2yms0jAvGBtKOcqlgNY6psW5JJ47pWbiFJlZSM';
  // Nome da aba (sheet)
  private sheetName = 'TODAS';
  // Chave da API do Google
  private apiKey = 'AIzaSyDSKz2lNc-d_KsdDkMBidbQjyEU65Z9Z5E';


  async searchStreet() {
    this.loading = true;
    this.error = '';
    this.results = [];
    try {
      const range = `${encodeURIComponent(this.sheetName)}!A1:Z`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?key=${this.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Erro ao acessar a planilha');
      const data = await response.json();
      if (!data.values || data.values.length < 2) {
        this.error = 'Nenhum dado encontrado na planilha.';
        this.loading = false;
        return;
      }
      const header = data.values[0];
      const dataRows = data.values.slice(1);
      // Log do cabeçalho para debug
      console.log('Cabeçalho da planilha:', header);
      // Busca tolerante a espaços e maiúsculas/minúsculas
      const idxRua = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'RUA');
      const idxNum = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'NUM');
      const idxDescricao = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'DESCRICAO');
      const idxStatus = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'STATUS');
      if (idxRua === -1) {
        this.error = 'Coluna RUA não encontrada no cabeçalho da planilha.';
        this.loading = false;
        return;
      }
      const filteredRows = dataRows.filter((row: any) => {
        const ruaMatch = row[idxRua] && row[idxRua].toLowerCase().includes(this.streetName.trim().toLowerCase());
        let numeroMatch = true;
        if (this.streetNumber && idxNum !== -1 && row[idxNum]) {
          // Remover separador '.' dos números para comparação
          const inputNumStr = this.streetNumber.replace(/\./g, '');
          const rowNumStr = row[idxNum].toString().replace(/\./g, '');
          const inputNum = parseInt(inputNumStr, 10);
          const rowNum = parseInt(rowNumStr, 10);
          if (!isNaN(inputNum) && !isNaN(rowNum)) {
            numeroMatch = rowNum >= (inputNum - 100) && rowNum <= (inputNum + 100);
          } else {
            numeroMatch = rowNumStr.toLowerCase().includes(inputNumStr.toLowerCase());
          }
        }
        return ruaMatch && numeroMatch;
      }).map((row: any) => ({
        NUM_SOLICITACAO: row[1] || '',
        RUA: row[idxRua],
        NUMERO: idxNum !== -1 ? row[idxNum] : '',
        DATA_ENTRADA: row[5] || '',
        STATUS: idxStatus !== -1 ? row[idxStatus] : '',
        DESCRICAO: idxDescricao !== -1 ? row[idxDescricao] : ''
      }));
      this.results = filteredRows.sort((a: any, b: any) => {
        const numA = Number(a.NUMERO);
        const numB = Number(b.NUMERO);
        if (numA !== numB) {
          if (!isNaN(numA) && !isNaN(numB)) {
            return numA - numB;
          }
          return String(a.NUMERO).localeCompare(String(b.NUMERO));
        }
        // Segunda ordenação: DATA_ENTRADA crescente (robusto para texto dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd)
        function parseDate(str: string): number {
          if (!str) return 0;
          // Tenta yyyy-mm-dd (ISO)
          const isoMatch = str.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
          if (isoMatch) return new Date(str).getTime();
          // Tenta dd/mm/yyyy ou dd-mm-yyyy
          const brMatch = str.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
          if (brMatch) {
            const [_, d, m, y] = brMatch;
            return new Date(`${y}-${m}-${d}`).getTime();
          }
          return new Date(str).getTime(); // fallback
        }
        const dateA = parseDate(a.DATA_ENTRADA);
        const dateB = parseDate(b.DATA_ENTRADA);
        return dateA - dateB;
      });
      if (this.results.length === 0) {
        this.error = 'Nenhum registro encontrado.';
      } else {
        // Para cada resultado, resumir o campo DESCRICAO usando a API Groq
        for (const result of this.results) {
          if (result.DESCRICAO) {
            this.groqService.resumirDescricao(result.DESCRICAO).subscribe({
              next: (response) => {
                result.RESUMO = response.choices?.[0]?.message?.content || '';
              },
              error: () => {
                result.RESUMO = 'Erro ao resumir';
              }
            });
          } else {
            result.RESUMO = 'Descrição não informada';
          }
        }

      }
    } catch (err: any) {
      this.error = err.message || 'Erro ao buscar dados.';
    } finally {
      this.loading = false;
    }
  }



}
