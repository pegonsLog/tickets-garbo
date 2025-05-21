import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StreetSearchComponent } from './street-search/street-search.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, StreetSearchComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'tickets';
}
