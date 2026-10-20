# Registro Presenze — Specifica PWA

Oct 20, 2026 · @Daniele Baggio

## Obiettivo e perimetro

Crea una Progressive Web App single-page, in italiano, chiamata "Registro Presenze": registra arrivo e partenza da luoghi con data/ora, posizione GPS obbligatoria, indirizzo leggibile, note e report testuali condivisibili via email.

- **Dati**: tutti i dati dell'utente restano nel browser (IndexedDB). Nessun server salva dati, nessun account, nessuna sincronizzazione cloud, nessuna telemetria.
- **Servizi esterni ammessi**: risorse statiche (font, librerie da CDN, tile di mappa) e il reverse geocoding Nominatim. Le coordinate inviate a Nominatim non vengono salvate dall'app su alcun server.
- **Piattaforma target**: Chrome per Android (ultime 2 versioni) e Safari su iOS/iPadOS 16.4 o successivo, sia nel browser sia installata nella schermata Home. Desktop Chrome/Edge/Firefox/Safari devono funzionare.
- **Lingua e formati**: interfaccia, date, ore e numeri in italiano (`it-IT`).

## Vincoli tecnici e PWA

HTML, CSS e JavaScript vanilla, senza build: i file si servono così come sono da qualsiasi hosting statico HTTPS.

**Stack**

- Moduli ES nativi (`<script type="module">`), nessun framework.
- Dati principali solo in IndexedDB. `localStorage` è ammesso solo per preferenze non critiche (tema).
- Librerie esterne ammesse: Leaflet per la mappa opzionale. Font da Google Fonts ammessi, con fallback ai font di sistema.
- `crypto.randomUUID()` per gli id, con fallback basato su `crypto.getRandomValues()`.

**Offline**

- Dopo il primo caricamento, check-in, check-out, cronologia, report e condivisione funzionano senza rete.
- Il service worker mette in precache l'app shell (HTML, CSS, JS, icone, manifest) e, al primo caricamento, anche le risorse da CDN e i font.
- Strategie: cache-first per l'app shell e le risorse versionate; network-only per Nominatim; tile della mappa stale-while-revalidate con limite di 200 voci.
- Offline la mappa può risultare vuota: va mostrato "Mappa non disponibile offline".

**Aggiornamenti**

- Nome della cache con versione (es. `registro-presenze-v3`); in `activate` le cache vecchie vengono eliminate.
- Quando un nuovo service worker è in attesa, mostra il banner "Nuova versione disponibile · Aggiorna", che invia `SKIP_WAITING` e ricarica la pagina.

**Installabilità**

- `manifest.json` con `name`, `short_name`, `lang: "it"`, `start_url: "./"`, `scope: "./"`, `display: "standalone"`, `theme_color`, `background_color`.
- Icone 192 e 512 px, più una 512 px con `purpose: "maskable"`.
- Tutti i percorsi relativi, così l'app funziona anche in una sottocartella (es. GitHub Pages).

**Persistenza**

- All'avvio chiama `navigator.storage.persist()`; se restituisce `false`, ritenta dopo l'evento `appinstalled` e al primo check-in.
- Nelle Impostazioni mostra lo stato ("Archiviazione persistente: attiva / non attiva") e lo spazio usato (`navigator.storage.estimate()`).
- Promemoria di backup: se l'ultimo export risale a più di 30 giorni, mostra un avviso in home.

**iOS / Safari**

- **Installazione manuale**: Safari non ha prompt di installazione (`beforeinstallprompt` non esiste). Se l'app gira in Safari e non è in modalità standalone (`navigator.standalone !== true` e `display-mode: standalone` falso), mostra una scheda di aiuto: "Tocca Condividi, poi Aggiungi alla schermata Home". La scheda si può chiudere e non riappare per 30 giorni.
- **Meta tag Apple** in `index.html`: `apple-touch-icon` 180×180 px, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, più `viewport-fit=cover`.
- **Aree sicure**: layout con `env(safe-area-inset-*)` per notch e barra Home, in particolare per il pulsante grande di check-in in basso.
- **Dati separati**: su iOS l'app installata ha un archivio IndexedDB distinto da quello di Safari. I dati inseriti nel browser non compaiono nell'app installata. All'installazione va detto chiaramente, e la scheda di aiuto propone "Esporta prima di installare" se esistono già visite.
- **Cancellazione dei dati**: Safari può eliminare i dati dei siti non installati dopo 7 giorni senza utilizzo. Il banner in Safari deve spiegarlo e invitare a installare l'app; l'installazione è il modo raccomandato di usarla su iOS.
- **Persistenza**: `navigator.storage.persist()` va chiamata anche su iOS, ma il ritentativo su `appinstalled` non è disponibile; su iOS si ritenta al primo avvio in modalità standalone.
- **Geolocalizzazione**: in modalità standalone iOS può richiedere di nuovo il permesso a ogni sessione. Il messaggio di diniego deve rimandare a Impostazioni › Privacy › Localizzazione › Siti Safari e spiegare l'opzione "Posizione esatta".
- **Condivisione**: Web Share API con testo e file (CSV) è supportata da Safari iOS; `navigator.share` va chiamata solo dentro un gesto dell'utente (tap), mai dopo un'attesa asincrona lunga come una query lenta. Il testo del report va quindi preparato prima del tap.
- **Download dei file**: su iOS il download con `<a download>` apre un'anteprima invece di salvare. Per export CSV/JSON usa prima `navigator.share({ files })`, poi il download come fallback.
- **Input data/ora**: usa `<input type="datetime-local">` nativo, che su iOS apre il selettore di sistema; nessun date picker personalizzato.
- **Test obbligatori su iOS**: iPhone reale con Safari e con l'app installata; il simulatore non basta per GPS e condivisione.

## Luoghi

Ogni luogo ha coordinate obbligatorie, acquisite dal GPS alla creazione: così il check-in può verificare che l'utente sia davvero lì.

- **Campi**: nome (obbligatorio, max 80 caratteri), coordinate (obbligatorie), raggio di tolleranza (default 150 m, regolabile 50–1000 m), indirizzo (precompilato da Nominatim, modificabile), colore (una palette di 8 colori), nota descrittiva opzionale.
- **Creazione**: il pulsante "Usa posizione attuale" acquisisce le coordinate. Senza posizione valida il luogo non si può salvare.
- **Correzione della posizione**: con la mappa Leaflet attiva l'utente può trascinare il segnaposto; senza mappa può solo ripetere l'acquisizione GPS stando sul posto.
- **Riordino**: trascinamento con maniglia, più pulsanti "Su/Giù" per l'accessibilità. L'ordine si salva in `sortOrder`.
- **Eliminazione**: soft delete (`deletedAt`). Se il luogo ha visite, l'app chiede:
  - "Conserva le visite": il luogo sparisce dagli elenchi di scelta ma nome e colore restano visibili in cronologia e report, marcati "(eliminato)";
  - "Elimina anche le visite": cancellazione definitiva di luogo e visite, con conferma che indica il numero di visite.
- Un luogo con una visita aperta non si può eliminare finché la visita non è chiusa.

## Check-in / Check-out

Check-in e check-out richiedono entrambi una posizione GPS valida: senza posizione l'operazione è bloccata e l'app offre "Riprova".

**Schermata principale**

- Nessuna visita aperta: pulsante grande "Check-in".
- Visita aperta: "Sei in: \[luogo\] dalle \[ora\]", durata che si aggiorna ogni minuto e pulsante grande "Check-out".

**Acquisizione della posizione**

- Solo al tap dell'utente, mai in background né con `watchPosition` continuo.
- Opzioni: `enableHighAccuracy: true`, `maximumAge: 0`, `timeout: 20000`.
- Durante l'attesa: "Sto cercando la posizione…" con pulsante "Annulla".
- Precisione: entro 100 m la posizione è accettata; oltre, avviso "Posizione imprecisa (±N m)" con "Riprova" o "Usa comunque". Una posizione accettata con "Usa comunque" viene marcata `lowAccuracy`.
- Errori, ciascuno con il suo messaggio: permesso negato (con istruzioni per riattivarlo su Android e iOS), posizione non disponibile, timeout, contesto non sicuro (HTTP).

**Flusso di check-in**

1. Tap su "Check-in": parte subito l'acquisizione della posizione.
2. L'app propone il luogo salvato più vicino entro il suo raggio; l'utente può sceglierne un altro o crearne uno al volo con la posizione appena acquisita.
3. Se il luogo scelto è più lontano del suo raggio: avviso "Sei a N m da \[luogo\]" con "Conferma" o "Cambia luogo". La visita confermata viene marcata `outOfRange`.
4. Nota opzionale, poi "Conferma check-in".
5. Salvataggio in un'unica transazione che verifica l'assenza di altre visite aperte; il reverse geocoding parte dopo il salvataggio, senza bloccarlo.

**Check-out**

- Stessa acquisizione GPS; la posizione di partenza viene salvata separatamente da quella di arrivo, e anche la partenza viene geocodificata.
- La durata non è un campo salvato: si calcola come `departure − arrival`.

**Check-out dimenticato**

- All'apertura dell'app, se la visita aperta supera 12 ore, compare: "Hai dimenticato il check-out a \[luogo\]?".
- Opzioni: "Sono ancora qui" oppure "Chiudi con orario passato", con selettore data/ora (non prima dell'arrivo, non nel futuro).
- Una chiusura retroattiva non ha posizione di partenza ed è marcata `manualDeparture`: è l'unica eccezione al GPS obbligatorio, ed è sempre visibile in cronologia e report.

**Modifica ed eliminazione**

- Si possono modificare arrivo, partenza, luogo e nota. Le coordinate GPS non sono modificabili.
- Qualsiasi modifica a orari o luogo marca la visita `edited` e conserva i valori originali (`original.arrival`, `original.departure`, `original.placeId`).
- Validazione: partenza ≥ arrivo, nessuna data futura, la modifica non può riaprire una visita se ne esiste già un'altra aperta. Le sovrapposizioni con altre visite sono consentite ma segnalate con un avviso.
- Eliminazione con conferma, seguita da un toast "Visita eliminata · Annulla" valido 8 secondi.

## Reverse geocoding (Nominatim)

Ogni posizione di arrivo e partenza viene convertita in indirizzo con Nominatim di OpenStreetMap, salvata nella visita e mai ricalcolata nei report.

**Richiesta**

- Endpoint: `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat={lat}&lon={lon}&zoom=18&addressdetails=1&accept-language=it`.
- Rispetto della [usage policy di Nominatim](https://operations.osmfoundation.org/policies/nominatim/): massimo 1 richiesta al secondo (coda con intervallo minimo di 1100 ms), nessuna richiesta automatica ripetuta, risultati in cache.
- Il browser non permette di impostare lo User-Agent: l'app si identifica tramite il Referer del proprio dominio e il parametro `email` configurabile nelle Impostazioni (facoltativo).
- Timeout di 10 secondi per richiesta.

**Formato dell'indirizzo**

- Composto dai campi di `address`, non da `display_name`: `{road} {house_number}, {city|town|village|hamlet} ({codice provincia})`.
- Esempio: "Via Rizzoli 3, Bologna (BO)". Se manca la via: località e provincia. Se manca tutto: le coordinate con 5 decimali.
- La sigla di provincia si ricava da `ISO3166-2-lvl6` (es. `IT-BO` → `BO`); fuori dall'Italia si usa il paese.

**Offline e coda**

- Se la richiesta fallisce o si è offline, la visita resta salvata con stato `pending`.
- La coda si elabora all'evento `online`, all'avvio dell'app e al ritorno in primo piano (`visibilitychange`).
- Dopo 3 tentativi falliti lo stato diventa `failed` e compare "Riprova indirizzo" sulla visita.

**Cache**

- Store `geocache`, con chiave = coordinate arrotondate a 4 decimali (circa 11 m); validità 90 giorni.
- Prima di chiamare Nominatim l'app controlla la cache.

**Correzione e attribuzione**

- L'utente può correggere a mano l'indirizzo rilevato; la visita conserva l'indirizzo originale e marca `addressEdited`.
- Nella schermata Informazioni e sotto la mappa: "Indirizzi e mappe © contributori OpenStreetMap", con link alla licenza ODbL.
- Nella schermata Informazioni va dichiarato che le coordinate vengono inviate a Nominatim per ottenere l'indirizzo.

## Cronologia e filtri

La cronologia elenca le visite dalla più recente, raggruppate per giorno di arrivo in ora locale, con filtri condivisi con la schermata Report.

- **Voce**: colore e nome del luogo, ora di arrivo e partenza, durata, indirizzo rilevato, nota (troncata a 2 righe).
- **Indicatori**: "In corso", "Modificata", "Chiusa manualmente", "Fuori raggio", "Posizione imprecisa", "Indirizzo in attesa".
- **Intestazione del giorno**: data estesa ("lunedì 19 ottobre 2026") e totale ore del giorno.
- **Visite a cavallo della mezzanotte**: compaiono nel giorno di arrivo, con l'ora di partenza seguita dalla data ("01:30 del 20/10").
- **Periodi**: Giorno, Settimana (ISO, da lunedì a domenica), Mese, Anno, Intervallo personalizzato. Frecce "precedente/successivo" e pulsante "Oggi".
- **Altri filtri**: uno o più luoghi; ricerca testuale su nome luogo, indirizzo e nota, senza distinzione tra maiuscole e accenti.
- **Criterio di inclusione**: una visita rientra nel periodo se si sovrappone ad esso anche solo in parte.
- **Prestazioni**: caricamento a pagine di 50 visite usando l'indice `arrival`; scorrimento fluido fino a 10.000 visite.

## Report e condivisione

Il report è un testo semplice, pensato per essere incollato o inviato in un'email; il grafico a barre resta solo nell'interfaccia.

**Contenuti**

- Numero di visite, tempo totale, durata media (solo visite chiuse).
- Per ogni luogo: numero di visite e tempo totale, ordinati per tempo decrescente.
- Per ogni giorno: primo arrivo e ultima partenza.
- Dettaglio opzionale delle visite, con indirizzi rilevati e indicatori.
- **Ritaglio sul periodo**: per i totali conta solo la parte di visita che cade nel periodo. Una visita dalle 22:00 alle 02:00 vale 2 h in ciascuno dei due giorni.
- **Visita aperta**: esclusa dai totali, citata a parte come "In corso dalle \[ora\]".

**Opzioni prima della condivisione**

- Livello di dettaglio: "Solo riepilogo" oppure "Riepilogo + dettaglio visite".
- Includere o no note e indirizzi.
- Anteprima del testo, modificabile prima dell'invio.

**Condivisione**

1. `navigator.share({ title, text })`: menu di condivisione nativo su Android e iOS (Gmail, Mail, Outlook, WhatsApp…). Il testo va preparato prima del tap.
2. Fallback `mailto:` con oggetto e corpo codificati (`encodeURIComponent`, a capo come `%0D%0A`). Oltre 1800 caratteri il corpo viene accorciato al solo riepilogo, con avviso.
3. "Copia negli appunti", sempre disponibile.
4. Opzionale: allegare il CSV del periodo con `navigator.share({ files })`, se `navigator.canShare` lo consente.

**Regole di formato**

- Solo testo semplice: niente Markdown, tabelle o allineamenti con spazi, perché i client email usano font proporzionali.
- Una riga per informazione; righe vuote tra le sezioni.
- Durate nel formato "2 h 05 min"; date "gg/mm/aaaa"; ore "hh:mm".
- Oggetto email: "Registro presenze – \[periodo\]".

**Template**

```text
REGISTRO PRESENZE
Periodo: 12/10/2026 – 18/10/2026

RIEPILOGO
Visite totali: 9
Tempo totale: 38 h 20 min
Durata media: 4 h 16 min

PER LUOGO
• Ufficio Bologna – 5 visite – 31 h 05 min
• Cliente Rossi – 3 visite – 6 h 10 min
• Magazzino – 1 visita – 1 h 05 min

DETTAGLIO
Lun 12/10/2026 (primo arrivo 08:42, ultima partenza 17:31)
  Ufficio Bologna
  08:42 – 17:31 (8 h 49 min)
  Arrivo: Via Rizzoli 3, Bologna (BO) ±12 m
  Nota: riunione trimestrale

Mar 13/10/2026 (primo arrivo 09:15, ultima partenza 11:20)
  Cliente Rossi
  09:15 – 11:20 (2 h 05 min) [orari modificati]
  Arrivo: Via Emilia 120, San Lazzaro di Savena (BO) ±35 m

Generato il 20/10/2026 alle 17:54 con Registro Presenze
```

## Import ed export

L'export JSON è il backup completo e versionato; il CSV serve per Excel e fogli di calcolo.

**JSON**

- Struttura: `{ "format": "registro-presenze", "schemaVersion": 1, "appVersion", "exportedAt", "places": [...], "visits": [...] }`. La `geocache` non viene esportata.
- Nome file: `registro-presenze-AAAA-MM-GG.json`. Dopo l'export si aggiorna la data dell'ultimo backup.

**CSV**

- Separatore `;`, codifica UTF-8 con BOM, a capo `\r\n`.
- Colonne: data, luogo, arrivo, partenza, durata (minuti), durata (testo), indirizzo arrivo, indirizzo partenza, lat/lon arrivo, lat/lon partenza, precisione, nota, indicatori.
- Numeri decimali con la virgola; date e ore in ora locale.
- Protezione da formula injection: le celle che iniziano con `=`, `+`, `-`, `@`, tab o a capo vengono precedute da un apostrofo.

**Import JSON**

- Validazione prima di qualsiasi scrittura: `format`, `schemaVersion` supportata, campi obbligatori, date ISO valide, riferimenti `placeId` esistenti. Gli errori elencano le righe non valide.
- Riepilogo prima della conferma: "N luoghi e M visite, di cui X nuovi e Y in conflitto".
- Modalità:
  - "Sostituisci tutto": viene prima creato automaticamente un backup scaricabile dei dati attuali;
  - "Unisci": a parità di `id` vince il record con `updatedAt` più recente.
- Se dopo l'unione risultano più visite aperte, resta aperta solo la più recente e le altre vengono segnalate per la chiusura manuale.
- Tutta l'importazione avviene in un'unica transazione: o va a buon fine per intero o non cambia nulla.
- Visite importate con indirizzo mancante entrano nella coda di geocoding.

## Modello dati IndexedDB

Database `registro-presenze`, versione 1, con quattro object store; tutte le date sono stringhe ISO in UTC generate con `toISOString()`.

**`places`** — chiave `id`; indici `sortOrder`, `deletedAt`

| Campo | Tipo | Obbligatorio | Note |
| --- | --- | --- | --- |
| id | stringa UUID | sì | chiave primaria |
| name | stringa | sì | max 80 caratteri |
| lat, lon | numero | sì | gradi decimali |
| accuracy | numero (m) | sì | precisione all'acquisizione |
| radius | numero (m) | sì | default 150 |
| address | stringa | no | da Nominatim, modificabile |
| color | stringa | no | esadecimale dalla palette |
| description | stringa | no |  |
| sortOrder | numero | sì | ordine manuale |
| deletedAt | stringa ISO o null | no | soft delete |
| createdAt, updatedAt | stringa ISO | sì |  |

**`visits`** — chiave `id`; indici `placeId`, `arrival`, `status`

| Campo | Tipo | Obbligatorio | Note |
| --- | --- | --- | --- |
| id | stringa UUID | sì | chiave primaria |
| placeId | stringa | sì | riferimento a `places` |
| status | "open" o "closed" | sì | indice per trovare la visita aperta |
| arrival | stringa ISO | sì |  |
| departure | stringa ISO o null | no | null = visita aperta |
| timeZone | stringa IANA | sì | es. "Europe/Rome", da `Intl.DateTimeFormat().resolvedOptions()` |
| arrivalPos | `{lat, lon, accuracy, at}` | sì | posizione GPS al check-in |
| departurePos | `{lat, lon, accuracy, at}` o null | no | null solo se `manualDeparture` |
| arrivalAddress, departureAddress | `{text, status, geocodedAt, edited}` | no | `status`: pending, ok, failed |
| note | stringa | no | max 1000 caratteri |
| flags | array di stringhe | sì | `edited`, `manualDeparture`, `outOfRange`, `lowAccuracy` |
| original | `{arrival, departure, placeId}` o null | no | valori prima della prima modifica |
| createdAt, updatedAt | stringa ISO | sì |  |

**`geocache`** — chiave `key` ("lat4,lon4"): `{ key, address, raw, fetchedAt }`.

**`meta`** — chiave `key`: impostazioni e stato (`lastBackupAt`, `nominatimEmail`, `installHintDismissedAt`, `schemaVersion`).

**Regole**

- **Una sola visita aperta**: check-in, modifica e import verificano `status = "open"` tramite l'indice e scrivono nella stessa transazione readwrite. Questo è sicuro anche con più schede aperte.
- **Sincronizzazione tra schede**: dopo ogni scrittura, messaggio su `BroadcastChannel("registro-presenze")` per aggiornare le altre schede.
- **Migrazioni**: in `onupgradeneeded` si crea o aggiorna lo schema per ogni versione in sequenza. Su `onblocked` compare "Chiudi le altre schede dell'app per aggiornare"; su `versionchange` la scheda chiude la connessione e ricarica.
- **Errori**: ogni errore IndexedDB (quota superata, transazione interrotta, DB bloccato) mostra un messaggio in italiano con l'azione suggerita; nessun errore viene ignorato in silenzio.
- **Modulo `db.js`**: espone funzioni con Promise (`getOpenVisit`, `checkIn`, `checkOut`, `updateVisit`, `deleteVisit`, `listVisits(range, filters)`, `savePlace`, `deletePlace(mode)`, `exportAll`, `importAll(data, mode)`) e nessun'altra parte dell'app accede direttamente a IndexedDB.

## Date, ore e fuso orario

Si salva in UTC, si mostra in ora locale, si calcola sempre su timestamp: così ordinamento, durate e cambio dell'ora legale restano corretti.

- **Durate**: differenza in millisecondi tra `departure` e `arrival`, mai sottrazione di ore e minuti locali. Il 25 ottobre 2026, giorno del ritorno all'ora solare, una visita dalle 01:00 alle 04:00 dura 4 h.
- **Confini dei periodi**: inizio e fine di giorno, settimana, mese e anno calcolati in ora locale, poi convertiti in UTC per la query sull'indice `arrival`.
- **Visite in un altro fuso**: mostrate con l'ora del fuso salvato in `timeZone`, con la sigla del fuso accanto (es. "09:00 GMT+1") quando diverso da quello del dispositivo.
- **Formattazione**: `Intl.DateTimeFormat("it-IT", …)` per date e ore, `Intl.NumberFormat("it-IT")` per i numeri; durate con una funzione propria ("2 h 05 min"), perché `Intl.DurationFormat` non è disponibile su tutti i browser target.
- **Input**: `<input type="datetime-local">` con conversione esplicita tra valore locale e ISO UTC; valori di default pari all'ora attuale arrotondata al minuto.

## UI/UX e accessibilità

Mobile-first, utilizzabile con una mano: le azioni principali stanno nella metà inferiore dello schermo.

- **Navigazione**: barra in basso con quattro sezioni: Presenza, Cronologia, Report, Luoghi. Impostazioni e Informazioni da un'icona in alto.
- **Tema**: chiaro, scuro o automatico (`prefers-color-scheme`), scelto nelle Impostazioni; `theme-color` aggiornato di conseguenza.
- **Pulsanti**: check-in e check-out alti almeno 72 px; tutti gli altri bersagli di tocco almeno 48 × 48 px.
- **Tipografia**: testo base 16 px, nessun testo sotto i 13 px; supporto allo zoom del sistema senza rompere il layout.
- **Feedback**: toast di conferma dopo check-in, check-out, salvataggio, import ed eliminazione, annunciati con `aria-live="polite"`. Errori con `role="alert"`.
- **Mappa opzionale**: Leaflet con tile OpenStreetMap, attivabile nelle Impostazioni; l'app è completa anche senza mappa.
- **Grafico a barre**: tempo per luogo, disegnato con HTML/CSS o SVG, senza librerie; ogni barra ha etichetta e valore testuale.
- **Accessibilità**: contrasto WCAG AA, focus visibile, ordine di tabulazione logico, etichette su tutti i campi, rispetto di `prefers-reduced-motion`.
- **Prima apertura**: breve introduzione in 3 schermate (cos'è, permesso di posizione, dove stanno i dati e come fare il backup).

## Deliverable e criteri di accettazione

La consegna è accettata quando il codice è completo e tutti i test qui sotto passano su Android e iPhone reali.

**Struttura dei file**

```text
index.html
manifest.json
sw.js
css/app.css
js/app.js          avvio, routing, registrazione SW
js/db.js           accesso IndexedDB
js/geo.js          GPS e distanze
js/geocode.js      Nominatim, coda e cache
js/report.js       calcoli e testo del report
js/io.js           import/export JSON e CSV
js/format.js       date, ore, durate in italiano
js/ui/*.js         schermate
icons/             192, 512, 512 maskable, 180 apple-touch-icon
README.md
```

**Documentazione nel README**

- Avvio in locale: `npx serve .` o `python3 -m http.server`, apertura su `http://localhost`.
- Test su telefono: serve HTTPS anche in rete locale (es. tunnel o certificato locale), perché GPS e service worker non funzionano su HTTP fuori da `localhost`.
- Pubblicazione su hosting statico HTTPS (GitHub Pages, Netlify, Cloudflare Pages) e installazione su Android e iOS.
- Schema IndexedDB e funzioni principali di `db.js`.
- Come incrementare la versione della cache a ogni rilascio.

**Criteri di accettazione**

- [ ] L'app si installa da Chrome Android e da Safari iOS (Aggiungi alla schermata Home) e si apre in modalità standalone.
- [ ] In modalità aereo: check-in, check-out, cronologia, report e condivisione del testo funzionano.
- [ ] Indirizzi in attesa offline vengono risolti automaticamente al ritorno della rete.
- [ ] Permesso GPS negato: check-in bloccato con messaggio e istruzioni corrette per la piattaforma.
- [ ] Due schede aperte: impossibile creare due visite aperte.
- [ ] Visita a cavallo della mezzanotte e visita durante il cambio dell'ora legale: durate e totali corretti.
- [ ] Report condiviso via Gmail (Android) e Mail (iOS): testo leggibile, accenti corretti, nessun troncamento senza avviso.
- [ ] CSV aperto in Excel italiano: colonne separate, accenti corretti, decimali con virgola.
- [ ] Import di un JSON corrotto o di versione sconosciuta: errore chiaro, nessun dato modificato.
- [ ] Eliminazione di un luogo con "Conserva le visite": nome storico visibile in cronologia e report.
- [ ] Nessuna richiesta di rete diversa da asset statici, tile della mappa e Nominatim (verificato nel pannello Network).
