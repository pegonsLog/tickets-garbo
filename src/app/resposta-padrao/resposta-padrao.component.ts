import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field'; // Ensure present
import { MatButtonModule } from '@angular/material/button'; // Ensure present
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RespostaCompletaModalComponent } from '../resposta-completa-modal/resposta-completa-modal.component';
import { EditableTextDisplayComponent } from '../editable-text-display/editable-text-display.component'; // Importar o novo componente


// MatTableDataSource might still be used for filtering logic even without mat-table, so let's keep its import for now if it's used in the class.
// However, MatTableModule itself is removed.
import { FirestoreRespostaService, Resposta } from '../services/firestore-resposta.service'; // Import service and interface from Firestore

@Component({
  selector: 'app-resposta-padrao',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ClipboardModule,
    MatInputModule,
    MatFormFieldModule, // Ensure present
    MatButtonModule,    // Ensure present
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    RespostaCompletaModalComponent, // Adicionado aqui pois será usado no template ou aberto programaticamente,
    EditableTextDisplayComponent // Adicionar o novo componente aos imports
  ],
  templateUrl: './resposta-padrao.component.html',
  styleUrls: ['./resposta-padrao.component.scss']
})
export class RespostaPadraoComponent implements OnInit, OnDestroy {
  textoCopiadoDoModal: string = ''; // Nova propriedade para armazenar o texto do modal

  allRespostas: Resposta[] = [];
  respostasFiltradas: Resposta[] = []; // Para o ngFor no HTML

  assuntoAtual: string = '';
  respostaAtual: string = '';
  criadorAtual: string = ''; // Novo campo para o formulário
  filtroGeral: string = '';
  
  editIndex: number | null = null; // Índice da resposta em edição (ou null se nova)
  idRespostaEmEdicao: string | null = null; // ID da resposta em edição (Firestore ID é string)

  loading: boolean = false;
  error: string | null = null;

  private dataSubscription: Subscription | undefined;

  constructor(
    private router: Router, 
    private route: ActivatedRoute, 
    private firestoreRespostaService: FirestoreRespostaService, 
    private clipboard: Clipboard,
    public dialog: MatDialog // Injetar MatDialog
  ) {}

  ngOnInit(): void {
    // Verifica se há um ID na rota para carregar para edição
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) { // idParam é string | null. Se não for null, é o ID string.
      this.carregarRespostaParaEdicao(idParam);
    } else {
      // Se não há ID, carrega todas as respostas para referência (se necessário para alguma lógica)
      // ou simplesmente prepara para uma nova entrada.
      // A lógica atual de carregarRespostas() já popula allRespostas, o que pode ser útil
      // para evitar duplicidade de assuntos, por exemplo, mesmo ao criar um novo.
      this.carregarRespostas(); 
    }
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
  }

  // Método para abrir o modal de resposta completa
  abrirModalRespostaCompleta(resposta: string): void {
    const dialogRef = this.dialog.open(RespostaCompletaModalComponent, {
      width: '80vw', // Usar viewport width para melhor responsividade
      maxWidth: '700px',
      maxHeight: '80vh',
      data: { textoCompleto: resposta },
      autoFocus: false // Para evitar foco automático em elementos dentro do modal se não desejado
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.textoCopiadoDoModal = result;
      }
    });
  }

  carregarRespostas(): void {
    this.loading = true;
    this.error = null;
    this.dataSubscription = this.firestoreRespostaService.getRespostas().subscribe({
      next: (respostasAtualizadas: Resposta[]) => {
        this.allRespostas = [...respostasAtualizadas]; // Cria uma cópia para evitar mutação do cache do serviço
        this.aplicarFiltros(); // Popula respostasFiltradas
        this.loading = false;
      },
      error: (err: any) => {
        console.error('Erro ao carregar respostas:', err);
        this.error = 'Falha ao carregar respostas. Verifique sua conexão ou a API Key.';
        this.loading = false;
      }
    });
  }

  aplicarFiltros(): void {
    if (!this.filtroGeral.trim()) {
      this.respostasFiltradas = [...this.allRespostas];
    } else {
      const termo = this.filtroGeral.toLowerCase().trim();
      this.respostasFiltradas = this.allRespostas.filter(r => {
        const termoLower = termo.toLowerCase(); // termo já é lowercase e trimmed
        const assuntoMatch = r.assunto && typeof r.assunto === 'string' && r.assunto.toLowerCase().includes(termoLower);
        const respostaMatch = r.resposta && typeof r.resposta === 'string' && r.resposta.toLowerCase().includes(termoLower);
        const criadorMatch = r.criador && typeof r.criador === 'string' && r.criador.toLowerCase().includes(termoLower);
        return !!(assuntoMatch || respostaMatch || criadorMatch);
      });
    }
  };

  navigateToStreetSearch(): void {
    this.router.navigate(['/street-search']);
  }

  salvarResposta(): void {
    if (!this.assuntoAtual.trim() || !this.respostaAtual.trim() || !this.criadorAtual.trim()) { // Adiciona verificação para criador
      this.error = 'Assunto e Resposta não podem estar vazios.';
      this.loading = false; // Reset loading state
      return;
    }
    this.loading = true;
    this.error = null; // Clear previous errors

    if (this.editIndex !== null && this.idRespostaEmEdicao) {
      const respostaParaSalvar: Resposta = {
        id: this.idRespostaEmEdicao,
        assunto: this.assuntoAtual.trim(),
        resposta: this.respostaAtual.trim(),
        criador: this.criadorAtual.trim() // Adiciona criador
      };
      this.firestoreRespostaService.updateResposta(respostaParaSalvar).subscribe({
        next: (res) => {
          const index = this.allRespostas.findIndex(r => r.id === res.id);
          if (index !== -1) this.allRespostas[index] = res;
          this.aplicarFiltros(); 
          this.limparCampos();
          this.loading = false;
        },
        error: (err: any) => {
          console.error('Erro ao atualizar resposta:', err);
          this.error = err.message || 'Falha ao atualizar resposta.';
          this.loading = false;
        }
      });
    } else {
      const novaResposta = {
        assunto: this.assuntoAtual.trim(),
        resposta: this.respostaAtual.trim(),
        criador: this.criadorAtual.trim() // Adiciona criador aqui também
      };
      this.firestoreRespostaService.addResposta(novaResposta).subscribe({
        next: (novaRespostaComId: Resposta) => { // Firestore service returns the full object with ID
          // this.allRespostas.push(novaRespostaComId); // Removido: getRespostas() atualiza a lista automaticamente.
          this.aplicarFiltros();
          this.limparCampos();
          this.loading = false;
        },
        error: (err: any) => {
          console.error('Erro ao adicionar resposta:', err);
          this.error = err.message || 'Falha ao adicionar resposta.';
          this.loading = false;
        }
      });
    }
    // Para forçar o refresh da planilha em uma próxima leitura, se necessário:
    // this.respostaPadraoService.invalidateCache(); 
  }

  limparCampos(): void {
    this.assuntoAtual = '';
    this.respostaAtual = '';
    this.criadorAtual = ''; // Limpa criador
    this.editIndex = null;
    this.idRespostaEmEdicao = null;
    this.error = null;
  }

  copiarResposta(texto: string): void {
    if (this.clipboard.copy(texto)) {
      alert('Resposta copiada para a área de transferência!');
    } else {
      alert('Falha ao copiar resposta.');
    }
  }

  editarResposta(resp: Resposta, index: number): void {
    this.assuntoAtual = resp.assunto;
    this.respostaAtual = resp.resposta;
    this.criadorAtual = resp.criador; // Carrega criador para edição
    this.editIndex = index; // Ou poderia ser o índice em allRespostas se mais robusto
    this.idRespostaEmEdicao = resp.id;
    window.scrollTo(0, 0); // Rola para o topo para o formulário de edição
  }

  excluirResposta(resp: Resposta, index: number): void {
    // O 'index' aqui pode ser do 'respostasFiltradas'. Para robustez, usamos o ID.
    if (confirm(`Tem certeza que deseja excluir a resposta sobre "${resp.assunto}"?`)) {
      this.loading = true;
      this.firestoreRespostaService.deleteResposta(resp.id).subscribe({ // resp.id is now string
        next: () => {
          this.allRespostas = this.allRespostas.filter(r => r.id !== resp.id);
          // Se editIndex correspondia ao item excluído, resetar campos
          if (this.idRespostaEmEdicao === resp.id) {
            this.limparCampos();
          }
          this.aplicarFiltros(); // Atualiza respostasFiltradas
          this.loading = false;
        },
        error: (err: any) => {
          console.error('Erro ao excluir resposta:', err);
          this.error = 'Falha ao excluir resposta.';
          this.loading = false;
        }
      });
    }
  }

  private handleSaveError(err: any): void {
    console.error('Erro ao salvar resposta:', err);
    this.error = 'Falha ao salvar resposta.';
    this.loading = false;
  }

  private carregarRespostaParaEdicao(id: string): void { // ID é string
    this.loading = true;
    this.error = null;
    // Primeiro, garante que todas as respostas estão carregadas no cache do serviço
    this.dataSubscription = this.firestoreRespostaService.getRespostaById(id).subscribe({
      next: (resposta: Resposta | undefined) => { // firestoreRespostaService.getRespostaById(id) retorna Resposta | undefined
        if (resposta) {
          this.assuntoAtual = resposta.assunto;
          this.respostaAtual = resposta.resposta;
          this.criadorAtual = resposta.criador;
          this.idRespostaEmEdicao = resposta.id; // id já é string

          if (this.allRespostas.length > 0) {
            const indexNaLista = this.allRespostas.findIndex(r => r.id === id);
            this.editIndex = indexNaLista !== -1 ? indexNaLista : null;
          } else {
            this.editIndex = null; 
            // Considerar carregar allRespostas se for essencial para outras funcionalidades.
            // this.carregarRespostas(); 
          }
        } else {
          this.error = 'Resposta não encontrada para edição.';
          this.router.navigate(['/resposta-padrao']);
        }
        this.loading = false;
      },
      error: (err: any) => {
        console.error('Erro ao carregar resposta para edição:', err);
        this.error = 'Falha ao carregar dados para edição.';
        this.loading = false;
        this.router.navigate(['/resposta-padrao']); // Redireciona em caso de erro
      }
    });
  }
}
