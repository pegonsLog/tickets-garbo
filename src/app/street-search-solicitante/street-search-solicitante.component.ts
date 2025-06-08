import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GroqService } from '../street-search/groq.service';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { StreetSearchResult } from '../street-search/street-search.component.model';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { environment } from '../../environments/environment';
import { EditableTextDisplayComponent } from "../editable-text-display/editable-text-display.component";

@Component({
  selector: 'app-street-search-solicitante',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatProgressSpinnerModule,
    EditableTextDisplayComponent
],
  templateUrl: './street-search-solicitante.component.html',
  styleUrls: ['./street-search-solicitante.component.scss']
})
export class StreetSearchSolicitanteComponent {

  private readonly spreadsheetId = '1CghEnK-3R74P5OvcR4C6wMhAl27xkoT4CgwtMwsldeU';
  private readonly sheetName = 'TODAS';
  private readonly apiKey = environment.apiKey;

  applicantName: string = '';
  streetNumber: string = '';
  statusFilter: string = 'TODAS';
  results: StreetSearchResult[] = [];
  loading: boolean = false;
  error: string = '';

  textoParaEditar: string | null = null;

  constructor(
    private groqService: GroqService,
    private http: HttpClient,
    private router: Router,
  ) {}

  async searchStreet() {
    this.loading = true;
    this.error = '';
    this.results = [];
    try {
      const range = `${encodeURIComponent(this.sheetName)}!A1:Z`;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.spreadsheetId}/values/${range}?key=${this.apiKey}`;
      const data: any = await this.http.get(url).toPromise().catch((err) => {
        throw new Error('Erro ao acessar a planilha: ' + (err?.message || err));
      });
      if (!data?.values || data.values.length < 2) {
        this.error = 'Nenhum dado encontrado na planilha.';
        this.loading = false;
        return;
      }
      const header = data.values[0];
      const dataRows = data.values.slice(1);
      // Log do cabeçalho para debug
      console.log('Cabeçalho da planilha:', header);
      // Busca tolerante a espaços e maiúsculas/minúsculas
      const idxSolicitante = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'SOLICITANTE');
      const idxNum = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'NUM');
      const idxDescricao = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'DESCRICAO');
      const idxStatus = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'STATUS');
      const idxMensagem = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'MENSAGEM');
      const idxOrigem = header.findIndex((h: string) => h.replace(/\s+/g, '').toUpperCase() === 'ORIGEM');
      if (idxSolicitante === -1) {
        this.error = 'Coluna SOLICITANTE não encontrada no cabeçalho da planilha.';
        this.loading = false;
        return;
      }
      const filteredRows = dataRows.filter((row: any) => {
        const solicitanteMatch = row[idxSolicitante] && row[idxSolicitante].toLowerCase().includes(this.applicantName.trim().toLowerCase());
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
        let statusMatch = true;
        if (this.statusFilter !== 'TODAS' && idxStatus !== -1) {
          statusMatch = row[idxStatus] && row[idxStatus].toUpperCase() === this.statusFilter;
        }
        return solicitanteMatch && numeroMatch && statusMatch;
      }).map((row: any): StreetSearchResult => ({
        NUM_SOLICITACAO: row[1] || '',
        RUA: '', // Não definido neste contexto, pois busca é por solicitante
        NUMERO: idxNum !== -1 && row[idxNum] ? row[idxNum].toString().replace(/\./g, '') : '',
        DATA_ENTRADA: row[5] || '',
        STATUS: idxStatus !== -1 ? row[idxStatus] : '',
        DESCRICAO: idxDescricao !== -1 ? row[idxDescricao] : '',
        ORIGEM: idxOrigem !== -1 ? row[idxOrigem] : '',
        MENSAGEM: idxMensagem !== -1 ? row[idxMensagem] : ''
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
        this.error = 'Nenhum registro encontrado para os filtros informados.';
      } else {
        // Para cada resultado, resumir o campo DESCRICAO usando a API Groq
        this.results.forEach(result => {
          if (result.DESCRICAO) {
            this.groqService.resumirDescricao(result.DESCRICAO).subscribe({
              next: (response) => {
                result.RESUMO = response.choices?.[0]?.message?.content || '';
              },
              error: (err) => {
                result.RESUMO = 'Erro ao resumir: ' + (err?.message || '');
              }
            });
          } else {
            result.RESUMO = 'Descrição não informada';
          }
        });
      }
    } catch (err: any) {
      this.error = err.message || 'Erro ao buscar dados.';
    } finally {
      this.loading = false;
    }
  }

  abrirEditorResposta(result: StreetSearchResult) {
    this.textoParaEditar = result.MENSAGEM ?? '';
  }

  returnStreetSearch() {
    this.router.navigate(['']);
  }

  navigateToRespostaPadrao(): void {
    this.router.navigate(['/resposta-padrao']);
  }
}
