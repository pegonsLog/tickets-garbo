import { Injectable } from '@angular/core';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  docData,
  DocumentReference
} from '@angular/fire/firestore';
import { Observable, from, of, throwError } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';

// Interface para a estrutura de uma resposta
// Adaptada para Firestore (ID como string)
export interface Resposta {
  id: string; // Firestore IDs são strings
  assunto: string;
  resposta: string;
  criador: string;
  // Poderíamos adicionar outros campos como dataCriacao, dataAtualizacao se necessário
}

@Injectable({
  providedIn: 'root'
})
export class FirestoreRespostaService {
  private respostasCollectionPath = 'respostasPadrao';
  private respostasCollection;

  constructor(private firestore: Firestore) {
    this.respostasCollection = collection(this.firestore, this.respostasCollectionPath);
  }

  // Busca todas as respostas
  getRespostas(): Observable<Resposta[]> {
    return collectionData(this.respostasCollection, { idField: 'id' }) as Observable<Resposta[]>;
  }

  // Adiciona uma nova resposta
  addResposta(novaRespostaData: Omit<Resposta, 'id'>): Observable<Resposta> {
    return from(addDoc(this.respostasCollection, novaRespostaData)).pipe(
      switchMap((docRef: DocumentReference) => {
        // Após adicionar, buscamos o documento para retornar o objeto completo com ID
        const newDoc = doc(this.firestore, `${this.respostasCollectionPath}/${docRef.id}`);
        return docData(newDoc, { idField: 'id' }) as Observable<Resposta>;
      }),
      map(data => {
        if (!data) {
          throw new Error('Documento não encontrado após adição.');
        }
        return data;
      }),
      catchError(error => {
        console.error('Erro ao adicionar resposta no Firestore:', error);
        // É importante relançar o erro para que o componente possa tratá-lo, se necessário
        return throwError(() => new Error('Erro ao adicionar resposta: ' + error.message));
      })
    );
  }

  // Busca uma resposta específica pelo ID (método auxiliar, pode ser útil)
  getRespostaById(id: string): Observable<Resposta | undefined> {
    const respostaDoc = doc(this.firestore, `${this.respostasCollectionPath}/${id}`);
    return docData(respostaDoc, { idField: 'id' }) as Observable<Resposta | undefined>;
  }

  // Atualiza uma resposta existente
  // O parâmetro respostaAtualizada deve conter o ID
  updateResposta(respostaAtualizada: Resposta): Observable<Resposta> {
    const { id, ...dataToUpdate } = respostaAtualizada;
    if (!id) {
      // Retorna um Observable que emite um erro imediatamente
      return new Observable(observer => observer.error(new Error('ID da resposta é obrigatório para atualização.')));
    }
    const respostaDocRef = doc(this.firestore, `${this.respostasCollectionPath}/${id}`);
    return from(updateDoc(respostaDocRef, dataToUpdate)).pipe(
      switchMap(() => {
        // Após atualizar, buscamos o documento para retornar o objeto atualizado
        return docData(respostaDocRef, { idField: 'id' }) as Observable<Resposta>;
      }),
      map(data => {
        if (!data) {
          throw new Error('Documento não encontrado após atualização.');
        }
        return data;
      }),
      catchError(error => {
        console.error('Erro ao atualizar resposta no Firestore:', error);
        return throwError(() => new Error('Erro ao atualizar resposta: ' + error.message));
      })
    );
  }

  // Exclui uma resposta pelo ID
  deleteResposta(id: string): Observable<void> {
    if (!id) {
      return new Observable(observer => observer.error(new Error('ID da resposta é obrigatório para exclusão.')));
    }
    const respostaDoc = doc(this.firestore, `${this.respostasCollectionPath}/${id}`);
    return from(deleteDoc(respostaDoc)).pipe(
      catchError(error => {
        console.error('Erro ao excluir resposta no Firestore:', error);
        return throwError(() => new Error('Erro ao excluir resposta: ' + error.message));
      })
    );
  }
}
