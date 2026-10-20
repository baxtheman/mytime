// Calcoli del report (con ritaglio sul periodo) e testo semplice per email.

import { APP_NAME } from './config.js';
import { dayKey, fmtDate, fmtDayShort, fmtDeparture, fmtDuration, fmtTime, startOfDay, addDays, fmtNumber } from './format.js';

const ms = (iso) => Date.parse(iso);

/** Parte della visita (chiusa) che cade in [start, end). */
export function clippedMs(v, start, end) {
  if (!v.departure) return 0;
  return Math.max(0, Math.min(end.getTime(), ms(v.departure)) - Math.max(start.getTime(), ms(v.arrival)));
}

export function placeLabel(place) {
  if (!place) return 'Luogo sconosciuto';
  return place.deletedAt ? `${place.name} (eliminato)` : place.name;
}

/** Totale delle visite chiuse ritagliato su ogni giorno locale del periodo. */
export function dailyTotals(visits, start, end) {
  const totals = new Map();
  for (const v of visits) {
    if (!v.departure) continue;
    let d = startOfDay(new Date(Math.max(ms(v.arrival), start.getTime())));
    const last = Math.min(ms(v.departure), end.getTime());
    while (d.getTime() < last) {
      const next = addDays(d, 1);
      const part = clippedMs(v, d, next < end ? next : end);
      if (part > 0) totals.set(dayKey(d), (totals.get(dayKey(d)) || 0) + part);
      d = next;
    }
  }
  return totals;
}

/**
 * @param visits visite che si sovrappongono al periodo (da db.listVisits)
 * @param range { start, end, reportLabel }
 * @param placesById Map id → luogo (inclusi eliminati)
 */
export function computeReport(visits, range, placesById) {
  const closed = visits.filter((v) => v.status === 'closed' && v.departure).sort((a, b) => ms(a.arrival) - ms(b.arrival));
  const open = visits.find((v) => v.status === 'open') || null;
  const needsClose = visits.filter((v) => v.status === 'closed' && !v.departure);

  let totalMs = 0;
  const byPlaceMap = new Map();
  const daysMap = new Map();
  for (const v of closed) {
    const part = clippedMs(v, range.start, range.end);
    totalMs += part;
    const p = placesById.get(v.placeId);
    const entry = byPlaceMap.get(v.placeId) || { placeId: v.placeId, name: placeLabel(p), color: p?.color || null, count: 0, ms: 0 };
    entry.count++;
    entry.ms += part;
    byPlaceMap.set(v.placeId, entry);

    const anchor = new Date(Math.max(ms(v.arrival), range.start.getTime()));
    const key = dayKey(anchor);
    const day = daysMap.get(key) || { key, date: startOfDay(anchor), visits: [], firstArrival: v.arrival, lastDeparture: v.departure };
    day.visits.push(v);
    if (ms(v.arrival) < ms(day.firstArrival)) day.firstArrival = v.arrival;
    if (ms(v.departure) > ms(day.lastDeparture)) day.lastDeparture = v.departure;
    daysMap.set(key, day);
  }
  const totals = dailyTotals(closed, range.start, range.end);
  // Giorni coperti solo dalla prosecuzione di una visita iniziata il giorno prima.
  for (const key of totals.keys()) {
    if (daysMap.has(key)) continue;
    const [y, m, d] = key.split('-').map(Number);
    daysMap.set(key, { key, date: new Date(y, m - 1, d), visits: [], firstArrival: null, lastDeparture: null });
  }
  const days = [...daysMap.values()].sort((a, b) => a.date - b.date).map((d) => ({ ...d, ms: totals.get(d.key) || 0 }));
  const byPlace = [...byPlaceMap.values()].sort((a, b) => b.ms - a.ms || a.name.localeCompare(b.name, 'it'));
  return {
    range,
    closed,
    open,
    needsClose,
    count: closed.length,
    totalMs,
    avgMs: closed.length ? totalMs / closed.length : 0,
    byPlace,
    days,
    placesById,
  };
}

export function flagTags(v) {
  const tags = [];
  if (v.flags?.includes('edited')) tags.push('[orari modificati]');
  if (v.flags?.includes('manualDeparture')) tags.push('[chiusa manualmente]');
  if (v.flags?.includes('outOfRange')) tags.push('[fuori raggio]');
  if (v.flags?.includes('lowAccuracy')) tags.push('[posizione imprecisa]');
  return tags;
}

const plural = (n, one, many) => `${fmtNumber(n)} ${n === 1 ? one : many}`;

export function reportSubject(range) {
  return `Registro presenze – ${range.reportLabel}`;
}

/**
 * Testo semplice: niente Markdown né allineamenti, una riga per informazione.
 * opts: { detail: 'summary'|'full', notes: boolean, addresses: boolean }
 */
export function buildReportText(rep, opts = {}) {
  const { detail = 'summary', notes = true, addresses = true } = opts;
  const L = [];
  L.push('REGISTRO PRESENZE');
  L.push(`Periodo: ${rep.range.reportLabel}`);
  L.push('');
  L.push('RIEPILOGO');
  L.push(`Visite totali: ${fmtNumber(rep.count)}`);
  L.push(`Tempo totale: ${fmtDuration(rep.totalMs)}`);
  L.push(`Durata media: ${rep.count ? fmtDuration(rep.avgMs) : '—'}`);
  if (rep.open) {
    const p = rep.placesById.get(rep.open.placeId);
    L.push(`In corso dalle ${fmtTime(rep.open.arrival, rep.open.timeZone)} del ${fmtDate(rep.open.arrival, rep.open.timeZone)}: ${placeLabel(p)} (esclusa dai totali)`);
  }
  if (rep.needsClose.length) L.push(`Da chiudere: ${plural(rep.needsClose.length, 'visita', 'visite')} senza orario di partenza (escluse dai totali)`);

  if (rep.byPlace.length) {
    L.push('');
    L.push('PER LUOGO');
    for (const p of rep.byPlace) L.push(`• ${p.name} – ${plural(p.count, 'visita', 'visite')} – ${fmtDuration(p.ms)}`);
  }

  if (rep.days.length) {
    L.push('');
    if (detail === 'full') {
      L.push('DETTAGLIO');
      rep.days.filter((day) => day.visits.length).forEach((day, i) => {
        if (i > 0) L.push('');
        L.push(`${fmtDayShort(day.date)} (primo arrivo ${fmtTime(day.firstArrival)}, ultima partenza ${fmtDeparture(day.lastDeparture, day.firstArrival)})`);
        for (const v of day.visits) {
          const p = rep.placesById.get(v.placeId);
          L.push(`  ${placeLabel(p)}`);
          const tags = flagTags(v);
          const dur = fmtDuration(ms(v.departure) - ms(v.arrival));
          L.push(`  ${fmtTime(v.arrival, v.timeZone)} – ${fmtDeparture(v.departure, v.arrival, v.timeZone)} (${dur})${tags.length ? ` ${tags.join(' ')}` : ''}`);
          if (addresses) {
            if (v.arrivalAddress?.text) L.push(`  Arrivo: ${v.arrivalAddress.text} ±${fmtNumber(v.arrivalPos.accuracy)} m`);
            if (v.departureAddress?.text && v.departureAddress.text !== v.arrivalAddress?.text)
              L.push(`  Partenza: ${v.departureAddress.text} ±${fmtNumber(v.departurePos.accuracy)} m`);
          }
          if (notes && v.note) L.push(`  Nota: ${v.note.replace(/\s*\n\s*/g, ' / ')}`);
        }
      });
    } else {
      L.push('PER GIORNO');
      for (const day of rep.days)
        if (!day.visits.length) L.push(`${fmtDayShort(day.date)}: prosecuzione dal giorno precedente, totale ${fmtDuration(day.ms)}`);
        else L.push(`${fmtDayShort(day.date)}: primo arrivo ${fmtTime(day.firstArrival)}, ultima partenza ${fmtDeparture(day.lastDeparture, day.firstArrival)}, totale ${fmtDuration(day.ms)}`);
    }
  }

  L.push('');
  const now = new Date();
  L.push(`Generato il ${fmtDate(now)} alle ${fmtTime(now)} con ${APP_NAME}`);
  return L.join('\n');
}

export const MAILTO_MAX_CHARS = 1800;

/**
 * Link mailto: oltre 1800 caratteri il corpo viene ridotto al solo riepilogo.
 * @returns {{ href: string, shortened: boolean, truncated: boolean }}
 */
export function buildMailto(subject, body, summaryBody) {
  let text = body;
  let shortened = false;
  let truncated = false;
  if (text.length > MAILTO_MAX_CHARS) {
    text = summaryBody;
    shortened = true;
    if (text.length > MAILTO_MAX_CHARS) {
      text = `${text.slice(0, MAILTO_MAX_CHARS - 40).trimEnd()}\n… (testo troncato: usa Condividi o Copia)`;
      truncated = true;
    }
  }
  const enc = (s) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
  return { href: `mailto:?subject=${enc(subject)}&body=${enc(text)}`, shortened, truncated };
}
