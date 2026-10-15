import {
  Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FirestoreTrackingService } from '../services/firestore-tracking.service';
import {
  Atividade,
  PADRAO_HORA,
  ROTULO_STATUS_ATUAL,
  ROTULO_STATUS_ATIVIDADE,
  StatusAtividade,
  TicketAcompanhado,
  dataHoraLegivel,
  statusAtualDe
} from './tracking.model';

/**
 * Acompanhamento de um ticket: mostra os dados salvos e permite registrar,
 * editar e excluir as atividades realizadas no atendimento.
 */
@Component({
  selector: 'app-ticket-tracking',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ticket-tracking.component.html',
  styleUrls: ['./ticket-tracking.component.scss']
})
export class TicketTrackingComponent implements OnChanges {
  /** Número do ticket a acompanhar. */
  @Input() numero: string = '';
  @Input() aberto: boolean = false;

  @Output() fechar = new EventEmitter<void>();
  /** Emitido quando algo muda, para o painel/lista recarregarem os resumos. */
  @Output() alterado = new EventEmitter<void>();

  readonly rotuloStatus = ROTULO_STATUS_ATIVIDADE;

  ticket: TicketAcompanhado | null = null;
  atividades: Atividade[] = [];

  /** Primeira carga do ticket (mostra o carregando no lugar do conteúdo). */
  carregando: boolean = false;
  salvando: boolean = false;
  erro: string = '';
  /** Confirmação breve depois de salvar, para deixar claro que a atividade entrou. */
  sucesso: string = '';
  private sucessoTimer: any = null;

  @ViewChild('descricaoEl') descricaoEl?: ElementRef<HTMLTextAreaElement>;

  // Formulário de atividade
  formData: string = hoje();
  formHora: string = agoraHora();
  formDescricao: string = '';
  formStatus: StatusAtividade = 'em_andamento';
  /** Já vem preenchido com o último nome usado neste navegador. */
  formUsuario: string = '';
  editandoId: string | null = null;

  /** Nomes usados recentemente neste navegador, sugeridos no campo de usuário. */
  usuariosRecentes: string[] = [];

  constructor(private tracking: FirestoreTrackingService) {
    this.usuariosRecentes = lerUsuariosRecentes();
    this.formUsuario = this.usuariosRecentes[0] ?? '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['aberto']?.currentValue === true || (this.aberto && changes['numero'])) {
      // Ao abrir (ou trocar de ticket) começa sempre com o formulário limpo
      this.limparFormulario();
      this.erro = '';
      this.sucesso = '';
      this.carregar();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.aberto) {
      this.fechar.emit();
    }
  }

  /** Mesmo status atual exibido na coluna da lista (o da atividade mais recente). */
  get situacao(): string {
    return this.ticket ? ROTULO_STATUS_ATUAL[statusAtualDe(this.ticket)] : '—';
  }

  get situacaoClasse(): string {
    if (!this.ticket) return 'neutro';
    const s = statusAtualDe(this.ticket);
    return s === 'concluida' ? 'ok' : s === 'em_andamento' ? 'andamento' : 'neutro';
  }

  get local(): string {
    if (!this.ticket) return '—';
    const partes = [this.ticket.rua, this.ticket.num, this.ticket.bairro].filter(Boolean);
    return partes.length ? partes.join(', ') : '—';
  }

  get horaValida(): boolean {
    return !this.formHora || PADRAO_HORA.test(this.formHora);
  }

  get formValido(): boolean {
    return !!this.formData
      && !!this.formHora && this.horaValida
      && this.formDescricao.trim().length >= 3
      && this.formUsuario.trim().length >= 2;
  }

  /**
   * Carrega o ticket e as atividades.
   * `primeiraCarga = false` (depois de salvar) atualiza os dados sem tirar o formulário
   * da tela — antes ele era destruído e recriado a cada recarga.
   */
  async carregar(primeiraCarga = true): Promise<void> {
    if (!this.numero) return;
    if (primeiraCarga) this.carregando = true;
    try {
      const [ticket, atividades] = await Promise.all([
        this.tracking.obter(this.numero),
        this.tracking.listarAtividades(this.numero)
      ]);
      this.ticket = ticket;
      this.atividades = atividades;
    } catch (e: any) {
      this.erro = this.mensagem(e);
    } finally {
      this.carregando = false;
    }
  }

  async salvarAtividade(): Promise<void> {
    if (!this.formValido || this.salvando) return;
    this.salvando = true;
    this.erro = '';
    this.sucesso = '';

    const editando = !!this.editandoId;
    const atividade: Atividade = {
      data: this.formData,
      hora: this.formHora,
      descricao: this.formDescricao,
      status: this.formStatus,
      usuario: normalizarNome(this.formUsuario)
    };

    try {
      if (this.editandoId) {
        await this.tracking.atualizarAtividade(this.numero, this.editandoId, atividade);
      } else {
        await this.tracking.adicionarAtividade(this.numero, atividade);
      }
      this.usuariosRecentes = lembrarUsuario(atividade.usuario);
      this.limparFormulario();
      await this.carregar(false);
      this.alterado.emit();
      this.avisarSucesso(editando ? 'Atividade atualizada.' : 'Atividade adicionada. Você já pode registrar a próxima.');
    } catch (e: any) {
      console.error('[Acompanhamento] Falha ao salvar a atividade', e);
      this.erro = this.mensagem(e);
    } finally {
      this.salvando = false;
    }
  }

  editar(atividade: Atividade): void {
    this.editandoId = atividade.id ?? null;
    this.formData = atividade.data;
    this.formHora = atividade.hora ?? '';
    this.formDescricao = atividade.descricao;
    this.formStatus = atividade.status;
    this.formUsuario = atividade.usuario ?? '';
    this.sucesso = '';
  }

  /** Preenche data e hora com o momento atual. */
  usarAgora(): void {
    this.formData = hoje();
    this.formHora = agoraHora();
  }

  private avisarSucesso(texto: string): void {
    this.sucesso = texto;
    clearTimeout(this.sucessoTimer);
    this.sucessoTimer = setTimeout(() => (this.sucesso = ''), 4000);
    // Devolve o foco à descrição para registrar a próxima atividade em sequência
    setTimeout(() => this.descricaoEl?.nativeElement.focus());
  }

  cancelarEdicao(): void {
    this.limparFormulario();
  }

  async excluir(atividade: Atividade): Promise<void> {
    if (!atividade.id) return;
    const texto = `Excluir a atividade de ${dataHoraLegivel(atividade.data, atividade.hora)}?`;
    if (!confirm(texto)) return;

    this.salvando = true;
    this.erro = '';
    this.sucesso = '';
    try {
      await this.tracking.removerAtividade(this.numero, atividade.id);
      if (this.editandoId === atividade.id) {
        this.limparFormulario();
      }
      await this.carregar(false);
      this.alterado.emit();
    } catch (e: any) {
      this.erro = this.mensagem(e);
    } finally {
      this.salvando = false;
    }
  }

  /** Remove o ticket do acompanhamento, junto com todas as atividades. */
  async removerAcompanhamento(): Promise<void> {
    const aviso = `Remover o ticket ${this.numero} do acompanhamento?\n\n`
      + `As ${this.atividades.length} atividade(s) registradas também serão excluídas. Esta ação não pode ser desfeita.`;
    if (!confirm(aviso)) return;

    this.salvando = true;
    this.erro = '';
    try {
      await this.tracking.remover(this.numero);
      this.alterado.emit();
      this.fechar.emit();
    } catch (e: any) {
      this.erro = this.mensagem(e);
    } finally {
      this.salvando = false;
    }
  }

  dataHora(data?: string, hora?: string): string {
    return dataHoraLegivel(data, hora);
  }

  classeStatus(status: StatusAtividade): string {
    return status === 'concluida' ? 'ok' : 'andamento';
  }

  private limparFormulario(): void {
    this.editandoId = null;
    this.formData = hoje();
    this.formHora = agoraHora();
    this.formDescricao = '';
    this.formStatus = 'em_andamento';
    // Mantém o usuário: normalmente a mesma pessoa registra várias atividades seguidas
    this.formUsuario = this.usuariosRecentes[0] ?? this.formUsuario;
  }

  private mensagem(erro: any): string {
    const codigo = erro?.code ?? '';
    if (codigo === 'permission-denied') {
      return 'O Firestore recusou a gravação (permission-denied). As regras publicadas no Firebase estão '
        + 'desatualizadas em relação ao app: publique novamente o arquivo firestore.rules '
        + '(firebase deploy --only firestore:rules).';
    }
    if (codigo === 'unavailable' || codigo === 'failed-precondition') {
      return 'Não foi possível falar com o Firestore. Confirme que o banco de dados foi criado no projeto '
        + 'e que há conexão.';
    }
    return erro?.message || 'Falha ao acessar o acompanhamento.';
  }
}

const CHAVE_USUARIOS = 'tickets-garbo:usuarios-recentes';
const MAX_USUARIOS = 10;

/** Remove espaços extras para que "Maria  Silva" e "Maria Silva" contem como o mesmo nome. */
function normalizarNome(nome: string): string {
  return (nome ?? '').replace(/\s+/g, ' ').trim();
}

function lerUsuariosRecentes(): string[] {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_USUARIOS) ?? '[]');
    return Array.isArray(bruto) ? bruto.filter(n => typeof n === 'string' && n.trim()) : [];
  } catch {
    return [];
  }
}

/** Coloca o nome no topo da lista de recentes (sem duplicar) e devolve a lista atualizada. */
function lembrarUsuario(nome: string): string[] {
  const atual = lerUsuariosRecentes().filter(n => n.toLowerCase() !== nome.toLowerCase());
  const lista = [nome, ...atual].slice(0, MAX_USUARIOS);
  try {
    localStorage.setItem(CHAVE_USUARIOS, JSON.stringify(lista));
  } catch {
    // Armazenamento indisponível (modo privado, cota): a sugestão só não persiste
  }
  return lista;
}

function hoje(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function agoraHora(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
