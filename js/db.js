// Unico punto di accesso a IndexedDB. Tutte le funzioni restituiscono Promise.
// Date salvate come stringhe ISO UTC (toISOString()).

import { DB_NAME, DB_VERSION, CHANNEL_NAME, PLACE_NAME_MAX, NOTE_MAX, MIN_RADIUS_M, MAX_RADIUS_M, DEFAULT_RADIUS_M } from './config.js';
import { deviceTimeZone, normalizeText } from './format.js';

// ---------------------------------------------------------------------------
// Errori

export class AppError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
  }
}

export function wrapError(err) {
  if (err instanceof AppError) return err;
  const name = err?.name || '';
  const messages = {
    QuotaExceededError:
      'Spazio di archiviazione esaurito. Esporta un backup dalle Impostazioni, elimina visite vecchie e riprova.',
    AbortError: 'Operazione interrotta: nessun dato è stato modificato. Riprova.',
    ConstraintError: 'Esiste già un elemento con lo stesso identificativo: nessun dato è stato modificato.',
    InvalidStateError: "Il database è stato chiuso, forse da un'altra scheda. Ricarica la pagina.",
    VersionError: "Questa scheda usa una versione vecchia dell'app. Ricarica la pagina.",
    TransactionInactiveError: 'Operazione non completata a causa di un errore interno. Riprova.',
    NotFoundError: "Archivio locale incompleto. Ricarica la pagina; se il problema persiste, esporta un backup e reinstalla l'app.",
    DataError: 'Dati non validi: nessun dato è stato modificato.',
  };
  const msg =
    messages[name] ||
    `Errore dell'archivio locale${name ? ` (${name})` : ''}. Ricarica la pagina; se il problema persiste, esporta un backup dalle Impostazioni.`;
  return new AppError(name || 'IDB', msg, err);
}

// ---------------------------------------------------------------------------
// Notifiche di modifica (questa scheda + altre schede via BroadcastChannel)

const listeners = new Set();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null;

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(detail) {
  for (const fn of listeners) {
    try {
      fn(detail);
    } catch (e) {
      console.error(e);
    }
  }
}

if (channel) channel.onmessage = (e) => emit({ ...e.data, remote: true });

function notify(store) {
  const detail = { store, at: Date.now() };
  try {
    channel?.postMessage(detail);
  } catch (e) {
    console.error(e);
  }
  emit({ ...detail, remote: false });
}

// ---------------------------------------------------------------------------
// Apertura e migrazioni

const MIGRATIONS = [
  // 0 -> 1
  (db) => {
    const places = db.createObjectStore('places', { keyPath: 'id' });
    places.createIndex('sortOrder', 'sortOrder');
    places.createIndex('deletedAt', 'deletedAt');
    const visits = db.createObjectStore('visits', { keyPath: 'id' });
    visits.createIndex('placeId', 'placeId');
    visits.createIndex('arrival', 'arrival');
    visits.createIndex('status', 'status');
    db.createObjectStore('geocache', { keyPath: 'key' });
    db.createObjectStore('meta', { keyPath: 'key' });
  },
];

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new AppError(
          'NO_IDB',
          "Questo browser non permette l'archiviazione locale (IndexedDB). Disattiva la navigazione privata o usa un browser aggiornato.",
        ),
      );
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(wrapError(e));
      return;
    }
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onblocked = () => {
      dispatchEvent(new CustomEvent('db-blocked'));
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        location.reload();
      };
      db.onclose = () => {
        dbPromise = null;
      };
      dispatchEvent(new CustomEvent('db-ready'));
      resolve(db);
    };
    req.onerror = () => reject(wrapError(req.error));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Helper

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

/**
 * Esegue fn dentro una transazione. fn può usare await solo su richieste IndexedDB
 * della stessa transazione. Se fn lancia un errore la transazione viene annullata.
 */
async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    let t;
    try {
      t = db.transaction(stores, mode);
    } catch (e) {
      reject(wrapError(e));
      return;
    }
    let result;
    let failure = null;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(failure || wrapError(t.error || new DOMException('Transazione interrotta', 'AbortError')));
    const s = (name) => t.objectStore(name);
    Promise.resolve()
      .then(() => fn(s, t))
      .then(
        (r) => {
          result = r;
        },
        (err) => {
          failure = err instanceof AppError ? err : wrapError(err);
          try {
            t.abort();
          } catch {
            reject(failure);
          }
        },
      );
  });
}

function each(source, range, direction, onEach) {
  return new Promise((resolve, reject) => {
    const r = source.openCursor(range, direction);
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve(true);
      const ret = onEach(c);
      if (ret === false) return resolve(false);
      if (typeof ret === 'number') c.advance(ret);
      else c.continue();
    };
    r.onerror = () => reject(r.error);
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const nowIso = () => new Date().toISOString();
const ms = (iso) => Date.parse(iso);
const FUTURE_TOLERANCE_MS = 60e3;

function validationError(msg) {
  return new AppError('VALIDATION', msg);
}

async function bumpMaxVisit(s, visits) {
  let max = 0;
  for (const v of visits) if (v.departure) max = Math.max(max, ms(v.departure) - ms(v.arrival));
  if (!max) return;
  const cur = (await req(s('meta').get('maxVisitMs')))?.value || 0;
  if (max > cur) await req(s('meta').put({ key: 'maxVisitMs', value: max }));
}

function newAddress() {
  return { text: null, status: 'pending', geocodedAt: null, edited: false, attempts: 0 };
}

// ---------------------------------------------------------------------------
// Meta e geocache

export async function getMeta(key, fallback = null) {
  const r = await tx(['meta'], 'readonly', (s) => req(s('meta').get(key)));
  return r ? r.value : fallback;
}

export async function setMeta(key, value) {
  await tx(['meta'], 'readwrite', (s) => req(s('meta').put({ key, value })));
  notify('meta');
}

export function getGeocache(key) {
  return tx(['geocache'], 'readonly', (s) => req(s('geocache').get(key)));
}

export function putGeocache(entry) {
  return tx(['geocache'], 'readwrite', (s) => req(s('geocache').put(entry)));
}

// ---------------------------------------------------------------------------
// Luoghi

export async function getPlaces({ includeDeleted = false } = {}) {
  const all = await tx(['places'], 'readonly', (s) => req(s('places').getAll()));
  return all.filter((p) => includeDeleted || !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getPlace(id) {
  return tx(['places'], 'readonly', (s) => req(s('places').get(id)));
}

export async function savePlace(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw validationError('Inserisci il nome del luogo.');
  if (name.length > PLACE_NAME_MAX) throw validationError(`Il nome può avere al massimo ${PLACE_NAME_MAX} caratteri.`);
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lon))
    throw validationError('Posizione mancante: usa "Usa posizione attuale" stando sul posto.');
  const radius = Math.round(Number(input.radius ?? DEFAULT_RADIUS_M));
  if (!(radius >= MIN_RADIUS_M && radius <= MAX_RADIUS_M))
    throw validationError(`Il raggio deve essere tra ${MIN_RADIUS_M} e ${MAX_RADIUS_M} m.`);

  const now = nowIso();
  const place = await tx(['places'], 'readwrite', async (s) => {
    const store = s('places');
    const existing = input.id ? await req(store.get(input.id)) : null;
    let sortOrder = existing?.sortOrder;
    if (sortOrder == null) {
      const all = await req(store.getAll());
      sortOrder = all.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0) + 1;
    }
    const p = {
      id: existing?.id || uuid(),
      name,
      lat: input.lat,
      lon: input.lon,
      accuracy: Math.round(input.accuracy ?? existing?.accuracy ?? 0),
      radius,
      address: String(input.address ?? '').trim() || null,
      color: input.color || null,
      description: String(input.description ?? '').trim() || null,
      sortOrder,
      deletedAt: existing?.deletedAt ?? null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await req(store.put(p));
    return p;
  });
  notify('places');
  return place;
}

export async function reorderPlaces(orderedIds) {
  const now = nowIso();
  await tx(['places'], 'readwrite', async (s) => {
    const store = s('places');
    for (let i = 0; i < orderedIds.length; i++) {
      const p = await req(store.get(orderedIds[i]));
      if (p && p.sortOrder !== i + 1) {
        p.sortOrder = i + 1;
        p.updatedAt = now;
        await req(store.put(p));
      }
    }
  });
  notify('places');
}

export function countVisitsForPlace(placeId) {
  return tx(['visits'], 'readonly', (s) => req(s('visits').index('placeId').count(placeId)));
}

/**
 * mode "keep": soft delete, le visite restano e mostrano il nome storico.
 * mode "purge": elimina definitivamente luogo e visite.
 * @returns {Promise<number>} visite eliminate
 */
export async function deletePlace(id, mode = 'keep') {
  const removed = await tx(['places', 'visits'], 'readwrite', async (s) => {
    const place = await req(s('places').get(id));
    if (!place) throw new AppError('NOT_FOUND', 'Luogo non trovato: forse è stato eliminato in un’altra scheda.');
    const open = await req(s('visits').index('status').get('open'));
    if (open && open.placeId === id)
      throw new AppError('OPEN_VISIT', 'Questo luogo ha una visita in corso: fai il check-out prima di eliminarlo.');
    const count = await req(s('visits').index('placeId').count(id));
    if (mode === 'purge' || count === 0) {
      let n = 0;
      await each(s('visits').index('placeId'), IDBKeyRange.only(id), 'next', (c) => {
        c.delete();
        n++;
      });
      await req(s('places').delete(id));
      return n;
    }
    const now = nowIso();
    place.deletedAt = now;
    place.updatedAt = now;
    await req(s('places').put(place));
    return 0;
  });
  notify('places');
  if (removed) notify('visits');
  return removed;
}

// ---------------------------------------------------------------------------
// Visite

export async function getVisit(id) {
  return tx(['visits'], 'readonly', (s) => req(s('visits').get(id)));
}

export async function getOpenVisit() {
  return (await tx(['visits'], 'readonly', (s) => req(s('visits').index('status').get('open')))) || null;
}

export async function countVisits() {
  return tx(['visits'], 'readonly', (s) => req(s('visits').count()));
}

/**
 * Crea una visita aperta. La verifica "nessun'altra visita aperta" e la scrittura
 * avvengono nella stessa transazione readwrite: sicuro anche con più schede.
 */
export async function checkIn({ placeId, pos, note = '', flags = [] }) {
  if (!pos || !Number.isFinite(pos.lat)) throw new AppError('NO_POSITION', 'Posizione GPS mancante: check-in non possibile.');
  if (note.length > NOTE_MAX) throw validationError(`La nota può avere al massimo ${NOTE_MAX} caratteri.`);
  const now = nowIso();
  const visit = {
    id: uuid(),
    placeId,
    status: 'open',
    arrival: pos.at || now,
    departure: null,
    timeZone: deviceTimeZone(),
    arrivalPos: { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, at: pos.at || now },
    departurePos: null,
    arrivalAddress: newAddress(),
    departureAddress: null,
    note: note.trim(),
    flags: [...new Set(flags)],
    original: null,
    createdAt: now,
    updatedAt: now,
  };
  await tx(['visits', 'places'], 'readwrite', async (s) => {
    const openCount = await req(s('visits').index('status').count('open'));
    if (openCount > 0)
      throw new AppError('OPEN_EXISTS', "C'è già una visita in corso (forse avviata in un'altra scheda). Fai prima il check-out.");
    const place = await req(s('places').get(placeId));
    if (!place || place.deletedAt) throw new AppError('NOT_FOUND', 'Il luogo scelto non esiste più. Scegline un altro.');
    await req(s('visits').add(visit));
  });
  notify('visits');
  return visit;
}

/**
 * Chiude la visita. Con pos: check-out GPS. Con manualDeparture (ISO): chiusura retroattiva
 * senza posizione (unica eccezione al GPS obbligatorio).
 */
export async function checkOut(visitId, { pos = null, manualDeparture = null, note } = {}) {
  if (!pos && !manualDeparture) throw new AppError('NO_POSITION', 'Posizione GPS mancante: check-out non possibile.');
  const now = nowIso();
  const visit = await tx(['visits', 'meta'], 'readwrite', async (s) => {
    const v = await req(s('visits').get(visitId));
    if (!v) throw new AppError('NOT_FOUND', 'Visita non trovata: forse è stata eliminata in un’altra scheda.');
    if (v.status !== 'open') throw new AppError('NOT_OPEN', 'Questa visita è già stata chiusa (forse in un’altra scheda).');
    const departure = manualDeparture || pos.at || now;
    if (ms(departure) < ms(v.arrival)) throw validationError("L'orario di partenza non può precedere l'arrivo.");
    if (ms(departure) > Date.now() + FUTURE_TOLERANCE_MS) throw validationError("L'orario di partenza non può essere nel futuro.");
    v.status = 'closed';
    v.departure = departure;
    if (pos) {
      v.departurePos = { lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, at: pos.at || now };
      v.departureAddress = newAddress();
      if (pos.lowAccuracy && !v.flags.includes('lowAccuracy')) v.flags.push('lowAccuracy');
    } else {
      v.departurePos = null;
      v.departureAddress = null;
      if (!v.flags.includes('manualDeparture')) v.flags.push('manualDeparture');
    }
    if (note !== undefined) {
      if (note.length > NOTE_MAX) throw validationError(`La nota può avere al massimo ${NOTE_MAX} caratteri.`);
      v.note = note.trim();
    }
    v.updatedAt = now;
    await req(s('visits').put(v));
    await bumpMaxVisit(s, [v]);
    return v;
  });
  notify('visits');
  return visit;
}

/**
 * Modifica arrivo, partenza, luogo, nota e testo degli indirizzi.
 * changes: { arrival?, departure? (ISO|null), placeId?, note?, arrivalAddressText?, departureAddressText? }
 */
export async function updateVisit(id, changes) {
  const now = nowIso();
  const visit = await tx(['visits', 'places', 'meta'], 'readwrite', async (s) => {
    const v = await req(s('visits').get(id));
    if (!v) throw new AppError('NOT_FOUND', 'Visita non trovata: forse è stata eliminata in un’altra scheda.');
    const next = structuredClone(v);
    const has = (k) => Object.prototype.hasOwnProperty.call(changes, k);
    if (has('arrival')) next.arrival = changes.arrival;
    if (has('departure')) next.departure = changes.departure;
    if (has('placeId')) next.placeId = changes.placeId;

    if (!next.arrival || Number.isNaN(ms(next.arrival))) throw validationError("Indica l'orario di arrivo.");
    if (ms(next.arrival) > Date.now() + FUTURE_TOLERANCE_MS) throw validationError("L'arrivo non può essere nel futuro.");
    if (next.departure) {
      if (Number.isNaN(ms(next.departure))) throw validationError("Orario di partenza non valido.");
      if (ms(next.departure) > Date.now() + FUTURE_TOLERANCE_MS) throw validationError('La partenza non può essere nel futuro.');
      if (ms(next.departure) < ms(next.arrival)) throw validationError("La partenza non può precedere l'arrivo.");
    }
    if (next.placeId !== v.placeId) {
      const p = await req(s('places').get(next.placeId));
      if (!p || p.deletedAt) throw validationError('Il luogo scelto non esiste più.');
    }

    const timesOrPlaceChanged = next.arrival !== v.arrival || next.departure !== v.departure || next.placeId !== v.placeId;
    if (timesOrPlaceChanged) {
      if (!next.original) next.original = { arrival: v.arrival, departure: v.departure, placeId: v.placeId };
      if (!next.flags.includes('edited')) next.flags.push('edited');
    }

    if (!next.departure) {
      if (v.status !== 'open') {
        const other = await req(s('visits').index('status').get('open'));
        if (other && other.id !== id)
          throw validationError("Non puoi riaprire questa visita: c'è già un'altra visita in corso. Chiudila prima.");
        next.departurePos = null;
        next.departureAddress = null;
        next.flags = next.flags.filter((f) => f !== 'manualDeparture');
      }
      next.status = 'open';
    } else {
      next.status = 'closed';
      if (!next.departurePos && !next.flags.includes('manualDeparture')) next.flags.push('manualDeparture');
    }
    next.flags = next.flags.filter((f) => f !== 'needsClose');

    if (has('note')) {
      const note = String(changes.note ?? '').trim();
      if (note.length > NOTE_MAX) throw validationError(`La nota può avere al massimo ${NOTE_MAX} caratteri.`);
      next.note = note;
    }
    for (const which of ['arrival', 'departure']) {
      const key = `${which}AddressText`;
      const addr = next[`${which}Address`];
      if (!has(key) || !addr) continue;
      const text = String(changes[key] ?? '').trim();
      if (text && text !== addr.text) {
        if (!addr.edited) addr.originalText = addr.text;
        addr.text = text;
        addr.edited = true;
        addr.status = 'ok';
      }
    }
    next.updatedAt = now;
    await req(s('visits').put(next));
    await bumpMaxVisit(s, [next]);
    return next;
  });
  notify('visits');
  return visit;
}

/** Visite (diverse da excludeId) che si sovrappongono all'intervallo indicato. */
export async function findOverlaps(excludeId, arrivalIso, departureIso) {
  const start = new Date(arrivalIso);
  const end = new Date(departureIso || Date.now());
  const { items } = await listVisits({ start, end }, {});
  return items.filter((v) => {
    if (v.id === excludeId) return false;
    const vEnd = v.departure ? ms(v.departure) : v.status === 'open' ? Date.now() : ms(v.arrival);
    return ms(v.arrival) < end.getTime() && vEnd > start.getTime();
  });
}

/** Elimina e restituisce il record (per "Annulla"). */
export async function deleteVisit(id) {
  const v = await tx(['visits'], 'readwrite', async (s) => {
    const rec = await req(s('visits').get(id));
    if (!rec) throw new AppError('NOT_FOUND', 'Visita già eliminata.');
    await req(s('visits').delete(id));
    return rec;
  });
  notify('visits');
  return v;
}

export async function restoreVisit(visit) {
  await tx(['visits'], 'readwrite', async (s) => {
    if (visit.status === 'open') {
      const other = await req(s('visits').index('status').get('open'));
      if (other && other.id !== visit.id)
        throw new AppError('OPEN_EXISTS', "Impossibile ripristinare: nel frattempo è stata avviata un'altra visita.");
    }
    await req(s('visits').put(visit));
  });
  notify('visits');
}

function visitEndMs(v, now) {
  if (v.departure) return ms(v.departure);
  return v.status === 'open' ? now : ms(v.arrival);
}

function overlaps(v, startMs, endMs, now) {
  const a = ms(v.arrival);
  if (a >= endMs) return false;
  return visitEndMs(v, now) > startMs || a >= startMs;
}

function makeMatcher(filters, placesById) {
  const ids = filters.placeIds?.length ? new Set(filters.placeIds) : null;
  const q = normalizeText(filters.text || '').trim();
  return (v) => {
    if (ids && !ids.has(v.placeId)) return false;
    if (!q) return true;
    const p = placesById.get(v.placeId);
    const hay = normalizeText([p?.name, p?.address, v.arrivalAddress?.text, v.departureAddress?.text, v.note].filter(Boolean).join(' '));
    return hay.includes(q);
  };
}

/**
 * Visite che si sovrappongono (anche in parte) a range, dalla più recente, usando l'indice arrival.
 * range: { start: Date, end: Date } (end esclusivo)
 * filters: { placeIds?: string[], text?: string }
 * page: { offset?: number, limit?: number } — offset è un cursore opaco restituito come nextOffset.
 * @returns {Promise<{items: object[], nextOffset: number, done: boolean}>}
 */
export function listVisits(range, filters = {}, { offset = 0, limit = Infinity } = {}) {
  const now = Date.now();
  const startMs = range.start.getTime();
  const endMs = range.end.getTime();
  return tx(['visits', 'places', 'meta'], 'readonly', async (s) => {
    const maxMs = (await req(s('meta').get('maxVisitMs')))?.value || 0;
    const places = filters.text ? await req(s('places').getAll()) : [];
    const match = makeMatcher(filters, new Map(places.map((p) => [p.id, p])));
    const lower = new Date(startMs - maxMs - 1).toISOString();
    const upper = new Date(endMs).toISOString();
    const keyRange = IDBKeyRange.bound(lower, upper, false, true);
    const items = [];
    let scanned = 0;
    let skippedOffset = offset === 0;
    const open = await req(s('visits').index('status').get('open'));
    const done = await each(s('visits').index('arrival'), keyRange, 'prev', (c) => {
      if (!skippedOffset) {
        skippedOffset = true;
        return offset;
      }
      scanned++;
      const v = c.value;
      if (overlaps(v, startMs, endMs, now) && match(v)) items.push(v);
      if (items.length >= limit) return false;
    });
    // La visita aperta può essere iniziata prima del limite di ricerca (maxVisitMs vale solo per visite chiuse).
    if (done && open && ms(open.arrival) < ms(lower) && overlaps(open, startMs, endMs, now) && match(open)) items.push(open);
    return { items, nextOffset: offset + scanned, done };
  });
}

/** Indirizzi da geocodificare: [{ visitId, which, lat, lon }] */
export function listPendingAddresses() {
  return tx(['visits'], 'readonly', async (s) => {
    const jobs = [];
    await each(s('visits'), null, 'next', (c) => {
      const v = c.value;
      if (v.arrivalAddress?.status === 'pending' && v.arrivalPos)
        jobs.push({ visitId: v.id, which: 'arrival', lat: v.arrivalPos.lat, lon: v.arrivalPos.lon });
      if (v.departureAddress?.status === 'pending' && v.departurePos)
        jobs.push({ visitId: v.id, which: 'departure', lat: v.departurePos.lat, lon: v.departurePos.lon });
    });
    return jobs;
  });
}

/** Aggiorna l'indirizzo calcolato (non è una modifica dell'utente: non tocca updatedAt). */
export async function setVisitAddress(visitId, which, patch) {
  const changed = await tx(['visits'], 'readwrite', async (s) => {
    const v = await req(s('visits').get(visitId));
    const key = `${which}Address`;
    if (!v || !v[key]) return false;
    if (v[key].edited && patch.text) delete patch.text; // non sovrascrive una correzione manuale
    v[key] = { ...v[key], ...patch };
    await req(s('visits').put(v));
    return true;
  });
  if (changed) notify('visits');
}

export async function resetAddressAttempts(visitId, which) {
  await setVisitAddress(visitId, which, { status: 'pending', attempts: 0 });
}

// ---------------------------------------------------------------------------
// Export / import

export function exportAll() {
  return tx(['places', 'visits'], 'readonly', async (s) => ({
    places: await req(s('places').getAll()),
    visits: await req(s('visits').getAll()),
  }));
}

export function getAllIds() {
  return tx(['places', 'visits'], 'readonly', async (s) => ({
    places: new Set(await req(s('places').getAllKeys())),
    visits: new Set(await req(s('visits').getAllKeys())),
  }));
}

/**
 * Importa dati già validati in un'unica transazione: o tutto o niente.
 * mode "replace": svuota e sostituisce; "merge": a parità di id vince updatedAt più recente.
 * @returns {Promise<{places: number, visits: number, closedForReview: number}>}
 */
export async function importAll(data, mode) {
  const result = await tx(['places', 'visits', 'meta'], 'readwrite', async (s) => {
    const P = s('places');
    const V = s('visits');
    let nPlaces = 0;
    let nVisits = 0;
    if (mode === 'replace') {
      await req(P.clear());
      await req(V.clear());
      await req(s('meta').delete('maxVisitMs'));
    }
    const curPlaces = mode === 'merge' ? new Map((await req(P.getAll())).map((x) => [x.id, x])) : new Map();
    const curVisits = mode === 'merge' ? new Map((await req(V.getAll())).map((x) => [x.id, x])) : new Map();
    // Le scritture si accodano nella stessa transazione: un errore la annulla per intero.
    let last = null;
    for (const p of data.places) {
      const cur = curPlaces.get(p.id);
      if (!cur || ms(p.updatedAt) > ms(cur.updatedAt)) {
        last = P.put(p);
        nPlaces++;
      }
    }
    for (const v of data.visits) {
      const cur = curVisits.get(v.id);
      if (!cur || ms(v.updatedAt) > ms(cur.updatedAt)) {
        last = V.put(v);
        nVisits++;
      }
    }
    if (last) await req(last);
    // Una sola visita aperta: resta aperta la più recente, le altre vanno chiuse a mano.
    const open = await req(V.index('status').getAll('open'));
    let closedForReview = 0;
    if (open.length > 1) {
      open.sort((a, b) => ms(b.arrival) - ms(a.arrival));
      for (const v of open.slice(1)) {
        v.status = 'closed';
        v.departure = null;
        if (!v.flags.includes('needsClose')) v.flags.push('needsClose');
        await req(V.put(v));
        closedForReview++;
      }
    }
    await bumpMaxVisit(s, data.visits);
    return { places: nPlaces, visits: nVisits, closedForReview };
  });
  notify('places');
  notify('visits');
  return result;
}
