import { Component, OnInit, OnDestroy, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, MatPaginator } from '@angular/material/paginator';
import { MatTableDataSource } from '@angular/material/table';
import { RespostaCompletaModalComponent } from '../resposta-completa-modal/resposta-completa-modal.component';
import { EditableTextDisplayComponent } from '../editable-text-display/editable-text-display.component';

import { FirestoreRespostaService, Resposta } from '../services/firestore-resposta.service';

@Component({
  selector: 'app-resposta-padrao',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ClipboardModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTableModule,
    MatPaginatorModule,
    RespostaCompletaModalComponent,
    EditableTextDisplayComponent
  ],
  templateUrl: './resposta-padrao.component.html',
  styleUrls: ['./resposta-padrao.component.scss']
})
export class RespostaPadraoComponent implements OnInit, OnDestroy, AfterViewInit {
  textoCopiadoDoModal: string = '';

  allRespostas: Resposta[] = [];
  respostasFiltradas: Resposta[] = [];
  dataSource = new MatTableDataSource<Resposta>([]);
  
  @ViewChild(MatPaginator) paginator!: MatPaginator;
  
  // Colunas para exibição na mat-table
  displayedColumns: string[] = ['assunto', 'resposta', 'criador', 'acoes'];
  
  // Opções de paginação
  pageSizeOptions = [5, 10, 25, 50];
  pageSize = 5; // Alterado para 5 registros por página como padrão

  assuntoAtual: string = '';
  respostaAtual: string = '';
  criadorAtual: string = '';
  
  // Filtros
  filtroGeral: string = '';
  filtroAssunto: string = '';
  filtroResposta: string = '';
  filtroCriador: string = '';
  filtroPalavrasChave: string = '';
  
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
      // Se não há ID, carrega todas as respostas para referência
      this.carregarRespostas(); 
    }
  }

  ngOnDestroy(): void {
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
    }
  }
  
  ngAfterViewInit(): void {
    // Conecta o paginador ao dataSource com um timeout para evitar o erro ExpressionChangedAfterItHasBeenChecked
    setTimeout(() => {
      this.dataSource.paginator = this.paginator;
      
      // Força o tamanho da página para 5 após a inicialização do paginator
      if (this.paginator) {
        this.paginator.pageSize = this.pageSize;
        this.paginator.pageIndex = 0;
      }
    });
  }
  
  // Método para tratar eventos de paginação
  onPageChange(event: any): void {
    console.log('Página alterada:', event);
    // Este evento é acionado quando o usuário muda de página ou altera o tamanho da página
    // O dataSource com o paginator já deve atualizar automaticamente a visualização
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
        this.allRespostas = respostasAtualizadas;
        // Atualiza as respostasFiltradas e o dataSource
        this.respostasFiltradas = respostasAtualizadas;
        
        // Inicializa o dataSource com os dados e configurações de página
        this.dataSource = new MatTableDataSource<Resposta>(respostasAtualizadas);
        
        // Reconecta o paginador se ele já estiver inicializado
        if (this.paginator) {
          this.dataSource.paginator = this.paginator;
          this.paginator.pageSize = this.pageSize;
          this.paginator.pageIndex = 0;
        }
        
        // Aplica os filtros se necessário
        this.aplicarFiltros();
        
        this.loading = false;
      },
      error: (err: any) => {
        console.error('Erro ao carregar respostas:', err);
        this.error = 'Falha ao carregar respostas. Por favor, tente novamente.';
        this.loading = false;
      }
    });
  }

  aplicarFiltros(): void {
    // Limpa qualquer mensagem de erro mostrada anteriormente
    this.error = null;
    
    // Começamos com todas as respostas
    let resultados = [...this.allRespostas];

    // Função auxiliar para verificar correspondência em todos os campos
    const verificarCorrespondenciaEmTodosCampos = (resposta: Resposta, termo: string): boolean => {
      const assuntoMatch = resposta.assunto && typeof resposta.assunto === 'string' && resposta.assunto.toLowerCase().includes(termo);
      const respostaMatch = resposta.resposta && typeof resposta.resposta === 'string' && resposta.resposta.toLowerCase().includes(termo);
      const criadorMatch = resposta.criador && typeof resposta.criador === 'string' && resposta.criador.toLowerCase().includes(termo);
      return !!(assuntoMatch || respostaMatch || criadorMatch);
    };

    // Filtro geral (pesquisa em todos os campos)
    if (this.filtroGeral.trim()) {
      const termoGeral = this.filtroGeral.toLowerCase().trim();
      resultados = resultados.filter(r => verificarCorrespondenciaEmTodosCampos(r, termoGeral));
    }

    // Filtro por assunto (agora também busca em todos os campos)
    if (this.filtroAssunto.trim()) {
      const termoAssunto = this.filtroAssunto.toLowerCase().trim();
      resultados = resultados.filter(r => verificarCorrespondenciaEmTodosCampos(r, termoAssunto));
    }

    // Filtro por texto da resposta (agora também busca em todos os campos)
    if (this.filtroResposta.trim()) {
      const termoResposta = this.filtroResposta.toLowerCase().trim();
      resultados = resultados.filter(r => verificarCorrespondenciaEmTodosCampos(r, termoResposta));
    }

    // Filtro por criador (agora também busca em todos os campos)
    if (this.filtroCriador.trim()) {
      const termoCriador = this.filtroCriador.toLowerCase().trim();
      resultados = resultados.filter(r => verificarCorrespondenciaEmTodosCampos(r, termoCriador));
    }

    // Filtro por palavras-chave (pesquisa múltiplas palavras em todos os campos)
    if (this.filtroPalavrasChave.trim()) {
      const palavrasChave = this.filtroPalavrasChave.toLowerCase().trim().split(/\s+/);
      resultados = resultados.filter(resposta => {
        // Texto combinado de todos os campos para facilitar a pesquisa
        const textoCompleto = [
          resposta.assunto || '',
          resposta.resposta || '',
          resposta.criador || ''
        ].join(' ').toLowerCase();
        
        // Todas as palavras-chave devem estar presentes
        return palavrasChave.every(palavra => textoCompleto.includes(palavra));
      });
    }

    // Atualiza a lista de respostas filtradas e o dataSource para a tabela
    this.respostasFiltradas = resultados;
    this.dataSource.data = resultados;
    
    // Garante que o paginador resete para a primeira página após a filtragem
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
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

  limparFiltros(): void {
    this.filtroGeral = '';
    this.filtroAssunto = '';
    this.filtroResposta = '';
    this.filtroCriador = '';
    this.filtroPalavrasChave = '';
    this.aplicarFiltros();
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
      // Limpa qualquer mensagem de erro anterior
      this.error = null;
      
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
