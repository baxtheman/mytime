// Schermata principale: stato, check-in, check-out, check-out dimenticato, avvisi.

import * as db from '../db.js';
import * as geocode from '../geocode.js';
import { BACKUP_REMINDER_DAYS, FORGOTTEN_CHECKOUT_MS, NOTE_MAX } from '../config.js';
import { rankPlaces, distance } from '../geo.js';
import { fmtTime, fmtDate, fmtDuration, fmtDistance, fmtNumber, toInputValue, fromInputValue, nowRoundedToMinute, dayRange } from '../format.js';
import { placeLabel, dailyTotals } from '../report.js';
import { h, icon, setChildren, openDialog, toast, showError, field, deliverFile } from './dom.js';
import { acquirePosition } from './position.js';
import { openPlaceForm } from './placeForm.js';
import { renderVisitItem } from './visits.js';
import { buildBackupFile, markBackupDone } from '../io.js';
import * as install from './install.js';

let busy = false;

/** Evita doppi tap mentre un flusso è in corso. */
function guarded(fn) {
  return (...args) => {
    if (busy) return;
    busy = true;
    Promise.resolve()
      .then(() => fn(...args))
      .catch((e) => showError(e))
      .finally(() => (busy = false));
  };
}

// ---------------------------------------------------------------------------
// Check-in

async function choosePlace(pos, preselectId, noteValue) {
  const places = await db.getPlaces();
  const { ranked, proposed } = rankPlaces(pos, places);
  let selected = preselectId || proposed?.place.id || null;
  const note = h('textarea', { rows: 2, maxlength: NOTE_MAX, value: noteValue || '', placeholder: 'Facoltativa' });

  const list = h(
    'fieldset',
    { class: 'place-choices' },
    h('legend', { text: proposed ? 'Luogo (proposto il più vicino)' : 'Scegli il luogo' }),
    ranked.map((r) => {
      const input = h('input', {
        type: 'radio',
        name: 'checkin-place',
        value: r.place.id,
        checked: r.place.id === selected,
        onchange: () => {
          selected = r.place.id;
          confirmBtn && (confirmBtn.disabled = false);
        },
      });
      const dot = h('span', { class: 'dot', 'aria-hidden': 'true' });
      if (r.place.color) dot.style.setProperty('--c', r.place.color);
      return h(
        'label',
        { class: 'choice' },
        input,
        dot,
        h('span', { class: 'choice-main' }, h('span', { class: 'choice-title', text: r.place.name }), h('span', {
          class: ['choice-sub', !r.inRange && 'far'],
          text: `${fmtDistance(r.distance)}${r.inRange ? ' · nel raggio' : ` · fuori raggio (${fmtNumber(r.place.radius)} m)`}`,
        })),
      );
    }),
  );
  let confirmBtn;
  let finish = () => {};
  const body = h(
    'div',
    { class: 'form' },
    h('p', { class: 'hint', text: `Posizione acquisita ±${fmtNumber(pos.accuracy)} m${pos.lowAccuracy ? ' (imprecisa)' : ''}.` }),
    ranked.length ? list : h('p', { text: 'Nessun luogo salvato: crea il primo con la posizione appena acquisita.' }),
    h(
      'button',
      { type: 'button', class: 'btn btn-secondary', onclick: () => finish({ create: true, note: note.value }) },
      icon('plus', 20),
      ' Nuovo luogo qui',
    ),
    field('Nota', note),
  );
  return openDialog({
    title: 'Check-in',
    body: ({ close }) => {
      finish = close;
      return body;
    },
    onOpen: (dlg) => {
      confirmBtn = dlg.querySelector('[data-key="confirm"]');
      confirmBtn.disabled = !selected;
    },
    actions: [
      { label: 'Annulla', value: null },
      {
        label: 'Conferma check-in',
        key: 'confirm',
        variant: 'primary',
        onClick: () => {
          const r = ranked.find((x) => x.place.id === selected);
          return Promise.resolve(r ? { ranked: r, note: note.value } : false);
        },
      },
    ],
  });
}

export const startCheckIn = guarded(async () => {
  const pos = await acquirePosition(); // parte subito, dentro il tap
  if (!pos) return;
  let preselect = null;
  let note = '';
  for (;;) {
    const choice = await choosePlace(pos, preselect, note);
    if (!choice) return;
    note = choice.note;
    if (choice.create) {
      const created = await openPlaceForm({ pos });
      if (created) preselect = created.id;
      continue;
    }
    const { place, distance: dist, inRange } = choice.ranked;
    preselect = place.id;
    const flags = [];
    if (pos.lowAccuracy) flags.push('lowAccuracy');
    if (!inRange) {
      const ok = await openDialog({
        title: `Sei a ${fmtDistance(dist)} da ${place.name}`,
        body: h('p', { text: `Il raggio del luogo è ${fmtNumber(place.radius)} m. Confermando, la visita verrà segnata come "Fuori raggio".` }),
        actions: [
          { label: 'Cambia luogo', value: false },
          { label: 'Conferma', value: true, variant: 'primary' },
        ],
      });
      if (!ok) continue;
      flags.push('outOfRange');
    }
    const visit = await db.checkIn({ placeId: place.id, pos, note, flags });
    toast(`Check-in a ${place.name} alle ${fmtTime(visit.arrival)}`);
    install.retryPersistenceOnCheckIn();
    geocode.processQueue(); // non blocca il salvataggio
    return;
  }
});

// ---------------------------------------------------------------------------
// Check-out

export const startCheckOut = guarded(async (visit) => {
  const pos = await acquirePosition();
  if (!pos) return;
  const current = await db.getOpenVisit();
  if (!current || current.id !== visit.id) throw new Error('La visita è già stata chiusa (forse in un’altra scheda).');
  const place = await db.getPlace(visit.placeId);
  const d = place ? distance(pos, place) : null;
  const note = h('textarea', { rows: 2, maxlength: NOTE_MAX, value: current.note || '', placeholder: 'Facoltativa' });
  const ok = await openDialog({
    title: `Check-out da ${placeLabel(place)}`,
    body: h(
      'div',
      { class: 'form' },
      h('p', { text: `Arrivo alle ${fmtTime(current.arrival, current.timeZone)} · durata ${fmtDuration(Date.now() - Date.parse(current.arrival))}` }),
      d != null && h('p', { class: d > place.radius ? 'hint warn' : 'hint', text: `Sei a ${fmtDistance(d)} dal luogo · posizione ±${fmtNumber(pos.accuracy)} m` }),
      field('Nota', note),
    ),
    actions: [
      { label: 'Annulla', value: false },
      { label: 'Conferma check-out', value: true, variant: 'primary' },
    ],
  });
  if (!ok) return;
  const closed = await db.checkOut(visit.id, { pos, note: note.value });
  toast(`Check-out alle ${fmtTime(closed.departure)} · ${fmtDuration(Date.parse(closed.departure) - Date.parse(closed.arrival))}`);
  geocode.processQueue();
});

// ---------------------------------------------------------------------------
// Check-out dimenticato (> 12 h)

let forgottenOpen = false;

export async function checkForgottenCheckout() {
  if (forgottenOpen || busy) return;
  const v = await db.getOpenVisit();
  if (!v || Date.now() - Date.parse(v.arrival) < FORGOTTEN_CHECKOUT_MS) return;
  const still = await db.getMeta('stillHere', null);
  if (still?.visitId === v.id && Date.now() - Date.parse(still.at) < FORGOTTEN_CHECKOUT_MS) return;
  forgottenOpen = true;
  try {
    const place = await db.getPlace(v.placeId);
    const input = h('input', {
      type: 'datetime-local',
      min: toInputValue(v.arrival),
      max: toInputValue(nowRoundedToMinute()),
      value: toInputValue(nowRoundedToMinute()),
    });
    const picker = h('div', { hidden: true }, field('Orario di partenza', input, 'Non prima dell’arrivo e non nel futuro. La visita sarà segnata "Chiusa manualmente".'));
    const choice = await openDialog({
      title: `Hai dimenticato il check-out a ${placeLabel(place)}?`,
      body: h(
        'div',
        { class: 'form' },
        h('p', { text: `Sei in visita dalle ${fmtTime(v.arrival, v.timeZone)} del ${fmtDate(v.arrival, v.timeZone)} (${fmtDuration(Date.now() - Date.parse(v.arrival))}).` }),
        picker,
      ),
      actions: [
        { label: 'Sono ancora qui', value: 'still' },
        {
          label: 'Chiudi con orario passato',
          variant: 'primary',
          onClick: async (e) => {
            if (picker.hidden) {
              picker.hidden = false;
              input.focus();
              e.currentTarget.textContent = 'Chiudi la visita';
              return false;
            }
            const d = fromInputValue(input.value);
            if (!d) throw new Error('Indica un orario valido.');
            const iso = d.getTime() < Date.parse(v.arrival) ? v.arrival : d.toISOString();
            await db.checkOut(v.id, { manualDeparture: iso });
            toast('Visita chiusa con orario manuale');
            return 'closed';
          },
        },
      ],
    });
    if (choice === 'still' || choice === undefined) await db.setMeta('stillHere', { visitId: v.id, at: new Date().toISOString() });
  } finally {
    forgottenOpen = false;
  }
}

// ---------------------------------------------------------------------------
// Avvisi in home

async function renderNotices(container, hasVisits) {
  const notices = [];

  // Promemoria di backup
  const last = await db.getMeta('lastBackupAt', null);
  const firstUse = await db.getMeta('firstUseAt', null);
  const ref = last || firstUse;
  if (hasVisits && ref && Date.now() - Date.parse(ref) > BACKUP_REMINDER_DAYS * 86400e3) {
    const days = Math.floor((Date.now() - Date.parse(ref)) / 86400e3);
    notices.push(
      h(
        'div',
        { class: 'notice notice-warn' },
        h('p', { text: last ? `Ultimo backup ${fmtNumber(days)} giorni fa.` : 'Non hai ancora esportato un backup.' }),
        h('p', { class: 'hint', text: 'I dati restano solo su questo dispositivo: esporta un backup periodicamente.' }),
        h('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Esporta ora', onclick: exportNow }),
      ),
    );
  }

  // Safari iOS non installato
  if (await install.shouldShowIosHint()) {
    const card = h(
      'div',
      { class: 'notice notice-info', role: 'region', 'aria-label': "Installa l'app" },
      h('strong', { text: "Installa l'app sulla schermata Home" }),
      h('p', { text: 'Tocca Condividi, poi Aggiungi alla schermata Home.' }),
      h('p', { class: 'hint', text: 'Safari può cancellare i dati dei siti non installati dopo 7 giorni senza utilizzo: installare l’app è il modo consigliato di usarla su iPhone e iPad.' }),
      h('p', { class: 'hint', text: 'Attenzione: l’app installata ha un archivio separato da Safari. Le visite registrate qui non compariranno nell’app installata.' }),
      hasVisits &&
        h('button', { type: 'button', class: 'btn btn-secondary btn-small', onclick: exportNow }, 'Esporta prima di installare'),
      h('button', {
        type: 'button',
        class: 'btn btn-text btn-small',
        text: 'Non ora',
        onclick: async () => {
          await install.dismissIosHint();
          card.remove();
        },
      }),
    );
    notices.push(card);
  } else if (install.canPromptInstall()) {
    notices.push(
      h(
        'div',
        { class: 'notice notice-info' },
        h('p', { text: "Installa l'app per aprirla dalla schermata Home e usarla anche offline." }),
        h('button', { type: 'button', class: 'btn btn-secondary btn-small', text: 'Installa', onclick: () => install.promptInstall() }),
      ),
    );
  }

  container.replaceChildren(...notices);
}

async function exportNow() {
  try {
    const file = await buildBackupFile();
    const r = await deliverFile(file, { title: 'Backup Registro Presenze' });
    if (r !== 'cancelled') {
      await markBackupDone();
      toast('Backup esportato');
    }
  } catch (e) {
    showError(e);
  }
}

// ---------------------------------------------------------------------------

export default {
  id: 'presenza',
  title: 'Presenza',
  mount(el) {
    const status = h('section', { class: 'status-card', 'aria-live': 'polite' });
    const notices = h('div', { class: 'notices' });
    const today = h('section', { class: 'today' });
    const dock = h('div', { class: 'action-dock' });
    el.append(status, notices, today, dock);
    let timer;
    let gen = 0;

    async function render() {
      const my = ++gen;
      const [open, count, places] = await Promise.all([db.getOpenVisit(), db.countVisits(), db.getPlaces({ includeDeleted: true })]);
      if (my !== gen) return;
      const byId = new Map(places.map((p) => [p.id, p]));
      clearInterval(timer);
      if (open) {
        const place = byId.get(open.placeId);
        const dur = h('p', { class: 'status-duration' });
        const tick = () => (dur.textContent = fmtDuration(Date.now() - Date.parse(open.arrival)));
        tick();
        timer = setInterval(tick, 60000);
        setChildren(status, 
          h('p', { class: 'status-kicker', text: 'Sei in:' }),
          h('h2', { class: 'status-place' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), placeLabel(place)),
          h('p', { class: 'status-since', text: `dalle ${fmtTime(open.arrival, open.timeZone)}${Date.now() - Date.parse(open.arrival) > 86400e3 ? ` del ${fmtDate(open.arrival, open.timeZone)}` : ''}` }),
          dur,
          open.arrivalAddress?.text && h('p', { class: 'hint', text: open.arrivalAddress.text }),
        );
        const dot = status.querySelector('.dot');
        if (place?.color) dot.style.setProperty('--c', place.color);
        dock.replaceChildren(
          h('button', { type: 'button', class: 'btn btn-big btn-checkout', onclick: () => startCheckOut(open) }, 'Check-out'),
        );
      } else {
        setChildren(status, 
          h('p', { class: 'status-kicker', text: 'Nessuna visita in corso' }),
          h('p', { class: 'hint', text: 'Tocca Check-in quando arrivi: la posizione viene letta solo in quel momento.' }),
        );
        dock.replaceChildren(h('button', { type: 'button', class: 'btn btn-big btn-checkin', onclick: () => startCheckIn() }, 'Check-in'));
      }

      // Oggi
      const range = dayRange(new Date());
      const { items } = await db.listVisits(range, {});
      if (my !== gen) return;
      const total = [...dailyTotals(items, range.start, range.end).values()].reduce((a, b) => a + b, 0);
      setChildren(today, 
        h('h2', { class: 'section-title' }, 'Oggi', h('span', { class: 'section-meta', text: items.length ? fmtDuration(total) : '' })),
        items.length
          ? h('ul', { class: 'visit-list' }, items.map((v) => renderVisitItem(v, byId.get(v.placeId))))
          : h('p', { class: 'empty', text: 'Nessuna visita oggi.' }),
      );
      await renderNotices(notices, count > 0);
    }

    const offInstall = install.onInstallChange(() => render().catch(showError));
    render().catch(showError);
    checkForgottenCheckout().catch(showError);
    return {
      update: () => render().catch(showError),
      destroy() {
        clearInterval(timer);
        offInstall();
      },
    };
  },
};

