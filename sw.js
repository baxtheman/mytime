// Service worker di ndóve? (prefisso cache invariato per compatibilità).
// A ogni rilascio incrementare CACHE_VERSION (e APP_VERSION in js/config.js).

const CACHE_VERSION = 'v4';
const PREFIX = 'registro-presenze-';
const SHELL_CACHE = `${PREFIX}${CACHE_VERSION}`;
const TILE_CACHE = `${PREFIX}tiles`; // condivisa tra versioni, max 200 voci
const TILE_LIMIT = 200;

// './' (non './index.html'): server come `npx serve` reindirizzano index.html, e una risposta
// rediretta non può essere usata per una navigazione.
const SHELL = [
  './',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/config.js',
  './js/db.js',
  './js/format.js',
  './js/geo.js',
  './js/geocode.js',
  './js/io.js',
  './js/report.js',
  './js/ui/about.js',
  './js/ui/dom.js',
  './js/ui/filters.js',
  './js/ui/history.js',
  './js/ui/install.js',
  './js/ui/map.js',
  './js/ui/onboarding.js',
  './js/ui/placeForm.js',
  './js/ui/places.js',
  './js/ui/position.js',
  './js/ui/presence.js',
  './js/ui/reportScreen.js',
  './js/ui/settings.js',
  './js/ui/theme.js',
  './js/ui/visits.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

// Risorse da CDN, versionate: messe in cache al primo caricamento anche se la mappa è spenta.
const CDN = ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        SHELL.map(async (u) => {
          const res = await fetch(new Request(u, { cache: 'reload' }));
          if (!res.ok) throw new Error(`Precache fallita: ${u} (${res.status})`);
          await cache.put(u, await unredirect(res));
        }),
      );
      // Il CDN è facoltativo: un errore non deve bloccare l'installazione.
      await Promise.all(
        CDN.map(async (u) => {
          try {
            const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
            if (res.ok) await cache.put(u, res);
          } catch {
            /* offline al primo avvio: la mappa resterà non disponibile */
          }
        }),
      );
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, TILE_CACHE]);
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && !keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

/** Copia senza il flag "redirected" (altrimenti il browser la rifiuta per le navigazioni). */
async function unredirect(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function cacheFirst(request, cacheKey = request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(cacheKey, { ignoreSearch: true });
  if (hit) return hit;
  const res = await unredirect(await fetch(request));
  if (res.ok && (res.type === 'basic' || res.type === 'cors' || res.type === 'default')) cache.put(cacheKey, res.clone());
  return res;
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - TILE_LIMIT; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(event.request);
  const network = fetch(event.request)
    .then(async (res) => {
      if (res.ok || res.type === 'opaque') {
        await cache.delete(event.request); // reinserita in coda: le voci più vecchie escono per prime
        await cache.put(event.request, res.clone());
        await trimTiles(cache);
      }
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(network);
    return hit;
  }
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Nominatim: solo rete, mai in cache nel service worker (la cache è in IndexedDB).
  if (url.hostname === 'nominatim.openstreetmap.org') return;

  if (url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org')) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  if (url.origin === self.location.origin) {
    // Navigazioni: sempre l'app shell (single page).
    if (request.mode === 'navigate') {
      event.respondWith(
        cacheFirst(new Request(self.registration.scope), self.registration.scope).catch(
          async () => (await caches.match(self.registration.scope)) || Response.error(),
        ),
      );
      return;
    }
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.hostname === 'unpkg.com') event.respondWith(cacheFirst(request));
});
