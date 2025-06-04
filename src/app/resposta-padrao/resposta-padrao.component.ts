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

// MatTableDataSource might still be used for filtering logic even without mat-table, so let's keep its import for now if it's used in the class.
// However, MatTableModule itself is removed.
import { RespostaPadraoService, Resposta } from '../services/resposta-padrao.service'; // Import service and interface

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
    MatProgressSpinnerModule
  ],
  templateUrl: './resposta-padrao.component.html',
  styleUrls: ['./resposta-padrao.component.scss']
})
export class RespostaPadraoComponent implements OnInit, OnDestroy {

  allRespostas: Resposta[] = [];
  respostasFiltradas: Resposta[] = []; // Para o ngFor no HTML

  assuntoAtual: string = '';
  respostaAtual: string = '';
  filtroGeral: string = '';
  
  editIndex: number | null = null; // Índice da resposta em edição (ou null se nova)
  idRespostaEmEdicao: number | null = null; // ID da resposta em edição (DEVE SER NUMBER)

  loading: boolean = false;
  error: string | null = null;

  private dataSubscription: Subscription | undefined;

  constructor(
    private router: Router, 
    private route: ActivatedRoute, 
    private respostaPadraoService: RespostaPadraoService, 
    private clipboard: Clipboard
  ) {}

  ngOnInit(): void {
    // Verifica se há um ID na rota para carregar para edição
    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam) {
      const idParaEditar = +idParam; // Converte string para number
      this.carregarRespostaParaEdicao(idParaEditar);
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

  carregarRespostas(): void {
    this.loading = true;
    this.error = null;
    this.dataSubscription = this.respostaPadraoService.getRespostas().subscribe({
      next: (respostas) => {
        this.allRespostas = [...respostas]; // Cria uma cópia para evitar mutação do cache do serviço
        this.aplicarFiltros(); // Popula respostasFiltradas
        this.loading = false;
      },
      error: (err) => {
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
      this.respostasFiltradas = this.allRespostas.filter(r =>
        r.assunto.toLowerCase().includes(termo) ||
        r.resposta.toLowerCase().includes(termo)
      );
    }
  };

  navigateToStreetSearch(): void {
    this.router.navigate(['/street-search']);
  }

  salvarResposta(): void {
    if (!this.assuntoAtual.trim() || !this.respostaAtual.trim()) {
      this.error = 'Assunto e Resposta não podem estar vazios.';
      this.loading = false; // Reset loading state
      return;
    }
    this.loading = true;
    this.error = null; // Clear previous errors

    if (this.editIndex !== null && this.idRespostaEmEdicao) {
      const respostaAtualizada: Resposta = {
        id: this.idRespostaEmEdicao,
        assunto: this.assuntoAtual.trim(),
        resposta: this.respostaAtual.trim()
      };
      this.respostaPadraoService.updateResposta(respostaAtualizada).subscribe({
        next: (res) => {
          const index = this.allRespostas.findIndex(r => r.id === res.id);
          if (index !== -1) this.allRespostas[index] = res;
          this.aplicarFiltros(); 
          this.limparCampos();
          this.loading = false;
        },
        error: (err) => {
          console.error('Erro ao atualizar resposta:', err);
          this.error = err.message || 'Falha ao atualizar resposta.';
          this.loading = false;
        }
      });
    } else {
      const novaResposta = {
        assunto: this.assuntoAtual.trim(),
        resposta: this.respostaAtual.trim()
      };
      this.respostaPadraoService.addResposta(novaResposta).subscribe({
        next: (res) => {
          this.allRespostas.push(res);
          this.aplicarFiltros();
          this.limparCampos();
          this.loading = false;
        },
        error: (err) => {
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
    this.editIndex = index; // Ou poderia ser o índice em allRespostas se mais robusto
    this.idRespostaEmEdicao = resp.id;
    window.scrollTo(0, 0); // Rola para o topo para o formulário de edição
  }

  excluirResposta(resp: Resposta, index: number): void {
    // O 'index' aqui pode ser do 'respostasFiltradas'. Para robustez, usamos o ID.
    if (confirm(`Tem certeza que deseja excluir a resposta sobre "${resp.assunto}"?`)) {
      this.loading = true;
      this.respostaPadraoService.deleteResposta(resp.id!).subscribe({
        next: () => {
          this.allRespostas = this.allRespostas.filter(r => r.id !== resp.id);
          // Se editIndex correspondia ao item excluído, resetar campos
          if (this.idRespostaEmEdicao === resp.id) {
            this.limparCampos();
          }
          this.aplicarFiltros(); // Atualiza respostasFiltradas
          this.loading = false;
        },
        error: (err) => {
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

  private carregarRespostaParaEdicao(id: number): void {
    this.loading = true;
    this.error = null;
    // Primeiro, garante que todas as respostas estão carregadas no cache do serviço
    this.dataSubscription = this.respostaPadraoService.getRespostas().subscribe({
      next: (respostas) => {
        const resposta = respostas.find(r => r.id === id);
        if (resposta) {
          this.assuntoAtual = resposta.assunto;
          this.respostaAtual = resposta.resposta;
          this.idRespostaEmEdicao = resposta.id;
          // Encontrar o índice na lista allRespostas para manter a lógica de editIndex, se necessário
          // Embora, ao carregar por ID, o editIndex possa ser menos crucial se a UI não depender dele diretamente
          const indexNaListaFiltradaOuGeral = this.allRespostas.findIndex(r => r.id === id);
          this.editIndex = indexNaListaFiltradaOuGeral !== -1 ? indexNaListaFiltradaOuGeral : null;
          // Se a lista 'allRespostas' não foi populada antes (caso de entrada direta na edição),
          // podemos precisar populá-la aqui também.
          if (this.allRespostas.length === 0) {
            this.allRespostas = [...respostas];
            this.aplicarFiltros(); // Para popular respostasFiltradas se a UI depender disso
          }
        } else {
          this.error = 'Resposta não encontrada para edição.';
          this.router.navigate(['/resposta-padrao']); // Redireciona se não encontrar
        }
        this.loading = false;
      },
      error: (err) => {
        console.error('Erro ao carregar resposta para edição:', err);
        this.error = 'Falha ao carregar dados para edição.';
        this.loading = false;
        this.router.navigate(['/resposta-padrao']); // Redireciona em caso de erro
      }
    });
  }
}
