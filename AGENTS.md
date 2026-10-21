# AGENTS.md

Guidance for coding agents working on **📍 ndóve?** (formerly "Registro Presenze"): an offline-first PWA, in Italian, for logging arrival and departure at places, with mandatory GPS, Nominatim reverse geocoding and plain-text reports to share by email.

The product specification is in `Registro Presenze — Specifica PWA.md`. When the spec and the code disagree, follow the code and the user decisions listed under "Decisions that differ from the spec", then ask.

## Run

```bash
npm start            # serve.mjs, zero dependencies → http://localhost:8000 (npm start -- 8080 for another port)
npx serve .          # also works → http://localhost:3000
```

- There is no build, no bundler and no `npm install`. Files are served as they are.
- Never open `index.html` as `file://`: ES modules and the service worker won't work.
- `localhost` is a secure context. On a phone over the LAN you need HTTPS (tunnel or mkcert), otherwise GPS and the service worker are unavailable.
- The project is deployed on Vercel (`.vercel/` is ignored). Treat it as plain static hosting.

## Stack and hard constraints

- **Vanilla HTML/CSS/JS with native ES modules.** No frameworks, no build step, no npm runtime dependencies. The only allowed external library is Leaflet 1.9.4 from unpkg, with SRI (URLs and hashes in `js/config.js`).
- **Relative paths everywhere** (`./`), so the app works in a subfolder (GitHub Pages). Never use absolute paths like `/js/...`.
- **User data only in IndexedDB.** `localStorage` is allowed only for the theme (`registro-presenze-theme`). No server, account, sync or telemetry.
- **Allowed network hosts:** the app's own origin, `nominatim.openstreetmap.org`, `unpkg.com` and `tile.openstreetmap.org`. Do not add others (no Google Fonts, no analytics, no other CDNs).
- **System fonts only** (user decision): no web fonts.
- **Italian** for every user-facing string, with dates and numbers in `it-IT`. Comments in the code are also in Italian: follow the surrounding style.

## Map

```text
index.html, manifest.json, sw.js, serve.mjs (dev server), css/app.css
js/config.js     constants: app name, versions, limits, palette, Leaflet URLs
js/db.js         the ONLY module that touches IndexedDB
js/format.js     dates/times/durations/periods (it-IT); pure
js/report.js     report calculations and text; pure
js/io.js         JSON/CSV export, import validation
js/geo.js        GPS (getCurrentPosition), distances, platform, error messages
js/geocode.js    Nominatim: throttled queue, cache, retries
js/app.js        startup, hash routing, SW registration, global errors
js/ui/           screens (presence, history, reportScreen, places, settings, about, onboarding)
                 and components (dom, filters, visits, placeForm, position, map, install, theme)
```

Screen interface: `export default { id, title, mount(el) → { update?(detail), destroy?() } }`, registered in `SCREENS` in `js/app.js`. The route is the hash (`#presenza`, `#cronologia`, `#report`, `#luoghi`, `#impostazioni`, `#info`).

## Invariants: don't break them

1. **IndexedDB only through `db.js`.** Every write function calls `notify(store)`: that is what updates the other tabs (BroadcastChannel) and the current screen.
2. **At most one open visit.** The `status = "open"` check and the write happen in the **same readwrite transaction** (`checkIn`, `updateVisit`, `restoreVisit`, `importAll`). Never split them into separate calls.
3. **Inside `tx()` callbacks, only await IndexedDB requests** from the same transaction. A `fetch` or timer inside would close the transaction.
4. **Times are stored as UTC ISO strings** (`toISOString()`). Durations are always `Date.parse(departure) - Date.parse(arrival)`, never arithmetic on local hours. Duration is never a stored field. Periods are computed in local time with `addDays`/`new Date(y, m, d)`, never by adding `86400e3` (it breaks on the DST change).
5. **GPS only on a user tap.** `acquirePosition()` (`js/ui/position.js`) must be called synchronously from the click handler. Never use `watchPosition` or reads in the background.
6. **`navigator.share` inside the gesture.** Prepare text and files *before* the tap (see `reportScreen.js`). For files use `deliverFile()` (`dom.js`), which falls back to download and asks for a new tap if the gesture has expired. iOS is strict about this.
7. **Nominatim:** go only through `geocode.js` (1100 ms queue, 10 s timeout, `geocache` store for 90 days, at most 3 attempts and then `failed`, no automatic retry loops). Never call it from the service worker.
8. **GPS coordinates of visits are not editable.** Edits to times or place set the `edited` flag and keep `original` on the first edit. A manual address edit keeps `originalText`.
9. **Internal identifiers that must not be renamed:** `DB_NAME`, `CHANNEL_NAME`, `EXPORT_FORMAT` (`registro-presenze`), the `registro-presenze-` cache prefix in `sw.js`, the theme key. The displayed name is `APP_NAME`/`APP_SHORT_NAME`, and file names use `FILE_PREFIX` (`ndove`).
10. **Schema migrations:** add a function to `MIGRATIONS` in `db.js` and increment `DB_VERSION`. Never modify existing migrations. If the backup format changes, update `EXPORT_SCHEMA_VERSION`/`SUPPORTED_SCHEMA_VERSIONS` and `validateBackup`.
11. **No silent errors:** use `showError(err)` (`role="alert"`). IndexedDB errors go through `wrapError` (Italian message plus a suggested action).

## Service worker and releases

On **every** change to files served to the client:

- increment `CACHE_VERSION` in `sw.js` (`v7` → `v8`) and `APP_VERSION` in `js/config.js`;
- if you add, remove or rename a file, update the `SHELL` list in `sw.js`, otherwise the app breaks offline.

Do not precache `./index.html`: the shell is `./`. Some servers (`npx serve`, Vercel with clean URLs) redirect `index.html`, and a redirected response cannot be used for a navigation ("site can't be reached" on reload). `unredirect()` in `sw.js` guards against this. Don't remove it.

`app.js` reloads on `controllerchange` only when a previous controller existed (an update via the "Aggiorna" banner), never on the first install.

## UI and style (user decisions)

- The status comes first. The home screen answers "am I in or out?": status at the top, **one** big action button at the bottom (≥ 72 px), above the tab bar and the safe areas (`env(safe-area-inset-*)`).
- **High contrast.** Light theme with near-black text, and a true black dark theme, not grey on grey. Theme variables live in `:root` and are duplicated for `prefers-color-scheme` and `[data-theme=dark]`: keep both in sync.
- **One accent colour** (blue, `--accent`) for the main action. **Green** (`--live`) only for "in corso". Place colours only as a dot or **left border** (`--c` set with `style.setProperty`, never by concatenating into HTML).
- **Numbers that stand out:** times and durations large, with `font-variant-numeric: tabular-nums`.
- Touch targets ≥ 48 × 48 px, base text 16 px, nothing below 13 px, visible focus, `prefers-reduced-motion` respected, toasts in `aria-live="polite"`.
- Build the DOM with `h()` from `js/ui/dom.js` and `setChildren()` when children may be `null`/`false`. Native `replaceChildren`/`append` would render them as the text "null"/"false". No `innerHTML` with data.
- Dialogs use `openDialog()` (native `<dialog>`). An action's `onClick` returning `false` keeps the dialog open, and a Promise disables the button until it settles.
- Use the native `<input type="datetime-local">`, never a custom date picker.

## Decisions that differ from the spec

- The app is named **📍 ndóve?**. The short name and the home-screen label are `ndóve?`.
- System fonts instead of Google Fonts.
- **The place name is optional.** If it's empty, the name becomes the address and, failing that, `Posizione <lat, lon>`. It is stored as the name at save time; `savePlace` waits for a pending address lookup.
- Visits left open after an import with several open visits get `status: "closed"`, `departure: null` and the `needsClose` flag ("Da chiudere"). They are excluded from totals.
- In the summary-only report there is a `PER GIORNO` section. Days covered only by the after-midnight part of a visit appear as "prosecuzione dal giorno precedente".
- **Map of a visit's GPS points** in the visit dialog: arrival pin "A" (accent), departure pin "P" (text colour), dashed accuracy circles, place radius circle. The map is **on by default** (`getMeta('mapEnabled', true)`: an unset value means on; an explicit `false` from the user is kept). When it's off, the visit map loads only on tapping "Mostra sulla mappa". Each GPS line also has an "Apri in OpenStreetMap" link (`osmUrl()` in `map.js`). No API key: Leaflet + `tile.openstreetmap.org`, respecting the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) (visible attribution, no bulk prefetching).
- `meta.maxVisitMs` is the lookback margin used by `listVisits` to find visits that started before the period.

## Testing

There is no test suite in the repo. Before handing work back:

1. `for f in sw.js serve.mjs js/*.js js/ui/*.js; do node --check "$f"; done`
2. **Pure logic** (`format.js`, `report.js`, `io.js`, `geocode.formatAddress`): import the modules in a Node script with `TZ=Europe/Rome` and check:
   - the 25/10/2026 01:00–04:00 visit = 4 h;
   - a 22:00–02:00 visit = 2 h + 2 h across the two days;
   - the report text against the spec template;
   - the CSV: BOM, `;`, decimal comma, apostrophe before `= + - @`.

   `db.js` opens a BroadcastChannel: end the script with `process.exit()`.
3. **Browser:** headless Chrome (`google-chrome --headless=new --remote-debugging-port=…`) with a CDP script:
   - grant geolocation with `Browser.grantPermissions` and fake it with `Emulation.setGeolocationOverride`;
   - collect `Runtime.exceptionThrown` and console errors;
   - always test **load + reload + offline reload** (`Network.emulateNetworkConditions`) through `npx serve`, not only `python3 -m http.server`.

   Close any leftover Chrome before reusing the debugging port.
4. Port 8000 may be taken by another service on the dev machine: use another port.
5. Some things can't be verified here: install, GPS, share and Mail on a real iPhone and Android. Say so explicitly when they're relevant.

## Git

- Commit only when the user asks.
- Don't commit `.vercel/` or `.env*` (already in `.gitignore`).
