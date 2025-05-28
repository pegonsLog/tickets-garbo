import { Routes } from '@angular/router';
import { StreetSearchSolicitanteComponent } from './street-search-solicitante/street-search-solicitante.component';
import { StreetSearchComponent } from './street-search/street-search.component';

export const routes: Routes = [
  { path: '', component: StreetSearchComponent },
  { path: 'buscar-por-solicitante', component: StreetSearchSolicitanteComponent },
];
