// Date, ore, durate e numeri in italiano. Si salva in UTC, si mostra in ora locale,
// si calcola sempre su timestamp (millisecondi).

export const LOCALE = 'it-IT';
const DAY_MS = 86400e3;

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const dtfCache = new Map();
function dtf(opts) {
  const key = JSON.stringify(opts);
  let f = dtfCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(LOCALE, opts);
    } catch {
      // Fuso orario non valido (es. dati importati): ripiega sul fuso del dispositivo.
      const { timeZone, ...rest } = opts;
      f = new Intl.DateTimeFormat(LOCALE, rest);
    }
    dtfCache.set(key, f);
  }
  return f;
}

const nf0 = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
export function fmtNumber(n, digits = 0) {
  if (digits === 0) return nf0.format(n);
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

function otherTz(tz) {
  return tz && tz !== deviceTimeZone() ? tz : null;
}

export function tzLabel(value, tz) {
  const parts = dtf({ timeZone: tz, timeZoneName: 'short', hour: '2-digit' }).formatToParts(toDate(value));
  return parts.find((p) => p.type === 'timeZoneName')?.value || tz;
}

/** "08:42"; se la visita è in un altro fuso: "09:00 GMT+1". */
export function fmtTime(value, tz) {
  const zone = otherTz(tz);
  const d = toDate(value);
  const s = dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) }).format(d);
  return zone ? `${s} ${tzLabel(d, zone)}` : s;
}

/** "12/10/2026" */
export function fmtDate(value, tz) {
  const zone = otherTz(tz);
  return dtf({ day: '2-digit', month: '2-digit', year: 'numeric', ...(zone ? { timeZone: zone } : {}) }).format(toDate(value));
}

/** "20/10" */
export function fmtDayMonth(value, tz) {
  const zone = otherTz(tz);
  return dtf({ day: '2-digit', month: '2-digit', ...(zone ? { timeZone: zone } : {}) }).format(toDate(value));
}

/** "12/10/2026 08:42" */
export function fmtDateTime(value, tz) {
  return `${fmtDate(value, tz)} ${fmtTime(value, tz)}`;
}

/** "lunedì 19 ottobre 2026" */
export function fmtDayLong(value) {
  return dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(value));
}

/** "Lun 12/10/2026" */
export function fmtDayShort(value) {
  const wd = dtf({ weekday: 'short' }).format(toDate(value)).replace('.', '');
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${fmtDate(value)}`;
}

/** "ottobre 2026" */
export function fmtMonthYear(value) {
  return dtf({ month: 'long', year: 'numeric' }).format(toDate(value));
}

/**
 * Ora di partenza; se cade in un giorno diverso dall'arrivo aggiunge la data: "01:30 del 20/10".
 */
export function fmtDeparture(departure, arrival, tz) {
  const t = fmtTime(departure, tz);
  const zone = otherTz(tz);
  const key = (v) => (zone ? fmtDate(v, zone) : dayKey(toDate(v)));
  return key(departure) === key(arrival) ? t : `${t} del ${fmtDayMonth(departure, tz)}`;
}

/** Durata "2 h 05 min" (o "45 min" sotto l'ora). Intl.DurationFormat non è disponibile ovunque. */
export function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return `${fmtNumber(h)} h ${String(m).padStart(2, '0')} min`;
}

export function fmtDistance(m) {
  if (m >= 10000) return `${fmtNumber(m / 1000, 0)} km`;
  if (m >= 1000) return `${fmtNumber(m / 1000, 1)} km`;
  return `${fmtNumber(Math.round(m))} m`;
}

export function fmtCoords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export function fmtBytes(bytes) {
  if (bytes == null) return '—';
  const units = ['byte', 'kB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${fmtNumber(v, i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Testo per ricerche senza distinzione tra maiuscole e accenti. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ---- Giorni locali ----

const pad = (n) => String(n).padStart(2, '0');

/** Chiave "AAAA-MM-GG" del giorno locale del dispositivo. */
export function dayKey(d) {
  d = toDate(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfDay(d) {
  d = toDate(d);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Aggiunge giorni di calendario (non 24 h): corretto anche nei giorni del cambio d'ora. */
export function addDays(d, n) {
  d = toDate(d);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
}

export function dayRange(d) {
  const start = startOfDay(d);
  return { start, end: addDays(start, 1) };
}

// ---- <input type="datetime-local"> e <input type="date"> ----

export function toInputValue(d) {
  d = toDate(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInputValue(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toDateInputValue(d) {
  return dayKey(d);
}

export function fromDateInputValue(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function nowRoundedToMinute() {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

// ---- Periodi ----

export const PERIODS = [
  { value: 'day', label: 'Giorno' },
  { value: 'week', label: 'Settimana' },
  { value: 'month', label: 'Mese' },
  { value: 'year', label: 'Anno' },
  { value: 'custom', label: 'Intervallo' },
];

/**
 * Confini del periodo in ora locale (convertiti in UTC solo al momento della query).
 * @returns {{start: Date, end: Date, label: string, reportLabel: string}} end esclusivo
 */
export function periodRange({ period, anchor, customStart, customEnd }) {
  const a = startOfDay(anchor || new Date());
  let start;
  let end;
  switch (period) {
    case 'day':
      start = a;
      end = addDays(a, 1);
      break;
    case 'week': {
      const dow = (a.getDay() + 6) % 7; // lunedì = 0 (ISO 8601)
      start = addDays(a, -dow);
      end = addDays(start, 7);
      break;
    }
    case 'month':
      start = new Date(a.getFullYear(), a.getMonth(), 1);
      end = new Date(a.getFullYear(), a.getMonth() + 1, 1);
      break;
    case 'year':
      start = new Date(a.getFullYear(), 0, 1);
      end = new Date(a.getFullYear() + 1, 0, 1);
      break;
    default: {
      const s = fromDateInputValue(customStart) || a;
      const e = fromDateInputValue(customEnd) || s;
      start = s <= e ? s : e;
      end = addDays(s <= e ? e : s, 1);
    }
  }
  const lastDay = addDays(end, -1);
  const span = `${fmtDate(start)} – ${fmtDate(lastDay)}`;
  let label;
  if (period === 'day') label = fmtDayLong(start);
  else if (period === 'month') label = fmtMonthYear(start);
  else if (period === 'year') label = String(start.getFullYear());
  else label = span;
  const reportLabel = dayKey(start) === dayKey(lastDay) ? fmtDate(start) : span;
  return { start, end, label, reportLabel };
}

export function shiftAnchor(period, anchor, dir) {
  const a = startOfDay(anchor);
  switch (period) {
    case 'day':
      return addDays(a, dir);
    case 'week':
      return addDays(a, 7 * dir);
    case 'month':
      return new Date(a.getFullYear(), a.getMonth() + dir, 1);
    case 'year':
      return new Date(a.getFullYear() + dir, 0, 1);
    default:
      return a;
  }
}

export { DAY_MS };
