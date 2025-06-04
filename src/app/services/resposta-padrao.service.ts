import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Resposta {
  id: number; // Usaremos o índice da linha como ID
  assunto: string;
  resposta: string;
}

@Injectable({
  providedIn: 'root'
})
export class RespostaPadraoService {
  private apiUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  private spreadsheetId = '1flj4Txfl5qF_MzR5VfNijSnXuhrKujn52UMOcpE1etY'; // Seu ID da planilha
  private range = 'A:B'; // Assumindo que Assunto está na coluna A e Resposta na B
  private apiKey = environment.apiKey;

  // Cache local para simular operações de escrita
  private respostasCache: Resposta[] = [];
  private cacheValido = false;
  private proximoIdLocal = 0; // Para gerar IDs para novas respostas locais

  constructor(private http: HttpClient) { }

  getRespostas(): Observable<Resposta[]> {
    if (this.cacheValido) {
      return of(this.respostasCache);
    }

    const url = `${this.apiUrl}/${this.spreadsheetId}/values/${this.range}?key=${this.apiKey}`;
    return this.http.get<any>(url).pipe(
      map(data => {
        if (!data.values || data.values.length <= 1) { // <=1 para ignorar cabeçalho se houver
          return [];
        }
        // Pular a primeira linha se for cabeçalho (ex: 'Assunto', 'Resposta')
        const values = data.values.slice(1);
        this.respostasCache = values.map((row: any[], index: number) => ({
          id: index, // Usando índice como ID simples. Poderia ser melhorado.
          assunto: row[0] || '',
          resposta: row[1] || ''
        }));
        this.proximoIdLocal = this.respostasCache.length;
        this.cacheValido = true;
        return this.respostasCache;
      }),
      catchError(error => {
        console.error('Erro ao buscar respostas da planilha:', error);
        return throwError(() => new Error('Não foi possível carregar as respostas padrão.'));
      })
    );
  }

  // Métodos de escrita simulados (não persistem no Google Sheets)
  addResposta(novaResposta: { assunto: string; resposta: string }): Observable<Resposta> {
    console.warn('Operação de adicionar resposta é simulada e não persiste no Google Sheets.');
    const respostaComId: Resposta = {
      ...novaResposta,
      id: this.proximoIdLocal++
    };
    this.respostasCache.push(respostaComId);
    // this.cacheValido = true; // Cache continua válido com a adição local
    return of(respostaComId);
  }

  updateResposta(respostaAtualizada: Resposta): Observable<Resposta> {
    console.warn('Operação de atualizar resposta é simulada e não persiste no Google Sheets.');
    const index = this.respostasCache.findIndex(r => r.id === respostaAtualizada.id);
    if (index !== -1) {
      this.respostasCache[index] = respostaAtualizada;
      return of(respostaAtualizada);
    }
    return throwError(() => new Error('Resposta não encontrada para atualização.'));
  }

  deleteResposta(id: number): Observable<void> {
    console.warn('Operação de deletar resposta é simulada e não persiste no Google Sheets.');
    const index = this.respostasCache.findIndex(r => r.id === id);
    if (index !== -1) {
      this.respostasCache.splice(index, 1);
      return of(undefined);
    }
    return throwError(() => new Error('Resposta não encontrada para exclusão.'));
  }

  invalidateCache(): void {
    this.cacheValido = false;
  }
}
