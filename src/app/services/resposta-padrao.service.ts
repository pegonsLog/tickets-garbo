import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

// Interface para a estrutura de uma resposta da planilha
export interface Resposta {
  id: number; // Ou string, dependendo de como o script e a planilha gerenciam IDs
  assunto: string;
  resposta: string;
  criador: string;
}

// Interface para a resposta esperada do Google Apps Script
interface ScriptResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  id?: number | string; // Para o caso de delete, pode retornar o ID excluído
}

@Injectable({
  providedIn: 'root'
})
export class RespostaPadraoService {
  // URL do seu Google Apps Script implantado como Web App
  private scriptUrl = 'https://script.google.com/macros/s/AKfycbz-cj-xByw3wigW-wHuB_tej4OOxfzLTRWc-p1uWiwhI-gb2WHjK1fNxz9RqFK4-Fd4/exec';

  constructor(private http: HttpClient) { }

  // Busca todas as respostas
  getRespostas(): Observable<Resposta[]> {
    return this.http.get<ScriptResponse<Resposta[]>>(`${this.scriptUrl}?action=readAll`).pipe(
      map(response => {
        if (response.success && response.data) {
          // Garante que o ID seja numérico, se a planilha retornar como string.
          return response.data.map(item => ({ ...item, id: Number(item.id) }));
        }
        console.error('Erro ao buscar respostas (script):', response.error || 'Resposta sem dados');
        throw new Error(response.error || 'Falha ao carregar respostas do script.');
      }),
      catchError(this.handleError)
    );
  }

  // Adiciona uma nova resposta
  // O ID será gerado pelo script/planilha, então não é enviado aqui.
  addResposta(novaRespostaData: Omit<Resposta, 'id'>): Observable<Resposta> {
    const payload = {
      action: 'create',
      data: novaRespostaData
    };
    return this.http.post<ScriptResponse<Resposta>>(this.scriptUrl, payload).pipe(
      map(response => {
        if (response.success && response.data) {
          return { ...response.data, id: Number(response.data.id) }; // Garante ID numérico
        }
        console.error('Erro ao adicionar resposta (script):', response.error || response.message);
        throw new Error(response.error || response.message || 'Falha ao adicionar resposta.');
      }),
      catchError(this.handleError)
    );
  }

  // Atualiza uma resposta existente
  updateResposta(respostaAtualizada: Resposta): Observable<Resposta> {
    const payload = {
      action: 'update',
      id: respostaAtualizada.id, // O ID é crucial aqui
      data: respostaAtualizada
    };
    return this.http.post<ScriptResponse<Resposta>>(this.scriptUrl, payload).pipe(
      map(response => {
        if (response.success && response.data) {
          return { ...response.data, id: Number(response.data.id) }; // Garante ID numérico
        }
        console.error('Erro ao atualizar resposta (script):', response.error || response.message);
        throw new Error(response.error || response.message || 'Falha ao atualizar resposta.');
      }),
      catchError(this.handleError)
    );
  }

  // Exclui uma resposta pelo ID
  deleteResposta(id: number): Observable<void> {
    const payload = {
      action: 'delete',
      id: id
    };
    return this.http.post<ScriptResponse<never>>(this.scriptUrl, payload).pipe(
      map(response => {
        if (response.success) {
          return; // Sucesso, não retorna dados específicos
        }
        console.error('Erro ao excluir resposta (script):', response.error || response.message);
        throw new Error(response.error || response.message || 'Falha ao excluir resposta.');
      }),
      catchError(this.handleError)
    );
  }

  // Manipulador de erro genérico para requisições HTTP
  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Ocorreu um erro desconhecido!';
    if (error.error instanceof ErrorEvent) {
      // Erro do lado do cliente ou de rede
      errorMessage = `Erro: ${error.error.message}`;
    } else {
      // O backend retornou um código de resposta sem sucesso.
      // O corpo da resposta pode conter pistas sobre o que deu errado.
      errorMessage = `Erro do servidor: ${error.status}, ${error.message}`;
      if (error.error && typeof error.error === 'string') {
        try {
          const scriptError = JSON.parse(error.error);
          if(scriptError && scriptError.error) {
            errorMessage += ` Detalhes: ${scriptError.error}`;
          }
        } catch (e) {
          // Não era JSON, usar o erro como string
          errorMessage += ` Detalhes: ${error.error}`;
        }
      } else if (error.error && error.error.error) {
         errorMessage += ` Detalhes: ${error.error.error}`;
      }
    }
    console.error(errorMessage);
    return throwError(() => new Error(errorMessage));
  }
}
