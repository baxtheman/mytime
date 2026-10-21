// Informazioni: cos'è l'app, privacy, servizi esterni, attribuzioni.

import { APP_NAME, APP_VERSION, AUTHOR, REPO_URL } from '../config.js';
import { h } from './dom.js';
import { attribution } from './map.js';

export default {
  id: 'info',
  title: 'Informazioni',
  mount(el) {
    const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener', text });
    el.append(
      h(
        'section',
        { class: 'card prose' },
        h('h2', { text: APP_NAME }),
        h('p', { text: `Versione ${APP_VERSION}. Registra arrivo e partenza dai luoghi con data, ora e posizione GPS, e crea report testuali da condividere.` }),
      ),
      h(
        'section',
        { class: 'card prose' },
        h('h2', { text: 'Dove sono i tuoi dati' }),
        h('p', { text: 'Tutti i dati restano solo in questo browser (IndexedDB). Nessun server salva i tuoi dati: non ci sono account, sincronizzazione cloud né telemetria.' }),
        h('p', { text: 'Se cancelli i dati del sito o disinstalli l’app, le visite vengono perse: esporta regolarmente un backup dalle Impostazioni.' }),
        h('p', { text: 'Su iPhone e iPad l’app installata nella schermata Home ha un archivio separato da Safari.' }),
      ),
      h(
        'section',
        { class: 'card prose' },
        h('h2', { text: 'Servizi esterni' }),
        h('p', {}, 'Per trasformare le coordinate in un indirizzo leggibile, le coordinate di arrivo, partenza e dei luoghi vengono inviate al servizio ', link('https://nominatim.org/', 'Nominatim'), ' di OpenStreetMap (', link('https://osmfoundation.org/wiki/Privacy_Policy', 'informativa privacy OSMF'), '). L’app non le salva su alcun server; gli indirizzi ottenuti restano sul dispositivo.'),
        h('p', { text: 'La mappa (attiva di serie, disattivabile nelle Impostazioni) scarica le tile da tile.openstreetmap.org e la libreria Leaflet da unpkg.com (messa in cache al primo avvio). L’app usa i font di sistema: nessun font viene scaricato.' }),
        attribution(),
      ),
      h(
        'section',
        { class: 'card prose' },
        h('h2', { text: 'Permessi' }),
        h('p', { text: 'La posizione viene letta solo quando tocchi Check-in, Check-out o "Usa posizione attuale": mai in background.' }),
      ),
      h(
        'section',
        { class: 'card prose' },
        h('h2', { text: 'Crediti' }),
        h('p', {}, 'Ideata e sviluppata da ', link(AUTHOR.url, AUTHOR.name), '.'),
        h('p', {}, 'Codice sorgente su ', link(REPO_URL, 'GitHub'), '. Hai trovato un problema o hai un’idea? ', link(`${REPO_URL}/issues`, 'Apri una segnalazione'), '.'),
        h('p', { text: 'Realizzata con:' }),
        h(
          'ul',
          {},
          h('li', {}, link('https://leafletjs.com/', 'Leaflet'), ' – libreria per le mappe (licenza BSD-2-Clause)'),
          h('li', {}, link('https://www.openstreetmap.org/copyright', 'OpenStreetMap'), ' – mappe e dati degli indirizzi (licenza ODbL)'),
          h('li', {}, link('https://nominatim.org/', 'Nominatim'), ' – ricerca degli indirizzi dalle coordinate'),
        ),
      ),
    );
    return {};
  },
};
