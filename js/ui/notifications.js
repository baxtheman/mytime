// Notifica locale della visita in corso (tag "visita-aperta"), mostrata dal service worker.
// Solo locale: niente push, VAPID o server. Non legge mai la posizione: riflette solo lo stato in IndexedDB.
// Se le notifiche non sono supportate o sono negate, l'app funziona lo stesso (lo stato è nella home).

import * as db from '../db.js';
import { fmtTime, fmtDate, dayKey } from '../format.js';
import { placeLabel } from '../report.js';

export const TAG = 'visita-aperta';
const FRESH_MS = 2 * 60e3; // visita appena aperta: la notifica può suonare

export function isSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'showNotification' in ServiceWorkerRegistration.prototype;
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function permission() {
  return isSupported() ? Notification.permission : 'unsupported';
}

export async function isEnabled() {
  return Boolean(await db.getMeta('notificationsEnabled', true));
}

/**
 * Chiede il permesso. Va chiamata in modo sincrono dal gestore del tap (Safari lo richiede).
 * @returns {Promise<string>} il permesso risultante
 */
export function requestPermission() {
  if (!isSupported()) return Promise.resolve('unsupported');
  const p = Notification.requestPermission();
  return Promise.resolve(p)
    .then((r) => r || Notification.permission)
    .finally(() => sync());
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration('./');
  return reg?.active ? reg : null;
}

function texts(visit, place) {
  const since = dayKey(new Date(visit.arrival)) === dayKey(new Date()) ? '' : ` del ${fmtDate(visit.arrival, visit.timeZone)}`;
  return {
    title: `Sei in: ${placeLabel(place)} dalle ${fmtTime(visit.arrival, visit.timeZone)}${since}`,
    body: 'Visita in corso. Tocca «Check-out» quando esci.',
  };
}

async function doSync() {
  if (!isSupported()) return;
  const reg = await registration();
  if (!reg) return;
  const existing = await reg.getNotifications({ tag: TAG });
  const open = Notification.permission === 'granted' && (await isEnabled()) ? await db.getOpenVisit() : null;
  if (!open) {
    for (const n of existing) n.close();
    return;
  }
  const { title, body } = texts(open, await db.getPlace(open.placeId));
  const same = existing.find((n) => n.data?.visitId === open.id);
  if (same && same.title === title && same.body === body) return;
  // Nuovo check-in: suona (renotify sostituisce la precedente). Ripristino o testo aggiornato: silenziosa.
  const fresh = !same && Date.now() - Date.parse(open.arrival) < FRESH_MS;
  await reg.showNotification(title, {
    body,
    tag: TAG,
    ...(fresh ? { renotify: true } : { silent: true }),
    requireInteraction: true,
    icon: './icons/icon-192.png',
    lang: 'it-IT',
    data: { visitId: open.id },
    actions: [{ action: 'checkout', title: 'Check-out' }],
  });
}

let queue = Promise.resolve();

/** Allinea la notifica alla visita aperta (mostra, aggiorna o chiude). Le chiamate sono in coda. */
export function sync() {
  queue = queue.then(doSync).catch((e) => console.warn('Notifica non aggiornata', e));
  return queue;
}

/**
 * @param {(action: string) => void} onClick chiamata quando il service worker segnala un tap sulla notifica
 */
export function initNotifications(onClick) {
  if (!isSupported()) return;
  // Solo le modifiche fatte in questa scheda: l'altra scheda aggiorna la notifica per conto suo.
  db.onChange((detail) => {
    if (!detail.remote && ['visits', 'places', 'meta'].includes(detail.store)) sync();
  });
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && sync());
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'notification-click') onClick(e.data.action || '');
  });
  navigator.serviceWorker.ready.then(() => sync());
}
