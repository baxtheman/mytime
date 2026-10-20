// Installazione (prompt Chrome / scheda di aiuto iOS) e archiviazione persistente.

import * as db from '../db.js';
import { isIOS, isStandalone } from '../geo.js';
import { INSTALL_HINT_SNOOZE_DAYS } from '../config.js';

let deferredPrompt = null;
const listeners = new Set();
const changed = () => listeners.forEach((fn) => fn());

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initInstall() {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    changed();
  });
  addEventListener('appinstalled', () => {
    deferredPrompt = null;
    changed();
    requestPersistence(); // ritentativo dopo l'installazione (non disponibile su iOS)
  });
}

export const canPromptInstall = () => Boolean(deferredPrompt);

export async function promptInstall() {
  if (!deferredPrompt) return null;
  const e = deferredPrompt;
  deferredPrompt = null;
  e.prompt();
  const choice = await e.userChoice.catch(() => null);
  changed();
  return choice?.outcome || null;
}

/** Scheda di aiuto per Safari iOS non installata (si nasconde per 30 giorni se chiusa). */
export async function shouldShowIosHint() {
  if (!isIOS || isStandalone()) return false;
  const dismissed = await db.getMeta('installHintDismissedAt', null);
  return !dismissed || Date.now() - Date.parse(dismissed) > INSTALL_HINT_SNOOZE_DAYS * 86400e3;
}

export function dismissIosHint() {
  return db.setMeta('installHintDismissedAt', new Date().toISOString());
}

// ---------------------------------------------------------------------------
// Persistenza

let persisted = null;

export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return (persisted = true);
    persisted = await navigator.storage.persist();
  } catch {
    persisted = false;
  }
  return persisted;
}

/** Ritentativo al primo check-in se la richiesta all'avvio non è andata a buon fine. */
let retriedOnCheckIn = false;
export async function retryPersistenceOnCheckIn() {
  if (persisted || retriedOnCheckIn) return;
  retriedOnCheckIn = true;
  await requestPersistence();
}

export async function storageStatus() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
  } catch {
    /* non disponibile */
  }
  return out;
}
