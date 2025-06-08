import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class GroqService {
  private apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
  private apiKey = environment.groqApiKey;

  constructor(private http: HttpClient) {}

  resumirDescricao(descricao: string): Observable<any> {
    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`
    });

    const body = {
      model: 'llama3-8b-8192',
      messages: [
        { role: 'system', content: 'Resuma o texto a seguir em poucas palavras, sem acrescentar detalhes, apenas o que está sendo solicitado.' },
        { role: 'user', content: descricao }
      ],
      max_tokens: 100
    };

    return this.http.post(this.apiUrl, body, { headers });
  }
}
