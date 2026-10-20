# Registro Presenze

PWA single-page in italiano per registrare arrivo e partenza dai luoghi con data/ora, posizione GPS obbligatoria, indirizzo leggibile (Nominatim), note e report testuali da condividere via email.

- HTML, CSS e JavaScript vanilla con moduli ES nativi: **nessuna build**, i file si servono così come sono.
- Tutti i dati restano nel browser (IndexedDB). Nessun server, account, cloud o telemetria.
- Funziona offline dopo il primo caricamento (service worker).
- Font di sistema (San Francisco su iOS, Roboto su Android): nessun font scaricato.

## Avvio in locale

```bash
npx serve .
# oppure
python3 -m http.server 8000
```

Apri `http://localhost:3000` (serve) o `http://localhost:8000` (Python). `localhost` è considerato un contesto sicuro: GPS e service worker funzionano anche senza HTTPS.

> Dopo ogni modifica ai file, ricarica con la cache del service worker svuotata (DevTools › Application › Service workers › "Update on reload"), oppure incrementa la versione della cache (vedi sotto).

## Test su telefono

Su un indirizzo di rete locale (es. `http://192.168.1.10:8000`) **GPS e service worker non funzionano**: serve HTTPS. Opzioni:

- tunnel HTTPS: `npx localtunnel --port 8000`, `cloudflared tunnel --url http://localhost:8000` o `ngrok http 8000`;
- certificato locale con [mkcert](https://github.com/FiloSottile/mkcert) e un server che lo usi (es. `npx http-server -S -C cert.pem -K key.pem`);
- Android via USB: `chrome://inspect` › Port forwarding da `localhost:8000` del telefono al computer.

Su iOS vanno provati un **iPhone reale** con Safari e con l'app installata: il simulatore non basta per GPS e condivisione.

## Pubblicazione

Qualsiasi hosting statico HTTPS: GitHub Pages, Netlify, Cloudflare Pages. Tutti i percorsi sono relativi, quindi l'app funziona anche in una sottocartella (es. `https://utente.github.io/registro-presenze/`).

- **GitHub Pages**: push del repository, Settings › Pages › branch `main`, cartella `/`.
- **Netlify / Cloudflare Pages**: nessun comando di build, cartella di pubblicazione = radice del progetto.

Il file `sw.js` non deve essere servito con cache lunga (gli hosting citati usano già valori adatti).

### Installazione

- **Android (Chrome)**: menu ⋮ › "Installa app", oppure il pulsante "Installa" che l'app mostra in home.
- **iOS / iPadOS 16.4+ (Safari)**: Condividi › "Aggiungi alla schermata Home". L'app mostra una scheda di aiuto in Safari.
  - L'app installata ha un **archivio separato** da Safari: le visite inserite nel browser non compaiono nell'app installata. Prima di installare, esporta un backup (la scheda di aiuto lo propone) e reimportalo nell'app installata.
  - Safari può cancellare i dati dei siti non installati dopo 7 giorni senza utilizzo: su iOS l'installazione è il modo consigliato di usare l'app.

## Struttura

```text
index.html            app shell, meta tag Apple, viewport-fit=cover
manifest.json         manifest PWA (percorsi relativi)
sw.js                 service worker: precache, strategie di cache, aggiornamenti
css/app.css           stili (mobile-first, tema chiaro/scuro, aree sicure)
js/app.js             avvio, routing, registrazione SW, sincronizzazione tra schede
js/config.js          costanti (versione app, limiti, palette, URL Leaflet)
js/db.js              accesso IndexedDB (unico modulo che lo usa)
js/geo.js             GPS, distanze, piattaforma, messaggi di errore
js/geocode.js         Nominatim: coda, limite 1 richiesta/s, cache
js/report.js          calcoli del report e testo per email
js/io.js              export JSON/CSV, validazione import
js/format.js          date, ore, durate, periodi in italiano
js/ui/*.js            schermate e componenti
icons/                192, 512, 512 maskable, 180 apple-touch-icon, favicon
```

Schermate in `js/ui/`: `presence.js` (home, check-in/out), `history.js`, `reportScreen.js`, `places.js`, `settings.js`, `about.js`, `onboarding.js`. Componenti: `dom.js` (helper DOM, dialoghi, toast, condivisione file), `filters.js` (filtri condivisi Cronologia/Report), `visits.js` (voce e modifica visita), `placeForm.js`, `position.js` (flusso GPS), `map.js` (Leaflet opzionale), `install.js` (installazione e persistenza), `theme.js`.

## Modello dati IndexedDB

Database `registro-presenze`, versione 1. Tutte le date sono stringhe ISO UTC (`toISOString()`); le durate si calcolano sempre come differenza di timestamp.

| Store | Chiave | Indici | Contenuto |
| --- | --- | --- | --- |
| `places` | `id` | `sortOrder`, `deletedAt` | luoghi: `name`, `lat`, `lon`, `accuracy`, `radius`, `address`, `color`, `description`, `sortOrder`, `deletedAt` (soft delete), `createdAt`, `updatedAt` |
| `visits` | `id` | `placeId`, `arrival`, `status` | visite: `placeId`, `status` (`open`/`closed`), `arrival`, `departure`, `timeZone`, `arrivalPos`/`departurePos` (`{lat, lon, accuracy, at}`), `arrivalAddress`/`departureAddress` (`{text, status, geocodedAt, edited, attempts}`), `note`, `flags`, `original`, `createdAt`, `updatedAt` |
| `geocache` | `key` (`"lat4,lon4"`) | — | `{ key, address, raw, fetchedAt }`, valida 90 giorni |
| `meta` | `key` | — | `lastBackupAt`, `nominatimEmail`, `installHintDismissedAt`, `mapEnabled`, `onboardedAt`, `firstUseAt`, `stillHere`, `maxVisitMs` |

`flags`: `edited`, `manualDeparture`, `outOfRange`, `lowAccuracy`, più `needsClose` per le visite rimaste aperte dopo un import con più visite aperte (vanno chiuse a mano).

`meta.maxVisitMs` è la durata massima di una visita chiusa: `listVisits` la usa come margine all'indietro sull'indice `arrival`, così trova anche le visite iniziate prima del periodo ma che vi si sovrappongono.

Le migrazioni stanno nell'array `MIGRATIONS` di `db.js`, una funzione per ogni versione, eseguite in sequenza in `onupgradeneeded`. Per una nuova versione: aggiungi la funzione, incrementa `DB_VERSION` in `js/config.js`.

### Funzioni principali di `db.js`

| Funzione | Descrizione |
| --- | --- |
| `getOpenVisit()` | visita aperta o `null` (indice `status`) |
| `checkIn({ placeId, pos, note, flags })` | crea la visita; la verifica "nessun'altra visita aperta" e la scrittura avvengono nella stessa transazione readwrite (sicuro con più schede) |
| `checkOut(id, { pos, note })` / `checkOut(id, { manualDeparture })` | chiude con posizione GPS, o con orario retroattivo (`manualDeparture`) |
| `updateVisit(id, changes)` | modifica orari/luogo/nota/indirizzi; marca `edited` e salva `original`; impedisce di riaprire una visita se ne esiste un'altra aperta |
| `findOverlaps(id, arrival, departure)` | visite sovrapposte (per l'avviso) |
| `deleteVisit(id)` / `restoreVisit(visit)` | eliminazione e "Annulla" |
| `listVisits(range, filters, { offset, limit })` | visite che si sovrappongono al periodo, dalla più recente, paginate (`nextOffset`, `done`) |
| `getPlaces()`, `savePlace(place)`, `reorderPlaces(ids)`, `deletePlace(id, 'keep' \| 'purge')` | luoghi |
| `exportAll()`, `importAll(data, 'replace' \| 'merge')` | backup; l'import è un'unica transazione (tutto o niente) |
| `getMeta`, `setMeta`, `getGeocache`, `putGeocache` | impostazioni e cache indirizzi |
| `onChange(fn)` | notifiche di modifica, anche dalle altre schede (`BroadcastChannel("registro-presenze")`) |

Ogni errore IndexedDB viene convertito in `AppError` con un messaggio in italiano e l'azione suggerita (`wrapError`).

## Nuova versione: incrementare la cache

A ogni rilascio:

1. in `sw.js` incrementa `CACHE_VERSION` (es. `'v1'` → `'v2'`): la cache diventa `registro-presenze-v2` e in `activate` quelle vecchie vengono eliminate (la cache delle tile `registro-presenze-tiles` è conservata);
2. in `js/config.js` aggiorna `APP_VERSION`;
3. se aggiungi o rinomini file, aggiorna l'elenco `SHELL` in `sw.js`.

Gli utenti vedono il banner "Nuova versione disponibile · Aggiorna": il tap invia `SKIP_WAITING` al nuovo service worker e ricarica la pagina.

## Strategie di cache

| Risorsa | Strategia |
| --- | --- |
| App shell (HTML, CSS, JS, icone, manifest) | precache + cache-first |
| Leaflet da unpkg (versionato) | precache all'installazione + cache-first |
| Tile OpenStreetMap | stale-while-revalidate, massimo 200 voci |
| Nominatim | solo rete (cache propria in IndexedDB) |

## Servizi esterni

- **Nominatim** (`nominatim.openstreetmap.org`): reverse geocoding, nel rispetto della [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (al massimo 1 richiesta ogni 1100 ms, timeout 10 s, cache 90 giorni, nessuna ripetizione automatica; dopo 3 tentativi falliti l'indirizzo passa a `failed` e compare "Riprova indirizzo"). L'app si identifica con il Referer e con l'email facoltativa configurabile nelle Impostazioni.
- **Leaflet** (unpkg.com) e **tile OpenStreetMap**, solo se la mappa è attivata nelle Impostazioni.

Indirizzi e mappe © contributori OpenStreetMap, dati con licenza [ODbL](https://opendatacommons.org/licenses/odbl/).
