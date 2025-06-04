import { Routes } from '@angular/router';
import { StreetSearchSolicitanteComponent } from './street-search-solicitante/street-search-solicitante.component';
import { StreetSearchComponent } from './street-search/street-search.component';
import { RespostaPadraoComponent } from './resposta-padrao/resposta-padrao.component'; // Import RespostaPadraoComponent


export const routes: Routes = [
  { path: '', component: StreetSearchComponent },
  { path: 'street-search', component: StreetSearchComponent },
  { path: 'buscar-por-solicitante', component: StreetSearchSolicitanteComponent },
  { path: 'resposta-padrao/:id', component: RespostaPadraoComponent }, // Rota para editar com ID
  { path: 'resposta-padrao', component: RespostaPadraoComponent }     // Rota para criar novo
];
