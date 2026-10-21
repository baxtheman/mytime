// Avvio, routing, registrazione del service worker, sincronizzazione tra schede.

import * as db from './db.js';
import { APP_NAME } from './config.js';
import * as geocode from './geocode.js';
import { isStandalone } from './geo.js';
import { h, icon, showError, toast } from './ui/dom.js';
import { applyTheme } from './ui/theme.js';
import * as install from './ui/install.js';
import { showOnboarding } from './ui/onboarding.js';
import presence, { checkForgottenCheckout, checkOutFromNotification } from './ui/presence.js';
import { initNotifications } from './ui/notifications.js';
import history from './ui/history.js';
import reportScreen from './ui/reportScreen.js';
import places from './ui/places.js';
import settings from './ui/settings.js';
import about from './ui/about.js';

applyTheme();

const SCREENS = [presence, history, reportScreen, places, settings, about];
const TABS = [
  { id: 'presenza', label: 'Presenza', icon: 'pin' },
  { id: 'cronologia', label: 'Cronologia', icon: 'history' },
  { id: 'report', label: 'Report', icon: 'report' },
  { id: 'luoghi', label: 'Luoghi', icon: 'places' },
];

const main = document.getElementById('main');
const titleEl = document.getElementById('screen-title');
const banners = document.getElementById('banners');
let current = null;

// ---------------------------------------------------------------------------
// Errori globali: nessun errore ignorato in silenzio.

addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  showError(e.reason);
});
addEventListener('error', (e) => {
  if (e.error) showError(e.error);
});

// ---------------------------------------------------------------------------
// Routing (hash)

function renderTabs() {
  const nav = document.getElementById('tabbar');
  nav.replaceChildren(
    ...TABS.map((t) => h('a', { href: `#${t.id}`, class: 'tab', dataset: { tab: t.id } }, icon(t.icon), h('span', { text: t.label }))),
  );
}

function route() {
  const id = location.hash.slice(1) || 'presenza';
  const screen = SCREENS.find((s) => s.id === id) || presence;
  if (current?.screen === screen) return;
  current?.instance?.destroy?.();
  main.replaceChildren();
  main.dataset.screen = screen.id;
  titleEl.textContent = screen.id === 'presenza' ? APP_NAME : screen.title;
  document.title = screen.id === 'presenza' ? APP_NAME : `${screen.title} · ${APP_NAME}`;
  for (const a of document.querySelectorAll('#tabbar .tab')) {
    if (a.dataset.tab === screen.id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  current = { screen, instance: screen.mount(main) || {} };
  main.focus({ preventScroll: true });
  scrollTo(0, 0);
}

// ---------------------------------------------------------------------------
// Service worker e aggiornamenti

function showUpdateBanner(worker) {
  if (document.getElementById('update-banner')) return;
  banners.append(
    h(
      'div',
      { class: 'banner', id: 'update-banner', role: 'status' },
      h('span', { text: 'Nuova versione disponibile' }),
      h('button', {
        type: 'button',
        class: 'btn btn-small btn-primary',
        text: 'Aggiorna',
        onclick: (e) => {
          e.currentTarget.disabled = true;
          worker.postMessage({ type: 'SKIP_WAITING' });
        },
      }),
    ),
  );
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    const watch = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
    if (reg.installing) watch(reg.installing);
    reg.addEventListener('updatefound', () => reg.installing && watch(reg.installing));
    // Ricarica solo quando un SW già attivo viene sostituito (Aggiorna), non alla prima installazione.
    let reloading = false;
    const hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading || !hadController) return;
      reloading = true;
      location.reload();
    });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
  } catch (e) {
    console.warn('Service worker non registrato', e);
  }
}

// Vercel Web Analytics: equivalente senza bundler di `inject()` di @vercel/analytics.
// Lo script è servito dallo stesso dominio; in locale non esiste, quindi lo salta.
function injectAnalytics() {
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  window.va = window.va || ((...params) => (window.vaq = window.vaq || []).push(params));
  document.head.append(h('script', { src: './_vercel/insights/script.js', defer: true }));
}

// ---------------------------------------------------------------------------
// Tap sulla notifica della visita in corso

// App aperta dalla notifica (nessuna finestra già aperta): "?azione=checkout" viene letto e rimosso.
const launchAction = new URLSearchParams(location.search).get('azione');
if (launchAction) window.history.replaceState(null, '', `${location.pathname}#presenza`);

function onNotificationClick(action) {
  if (location.hash !== '#presenza') location.hash = '#presenza';
  if (action === 'checkout') checkOutFromNotification().catch(showError);
}

// ---------------------------------------------------------------------------
// Avvio

addEventListener('db-blocked', () => {
  if (document.getElementById('blocked-banner')) return;
  banners.append(h('div', { class: 'banner banner-warn', id: 'blocked-banner', role: 'alert', text: "Chiudi le altre schede dell'app per aggiornare" }));
});
addEventListener('db-ready', () => document.getElementById('blocked-banner')?.remove());

function updateOnlineState() {
  document.documentElement.classList.toggle('offline', !navigator.onLine);
  document.getElementById('offline-pill').hidden = navigator.onLine;
}

async function start() {
  renderTabs();
  install.initInstall();
  registerServiceWorker();
  updateOnlineState();

  try {
    await db.open();
  } catch (e) {
    main.replaceChildren(h('div', { class: 'card', role: 'alert' }, h('h2', { text: 'Archivio non disponibile' }), h('p', { text: e.message })));
    return;
  }

  // Persistenza: all'avvio (su iOS anche al primo avvio in standalone), poi su appinstalled e al primo check-in.
  install.requestPersistence();
  if (!(await db.getMeta('firstUseAt'))) await db.setMeta('firstUseAt', new Date().toISOString());
  if (isStandalone() && !(await db.getMeta('standaloneSince'))) await db.setMeta('standaloneSince', new Date().toISOString());

  db.onChange((detail) => {
    current?.instance?.update?.(detail);
    if (detail.remote && detail.store === 'visits') toast('Dati aggiornati da un’altra scheda');
  });

  addEventListener('hashchange', route);
  route();

  if (!(await db.getMeta('onboardedAt'))) await showOnboarding();
  initNotifications(onNotificationClick);
  if (launchAction === 'checkout') checkOutFromNotification().catch(showError);
  else checkForgottenCheckout().catch(showError);
  geocode.processQueue();

  addEventListener('online', () => {
    updateOnlineState();
    geocode.processQueue();
  });
  addEventListener('offline', updateOnlineState);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    geocode.processQueue();
    checkForgottenCheckout().catch(showError);
    current?.instance?.update?.({ store: 'visibility' });
  });
}

injectAnalytics();
start();
