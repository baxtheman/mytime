// Reverse geocoding con Nominatim: coda con 1 richiesta ogni 1100 ms, cache 90 giorni,
// nessuna ripetizione automatica (si ritenta solo su avvio, evento online, ritorno in primo piano).

import * as db from './db.js';
import { fmtCoords } from './format.js';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 90 * 86400e3;
const MAX_ATTEMPTS = 3;

let lastRequestAt = 0;
let chain = Promise.resolve();

export function cacheKey(lat, lon) {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** "Via Rizzoli 3, Bologna (BO)" dai campi di address (non da display_name). */
export function formatAddress(json, lat, lon) {
  const a = json?.address;
  if (!a) return fmtCoords(lat, lon);
  const road = a.road || a.pedestrian || a.square || a.footway || a.cycleway || a.path || a.residential;
  const street = road ? [road, a.house_number].filter(Boolean).join(' ') : '';
  const locality = a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || '';
  let area = '';
  if (a.country_code === 'it') {
    const iso = a['ISO3166-2-lvl6'] || '';
    if (iso.startsWith('IT-')) area = iso.slice(3);
  } else if (a.country) {
    area = a.country;
  }
  const where = locality ? (area ? `${locality} (${area})` : locality) : area;
  if (street && where) return `${street}, ${where}`;
  if (street) return street;
  if (where) return where;
  return fmtCoords(lat, lon);
}

function wait(msDelay) {
  return new Promise((r) => setTimeout(r, msDelay));
}

/** Serializza le richieste di rete con l'intervallo minimo richiesto dalla usage policy. */
function throttled(fn) {
  const run = chain.then(async () => {
    const delay = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (delay > 0) await wait(delay);
    lastRequestAt = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function fetchNominatim(lat, lon) {
  const email = await db.getMeta('nominatimEmail', '');
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'it',
  });
  if (email) params.set('email', email);
  return throttled(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${ENDPOINT}?${params}`, { signal: ctrl.signal, referrerPolicy: 'strict-origin-when-cross-origin' });
      if (res.status === 429) {
        const e = new Error('Troppe richieste');
        e.rateLimited = true;
        throw e;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Indirizzo per le coordinate: prima la cache, poi Nominatim. Lancia un errore se offline o in errore. */
export async function reverse(lat, lon) {
  const key = cacheKey(lat, lon);
  const cached = await db.getGeocache(key);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) return cached.address;
  if (!navigator.onLine) throw new Error('offline');
  const json = await fetchNominatim(lat, lon);
  const address = formatAddress(json, lat, lon);
  await db.putGeocache({ key, address, raw: json, fetchedAt: new Date().toISOString() });
  return address;
}

/** Per il modulo luoghi: indirizzo o null, senza errori. */
export async function lookup(lat, lon) {
  try {
    return await reverse(lat, lon);
  } catch {
    return null;
  }
}

let running = false;
let again = false;

/** Elabora la coda degli indirizzi in attesa (ogni indirizzo al massimo un tentativo per chiamata). */
export async function processQueue() {
  if (running) {
    again = true;
    return;
  }
  if (!navigator.onLine) return;
  running = true;
  const work = async () => {
    const tried = new Set();
    do {
      again = false;
      const jobs = (await db.listPendingAddresses()).filter((j) => !tried.has(`${j.visitId}:${j.which}`));
      for (const job of jobs) {
        tried.add(`${job.visitId}:${job.which}`);
        if (!navigator.onLine) return;
        const stop = await runJob(job);
        if (stop) return;
      }
    } while (again);
  };
  try {
    if (navigator.locks?.request) {
      // Una sola scheda alla volta elabora la coda.
      await navigator.locks.request('registro-presenze-geocode', { ifAvailable: true }, (lock) => (lock ? work() : null));
    } else {
      await work();
    }
  } catch (e) {
    console.error('Coda indirizzi', e);
  } finally {
    running = false;
  }
}

async function runJob({ visitId, which, lat, lon }) {
  try {
    const text = await reverse(lat, lon);
    await db.setVisitAddress(visitId, which, { text, status: 'ok', geocodedAt: new Date().toISOString() });
    return false;
  } catch (e) {
    if (e.message === 'offline') return true;
    const v = await db.getVisit(visitId);
    const attempts = (v?.[`${which}Address`]?.attempts || 0) + 1;
    await db.setVisitAddress(visitId, which, { attempts, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' });
    return Boolean(e.rateLimited);
  }
}

/** "Riprova indirizzo": azione esplicita dell'utente. */
export async function retry(visitId, which) {
  await db.resetAddressAttempts(visitId, which);
  await processQueue();
}
