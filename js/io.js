// Export JSON (backup completo e versionato), export CSV (Excel italiano), validazione import.

import * as db from './db.js';
import { APP_VERSION, EXPORT_FORMAT, EXPORT_SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS, PLACE_NAME_MAX, NOTE_MAX, FLAG_LABELS } from './config.js';
import { dayKey, fmtDate, fmtDateTime, fmtDuration, fmtNumber } from './format.js';
import { placeLabel } from './report.js';

// ---------------------------------------------------------------------------
// JSON

export async function buildBackupFile() {
  const { places, visits } = await db.exportAll();
  const data = {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    places,
    visits,
  };
  const name = `registro-presenze-${dayKey(new Date())}.json`;
  return new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
}

export async function markBackupDone() {
  await db.setMeta('lastBackupAt', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// CSV

const CSV_HEADER = [
  'data',
  'luogo',
  'arrivo',
  'partenza',
  'durata (minuti)',
  'durata (testo)',
  'indirizzo arrivo',
  'indirizzo partenza',
  'lat arrivo',
  'lon arrivo',
  'lat partenza',
  'lon partenza',
  'precisione arrivo (m)',
  'precisione partenza (m)',
  'nota',
  'indicatori',
];

/** Protezione da formula injection per le celle di testo. */
function safeText(s) {
  s = String(s ?? '');
  return /^[=+\-@\t\r\n]/.test(s) ? `'${s}` : s;
}

function cell(s) {
  s = String(s ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const dec = (n, digits) => (Number.isFinite(n) ? fmtNumber(n, digits).replace(/\./g, '') : '');

export function visitIndicators(v) {
  const out = [];
  if (v.status === 'open') out.push('In corso');
  for (const f of v.flags || []) if (FLAG_LABELS[f]) out.push(FLAG_LABELS[f]);
  if (v.arrivalAddress?.edited || v.departureAddress?.edited) out.push('Indirizzo corretto');
  return out;
}

export function buildCsv(visits, placesById) {
  const rows = [CSV_HEADER];
  const sorted = [...visits].sort((a, b) => Date.parse(a.arrival) - Date.parse(b.arrival));
  for (const v of sorted) {
    const durMs = v.departure ? Date.parse(v.departure) - Date.parse(v.arrival) : null;
    rows.push([
      fmtDate(v.arrival, v.timeZone),
      safeText(placeLabel(placesById.get(v.placeId))),
      fmtDateTime(v.arrival, v.timeZone),
      v.departure ? fmtDateTime(v.departure, v.timeZone) : '',
      durMs == null ? '' : String(Math.round(durMs / 60000)),
      durMs == null ? '' : fmtDuration(durMs),
      safeText(v.arrivalAddress?.text),
      safeText(v.departureAddress?.text),
      dec(v.arrivalPos?.lat, 6),
      dec(v.arrivalPos?.lon, 6),
      dec(v.departurePos?.lat, 6),
      dec(v.departurePos?.lon, 6),
      dec(v.arrivalPos?.accuracy, 0),
      dec(v.departurePos?.accuracy, 0),
      safeText(v.note),
      safeText(visitIndicators(v).join(', ')),
    ]);
  }
  return `﻿${rows.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

export function buildCsvFile(visits, placesById, range) {
  const name = range
    ? `registro-presenze-${dayKey(range.start)}_${dayKey(new Date(range.end.getTime() - 1))}.csv`
    : `registro-presenze-${dayKey(new Date())}.csv`;
  return new File([buildCsv(visits, placesById)], name, { type: 'text/csv;charset=utf-8' });
}

// ---------------------------------------------------------------------------
// Import

const isIso = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !Number.isNaN(Date.parse(s));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isPos = (p) => p && isNum(p.lat) && isNum(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

function normAddress(a, hasPos) {
  if (a && typeof a === 'object' && typeof a.text === 'string' && a.text) {
    return {
      text: a.text,
      status: 'ok',
      geocodedAt: isIso(a.geocodedAt) ? a.geocodedAt : null,
      edited: Boolean(a.edited),
      ...(a.originalText ? { originalText: String(a.originalText) } : {}),
      attempts: 0,
    };
  }
  // Indirizzo mancante: entra nella coda di geocoding.
  return hasPos ? { text: null, status: 'pending', geocodedAt: null, edited: false, attempts: 0 } : null;
}

const pickPos = (p) => ({ lat: p.lat, lon: p.lon, accuracy: isNum(p.accuracy) ? p.accuracy : 0, at: isIso(p.at) ? p.at : null });

/**
 * Valida e normalizza un backup. Nessuna scrittura.
 * @returns {{ errors: string[], data?: {places, visits} }}
 */
export function validateBackup(json, existingPlaceIds = new Set()) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { errors: ['Il file non contiene un oggetto JSON valido.'] };
  if (json.format !== EXPORT_FORMAT) return { errors: [`Formato non riconosciuto: il file non è un backup di Registro Presenze.`] };
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(json.schemaVersion))
    return {
      errors: [`Versione del backup non supportata (schemaVersion ${JSON.stringify(json.schemaVersion)}). Aggiorna l'app e riprova.`],
    };
  if (!Array.isArray(json.places)) errors.push('Manca l’elenco "places".');
  if (!Array.isArray(json.visits)) errors.push('Manca l’elenco "visits".');
  if (errors.length) return { errors };

  const places = [];
  const placeIds = new Set();
  json.places.forEach((p, i) => {
    const row = `Luogo ${i + 1}${p?.name ? ` ("${String(p.name).slice(0, 40)}")` : ''}`;
    const errs = [];
    if (!p || typeof p !== 'object') return errors.push(`${row}: non è un oggetto.`);
    if (typeof p.id !== 'string' || !p.id) errs.push('id mancante');
    else if (placeIds.has(p.id)) errs.push('id duplicato');
    if (typeof p.name !== 'string' || !p.name.trim()) errs.push('nome mancante');
    else if (p.name.length > PLACE_NAME_MAX) errs.push(`nome oltre ${PLACE_NAME_MAX} caratteri`);
    if (!isPos(p)) errs.push('coordinate mancanti o non valide');
    if (!isNum(p.radius) || p.radius <= 0) errs.push('raggio non valido');
    if (!isIso(p.createdAt)) errs.push('createdAt non è una data ISO');
    if (!isIso(p.updatedAt)) errs.push('updatedAt non è una data ISO');
    if (p.deletedAt != null && !isIso(p.deletedAt)) errs.push('deletedAt non è una data ISO');
    if (errs.length) return errors.push(`${row}: ${errs.join(', ')}.`);
    placeIds.add(p.id);
    places.push({
      id: p.id,
      name: p.name.trim(),
      lat: p.lat,
      lon: p.lon,
      accuracy: isNum(p.accuracy) ? p.accuracy : 0,
      radius: p.radius,
      address: typeof p.address === 'string' ? p.address : null,
      color: typeof p.color === 'string' ? p.color : null,
      description: typeof p.description === 'string' ? p.description : null,
      sortOrder: isNum(p.sortOrder) ? p.sortOrder : i + 1,
      deletedAt: p.deletedAt || null,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  });

  const visits = [];
  const visitIds = new Set();
  json.visits.forEach((v, i) => {
    const row = `Visita ${i + 1}${isIso(v?.arrival) ? ` (${fmtDateTime(v.arrival)})` : ''}`;
    const errs = [];
    if (!v || typeof v !== 'object') return errors.push(`${row}: non è un oggetto.`);
    if (typeof v.id !== 'string' || !v.id) errs.push('id mancante');
    else if (visitIds.has(v.id)) errs.push('id duplicato');
    if (typeof v.placeId !== 'string') errs.push('placeId mancante');
    else if (!placeIds.has(v.placeId) && !existingPlaceIds.has(v.placeId)) errs.push('placeId non corrisponde a nessun luogo');
    if (v.status !== 'open' && v.status !== 'closed') errs.push('status deve essere "open" o "closed"');
    if (!isIso(v.arrival)) errs.push('arrival non è una data ISO');
    if (v.departure != null && !isIso(v.departure)) errs.push('departure non è una data ISO');
    if (isIso(v.arrival) && isIso(v.departure) && Date.parse(v.departure) < Date.parse(v.arrival)) errs.push('partenza prima dell’arrivo');
    if (v.status === 'open' && v.departure) errs.push('visita aperta con orario di partenza');
    if (!isPos(v.arrivalPos)) errs.push('arrivalPos mancante o non valida');
    if (v.departurePos != null && !isPos(v.departurePos)) errs.push('departurePos non valida');
    if (v.flags != null && !Array.isArray(v.flags)) errs.push('flags deve essere un elenco');
    if (v.note != null && typeof v.note !== 'string') errs.push('nota non valida');
    else if (v.note && v.note.length > NOTE_MAX) errs.push(`nota oltre ${NOTE_MAX} caratteri`);
    if (!isIso(v.createdAt)) errs.push('createdAt non è una data ISO');
    if (!isIso(v.updatedAt)) errs.push('updatedAt non è una data ISO');
    if (errs.length) return errors.push(`${row}: ${errs.join(', ')}.`);
    visitIds.add(v.id);
    const flags = (v.flags || []).filter((f) => typeof f === 'string');
    if (v.status === 'closed' && !v.departure && !flags.includes('needsClose')) flags.push('needsClose');
    const departurePos = v.departurePos ? pickPos(v.departurePos) : null;
    let timeZone = typeof v.timeZone === 'string' ? v.timeZone : 'UTC';
    try {
      new Intl.DateTimeFormat('it-IT', { timeZone });
    } catch {
      timeZone = 'UTC';
    }
    visits.push({
      id: v.id,
      placeId: v.placeId,
      status: v.status,
      arrival: v.arrival,
      departure: v.departure || null,
      timeZone,
      arrivalPos: pickPos(v.arrivalPos),
      departurePos,
      arrivalAddress: normAddress(v.arrivalAddress, true),
      departureAddress: normAddress(v.departureAddress, Boolean(departurePos)),
      note: v.note || '',
      flags,
      original:
        v.original && typeof v.original === 'object'
          ? { arrival: v.original.arrival ?? null, departure: v.original.departure ?? null, placeId: v.original.placeId ?? null }
          : null,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    });
  });

  if (errors.length) return { errors };
  return { errors: [], data: { places, visits } };
}

/** "N luoghi e M visite, di cui X nuovi e Y in conflitto" */
export function importSummary(data, existing) {
  const newCount =
    data.places.filter((p) => !existing.places.has(p.id)).length + data.visits.filter((v) => !existing.visits.has(v.id)).length;
  const conflicts =
    data.places.filter((p) => existing.places.has(p.id)).length + data.visits.filter((v) => existing.visits.has(v.id)).length;
  return {
    newCount,
    conflicts,
    text: `${fmtNumber(data.places.length)} ${data.places.length === 1 ? 'luogo' : 'luoghi'} e ${fmtNumber(data.visits.length)} ${
      data.visits.length === 1 ? 'visita' : 'visite'
    }, di cui ${fmtNumber(newCount)} ${newCount === 1 ? 'nuovo' : 'nuovi'} e ${fmtNumber(conflicts)} in conflitto.`,
  };
}

export async function readJsonFile(file) {
  let text;
  try {
    text = await file.text();
  } catch {
    return { errors: ['Impossibile leggere il file.'] };
  }
  try {
    return { json: JSON.parse(text.replace(/^﻿/, '')) };
  } catch (e) {
    return { errors: [`Il file non è un JSON valido (${e.message}).`] };
  }
}
