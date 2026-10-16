import { Injectable } from '@angular/core';
import {
  Firestore,
  DocumentData,
  UpdateData,
  WriteBatch,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  writeBatch
} from 'firebase/firestore';
import {
  Atividade,
  TicketAcompanhado,
  idDocumento,
  ordenarAtividades,
  resumoDasAtividades
} from '../tracking/tracking.model';
import { obterFirebaseApp } from './firebase-init';

const COLECAO = 'tickets_acompanhados';
const SUBCOLECAO = 'atividades';

/**
 * Persistência do acompanhamento de tickets no Cloud Firestore.
 *
 * Cada ticket acompanhado é um documento em `tickets_acompanhados`, e suas atividades
 * ficam na subcoleção `atividades` — o "banco vinculado" do acompanhamento.
 *
 * O documento do ticket guarda um resumo (total de atividades, concluídas e data da
 * última), recalculado a cada alteração. Isso permite listar o painel com uma única
 * consulta, sem abrir as subcoleções de todos os tickets.
 */
@Injectable({ providedIn: 'root' })
export class FirestoreTrackingService {
  private bd?: Firestore;

  private db(): Firestore {
    if (!this.bd) {
      this.bd = getFirestore(obterFirebaseApp());
    }
    return this.bd;
  }

  // ===== Tickets acompanhados =====

  /**
   * Leva o ticket para acompanhamento. Se já existir, atualiza o retrato dos dados
   * da planilha sem apagar o histórico nem a data de inclusão.
   */
  async acompanhar(linha: Record<string, string>): Promise<TicketAcompanhado> {
    const numero = (linha['NUMERO'] ?? '').trim();
    const id = idDocumento(numero);
    if (!id) {
      throw new Error('Este ticket não tem número e por isso não pode ser acompanhado.');
    }

    const agora = new Date().toISOString();
    const referencia = doc(this.db(), COLECAO, id);
    const existente = await getDoc(referencia);

    const dados: TicketAcompanhado = {
      numero,
      status: texto(linha['STATUS']),
      responsavel: texto(linha['RESPONSAVEL']),
      origem: texto(linha['ORIGEM']),
      solicitante: texto(linha['SOLICITANTE']),
      dataEntrada: texto(linha['DATA_ENTRADA']),
      assunto: texto(linha['ASSUNTO']),
      classe: texto(linha['CLASSE']),
      rua: texto(linha['RUA']),
      num: texto(linha['NUM']),
      bairro: texto(linha['BAIRRO']),
      regional: texto(linha['REGIONAL']),
      descricao: texto(linha['DESCRICAO']),
      resposta: texto(linha['RESPOSTA']),
      atualizadoEm: agora
    };

    if (!existente.exists()) {
      dados.criadoEm = agora;
      dados.totalAtividades = 0;
      dados.atividadesConcluidas = 0;
    }

    await setDoc(referencia, dados, { merge: true });
    return { ...(existente.data() as TicketAcompanhado | undefined), ...dados };
  }

  /** Lista todos os tickets acompanhados, do mais recente para o mais antigo. */
  async listar(): Promise<TicketAcompanhado[]> {
    const instantaneo = await getDocs(collection(this.db(), COLECAO));
    const itens = instantaneo.docs.map(d => d.data() as TicketAcompanhado);
    return itens.sort((a, b) => (b.criadoEm ?? '').localeCompare(a.criadoEm ?? ''));
  }

  /** Apenas os números acompanhados, para marcar as linhas da lista de tickets. */
  async listarNumeros(): Promise<Set<string>> {
    const itens = await this.listar();
    return new Set(itens.map(t => t.numero));
  }

  async obter(numero: string): Promise<TicketAcompanhado | null> {
    const instantaneo = await getDoc(doc(this.db(), COLECAO, idDocumento(numero)));
    return instantaneo.exists() ? (instantaneo.data() as TicketAcompanhado) : null;
  }

  /**
   * Remove o ticket do acompanhamento.
   *
   * O Firestore não apaga subcoleções em cascata, então as atividades são
   * excluídas explicitamente antes do documento do ticket.
   */
  async remover(numero: string): Promise<void> {
    const id = idDocumento(numero);
    const atividades = await getDocs(collection(this.db(), COLECAO, id, SUBCOLECAO));

    if (!atividades.empty) {
      const lote = writeBatch(this.db());
      atividades.docs.forEach(d => lote.delete(d.ref));
      await lote.commit();
    }

    await deleteDoc(doc(this.db(), COLECAO, id));
  }

  // ===== Atividades =====

  /** Atividades do ticket, da mais recente para a mais antiga (data, hora e registro). */
  async listarAtividades(numero: string): Promise<Atividade[]> {
    const id = idDocumento(numero);
    const consulta = query(collection(this.db(), COLECAO, id, SUBCOLECAO), orderBy('data', 'desc'));
    const instantaneo = await getDocs(consulta);
    return ordenarAtividades(instantaneo.docs.map(d => ({ id: d.id, ...(d.data() as Atividade) })));
  }

  /**
   * Lê as atividades de vários tickets de uma vez (usado pela auditoria).
   * As leituras são feitas em paralelo, em lotes, para não abrir centenas de
   * requisições simultâneas.
   */
  async listarAtividadesDe(numeros: string[], tamanhoLote = 20): Promise<Map<string, Atividade[]>> {
    const resultado = new Map<string, Atividade[]>();
    for (let i = 0; i < numeros.length; i += tamanhoLote) {
      const lote = numeros.slice(i, i + tamanhoLote);
      const listas = await Promise.all(lote.map(n => this.listarAtividades(n)));
      lote.forEach((n, j) => resultado.set(n, listas[j]));
    }
    return resultado;
  }

  /**
   * Adiciona uma atividade ao ticket. Um ticket pode ter quantas atividades forem
   * necessárias: cada uma é um documento novo, com id gerado pelo Firestore.
   *
   * A atividade e o resumo do ticket são gravados no mesmo lote (atômico): ou os
   * dois entram, ou nenhum. Antes eram duas gravações separadas, e uma recusa na
   * segunda deixava a atividade salva com o resumo desatualizado.
   */
  async adicionarAtividade(numero: string, atividade: Atividade): Promise<void> {
    const id = idDocumento(numero);
    const atuais = await this.listarAtividades(numero);

    const referencia = doc(collection(this.db(), COLECAO, id, SUBCOLECAO));
    const nova: Atividade = { ...camposAtividade(atividade), criadoEm: new Date().toISOString() };

    const lote = writeBatch(this.db());
    lote.set(referencia, nova);
    lote.update(doc(this.db(), COLECAO, id), dadosResumo([...atuais, nova]));
    await this.gravar(lote);
  }

  async atualizarAtividade(numero: string, atividadeId: string, atividade: Atividade): Promise<void> {
    const id = idDocumento(numero);
    const atuais = await this.listarAtividades(numero);
    const campos = camposAtividade(atividade);
    const atualizadas = atuais.map(a => (a.id === atividadeId ? { ...a, ...campos } : a));

    const lote = writeBatch(this.db());
    // Sem hora na edição, o campo é removido (em vez de manter um valor antigo)
    const dadosAtividade: UpdateData<DocumentData> = {
      data: campos.data,
      descricao: campos.descricao,
      status: campos.status,
      usuario: campos.usuario,
      hora: campos.hora ?? deleteField()
    };
    lote.update(doc(this.db(), COLECAO, id, SUBCOLECAO, atividadeId), dadosAtividade);
    lote.update(doc(this.db(), COLECAO, id), dadosResumo(atualizadas));
    await this.gravar(lote);
  }

  async removerAtividade(numero: string, atividadeId: string): Promise<void> {
    const id = idDocumento(numero);
    const restantes = (await this.listarAtividades(numero)).filter(a => a.id !== atividadeId);

    const lote = writeBatch(this.db());
    lote.delete(doc(this.db(), COLECAO, id, SUBCOLECAO, atividadeId));
    lote.update(doc(this.db(), COLECAO, id), dadosResumo(restantes));
    await this.gravar(lote);
  }

  /** Grava o lote e troca o erro "not-found" por uma mensagem que explica o que houve. */
  private async gravar(lote: WriteBatch): Promise<void> {
    try {
      await lote.commit();
    } catch (erro: any) {
      if (erro?.code === 'not-found') {
        throw new Error('Este ticket não está mais em acompanhamento (o registro foi removido). '
          + 'Feche a janela e leve o ticket para acompanhamento novamente.');
      }
      throw erro;
    }
  }
}

/** Campos da atividade que são gravados (sem id), já limpos. */
function camposAtividade(a: Atividade): Atividade {
  const campos: Atividade = {
    data: a.data,
    descricao: (a.descricao ?? '').trim(),
    status: a.status,
    usuario: (a.usuario ?? '').replace(/\s+/g, ' ').trim()
  };
  if (a.hora) campos.hora = a.hora;
  return campos;
}

/**
 * Campos do resumo gravados no documento do ticket.
 * Recalcular a partir da lista (em vez de incrementar contadores) mantém o resumo
 * correto depois de edições e exclusões. Sem atividades, o status é removido.
 */
function dadosResumo(atividades: Atividade[]): UpdateData<DocumentData> {
  const r = resumoDasAtividades(atividades);
  return {
    totalAtividades: r.totalAtividades,
    atividadesConcluidas: r.atividadesConcluidas,
    ultimaAtividadeData: r.ultimaAtividadeData,
    ultimaAtividadeHora: r.ultimaAtividadeHora,
    ultimaAtividadeUsuario: r.ultimaAtividadeUsuario,
    ultimaAtividadeStatus: r.ultimaAtividadeStatus ?? deleteField(),
    atualizadoEm: new Date().toISOString()
  };
}

function texto(valor: string | undefined): string {
  return (valor ?? '').trim();
}
