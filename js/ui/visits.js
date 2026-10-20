// Voce di visita (cronologia/home) e dialogo di modifica.

import * as db from '../db.js';
import * as geocode from '../geocode.js';
import { NOTE_MAX } from '../config.js';
import { fmtDeparture, fmtDuration, fmtTime, fmtDateTime, fmtCoords, fmtNumber, toInputValue, fromInputValue, nowRoundedToMinute } from '../format.js';
import { placeLabel } from '../report.js';
import { h, openDialog, confirmDialog, toast, showError, field } from './dom.js';

export function visitBadges(v) {
  const b = [];
  if (v.status === 'open') b.push(['live', 'In corso']);
  if (v.flags?.includes('needsClose')) b.push(['warn', 'Da chiudere']);
  if (v.flags?.includes('edited')) b.push(['info', 'Modificata']);
  if (v.flags?.includes('manualDeparture')) b.push(['info', 'Chiusa manualmente']);
  if (v.flags?.includes('outOfRange')) b.push(['warn', 'Fuori raggio']);
  if (v.flags?.includes('lowAccuracy')) b.push(['warn', 'Posizione imprecisa']);
  if (v.arrivalAddress?.status === 'pending' || v.departureAddress?.status === 'pending') b.push(['muted', 'Indirizzo in attesa']);
  if (v.arrivalAddress?.status === 'failed' || v.departureAddress?.status === 'failed') b.push(['warn', 'Indirizzo non trovato']);
  return h('ul', { class: 'badges', 'aria-label': 'Indicatori' }, b.map(([kind, label]) => h('li', { class: `badge badge-${kind}`, text: label })));
}

export function timesLabel(v) {
  if (v.status === 'open') return `${fmtTime(v.arrival, v.timeZone)} – in corso · ${fmtDuration(Date.now() - Date.parse(v.arrival))}`;
  if (!v.departure) return `${fmtTime(v.arrival, v.timeZone)} – partenza mancante`;
  return `${fmtTime(v.arrival, v.timeZone)} – ${fmtDeparture(v.departure, v.arrival, v.timeZone)} · ${fmtDuration(Date.parse(v.departure) - Date.parse(v.arrival))}`;
}

export function renderVisitItem(v, place) {
  const failed = ['arrival', 'departure'].filter((w) => v[`${w}Address`]?.status === 'failed');
  const li = h(
    'li',
    { class: ['visit', v.status === 'open' && 'visit-live'], dataset: { id: v.id } },
    h(
      'button',
      { type: 'button', class: 'visit-open', onclick: () => openVisitEditor(v.id) },
      h(
        'span',
        { class: 'visit-main' },
        h('span', { class: 'visit-title', text: placeLabel(place) }),
        h('span', { class: 'visit-times', text: timesLabel(v) }),
        v.arrivalAddress?.text && h('span', { class: 'visit-addr', text: v.arrivalAddress.text }),
        v.note && h('span', { class: 'visit-note', text: v.note }),
        visitBadges(v),
      ),
    ),
    failed.length > 0 &&
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-text btn-small',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            if (!navigator.onLine) {
              showError('Sei offline: l’indirizzo verrà cercato al ritorno della rete.');
            }
            for (const w of failed) await geocode.retry(v.id, w);
          },
        },
        'Riprova indirizzo',
      ),
  );
  if (place?.color) li.style.setProperty('--c', place.color);
  return li;
}

// ---------------------------------------------------------------------------

function addressBlock(label, v, which, input) {
  const addr = v[`${which}Address`];
  const pos = v[`${which}Pos`];
  if (!pos) return null;
  const status =
    addr?.status === 'pending' ? 'Indirizzo in attesa (verrà cercato appena c’è rete).' : addr?.status === 'failed' ? 'Indirizzo non trovato.' : null;
  return h(
    'div',
    { class: 'addr-block' },
    field(`Indirizzo ${label}`, input, addr?.edited && addr.originalText ? `Rilevato: ${addr.originalText}` : null),
    h('p', { class: 'hint', text: `GPS: ${fmtCoords(pos.lat, pos.lon)} ±${fmtNumber(pos.accuracy)} m (non modificabile)` }),
    status && h('p', { class: 'hint', text: status }),
    addr?.status === 'failed' &&
      h('button', {
        type: 'button',
        class: 'btn btn-secondary btn-small',
        text: 'Riprova indirizzo',
        onclick: async (e) => {
          e.currentTarget.disabled = true;
          await geocode.retry(v.id, which);
          toast('Ricerca indirizzo avviata');
        },
      }),
  );
}

export async function openVisitEditor(visitId) {
  const [v, places] = await Promise.all([db.getVisit(visitId), db.getPlaces({ includeDeleted: true })]);
  if (!v) return showError('Visita non trovata: forse è stata eliminata in un’altra scheda.');
  const placesById = new Map(places.map((p) => [p.id, p]));
  const nowMax = toInputValue(nowRoundedToMinute());

  const arrival = h('input', { type: 'datetime-local', value: toInputValue(v.arrival), max: nowMax, required: true });
  const departure = h('input', { type: 'datetime-local', value: v.departure ? toInputValue(v.departure) : '', max: nowMax, min: toInputValue(v.arrival) });
  arrival.addEventListener('change', () => (departure.min = arrival.value));
  const placeSel = h(
    'select',
    {},
    places
      .filter((p) => !p.deletedAt || p.id === v.placeId)
      .map((p) => h('option', { value: p.id, text: placeLabel(p), selected: p.id === v.placeId })),
  );
  const note = h('textarea', { rows: 3, maxlength: NOTE_MAX, value: v.note || '' });
  const arrAddr = h('input', { type: 'text', value: v.arrivalAddress?.text || '', autocomplete: 'off' });
  const depAddr = h('input', { type: 'text', value: v.departureAddress?.text || '', autocomplete: 'off' });

  const orig = v.original;
  const origInfo =
    orig &&
    h(
      'p',
      { class: 'hint' },
      `Valori originali: ${fmtDateTime(orig.arrival, v.timeZone)} – ${orig.departure ? fmtDateTime(orig.departure, v.timeZone) : 'in corso'}` +
        (orig.placeId !== v.placeId ? `, luogo ${placeLabel(placesById.get(orig.placeId))}` : ''),
    );

  const body = h(
    'form',
    { class: 'form', onsubmit: (e) => e.preventDefault() },
    visitBadges(v),
    field('Arrivo', arrival),
    field('Partenza', departure, v.status === 'open' ? 'Lascia vuoto se la visita è ancora in corso.' : null),
    field('Luogo', placeSel),
    field('Nota', note, `Facoltativa, massimo ${NOTE_MAX} caratteri.`),
    origInfo,
    addressBlock('di arrivo', v, 'arrival', arrAddr),
    addressBlock('di partenza', v, 'departure', depAddr),
  );

  const save = async () => {
    const a = fromInputValue(arrival.value);
    if (!a) throw new Error("Indica l'orario di arrivo.");
    const d = departure.value ? fromInputValue(departure.value) : null;
    // Mantiene secondi e millisecondi se l'utente non ha toccato l'orario.
    const arrIso = arrival.value === toInputValue(v.arrival) ? v.arrival : a.toISOString();
    const depIso = !d ? null : v.departure && departure.value === toInputValue(v.departure) ? v.departure : d.toISOString();
    const overlaps = await db.findOverlaps(v.id, arrIso, depIso);
    if (overlaps.length) {
      const ok = await confirmDialog(
        'Sovrapposizione',
        `Questa visita si sovrappone ${overlaps.length === 1 ? "a un'altra visita" : `ad altre ${overlaps.length} visite`}. Salvare comunque?`,
        { okLabel: 'Salva comunque' },
      );
      if (!ok) return false;
    }
    await db.updateVisit(v.id, {
      arrival: arrIso,
      departure: depIso,
      placeId: placeSel.value,
      note: note.value,
      arrivalAddressText: arrAddr.value,
      departureAddressText: depAddr.value,
    });
    toast('Visita salvata');
    return 'saved';
  };

  const remove = async () => {
    const ok = await confirmDialog('Eliminare la visita?', `${placeLabel(placesById.get(v.placeId))}, ${fmtDateTime(v.arrival, v.timeZone)}.`, {
      okLabel: 'Elimina',
      danger: true,
    });
    if (!ok) return false;
    const removed = await db.deleteVisit(v.id);
    toast('Visita eliminata', {
      action: {
        label: 'Annulla',
        onClick: () =>
          db
            .restoreVisit(removed)
            .then(() => toast('Visita ripristinata'))
            .catch((err) => showError(err)),
      },
    });
    return 'deleted';
  };

  return openDialog({
    title: 'Modifica visita',
    body,
    actions: [
      { label: 'Elimina', variant: 'danger-text', onClick: () => remove() },
      { label: 'Annulla', value: null },
      { label: 'Salva', variant: 'primary', onClick: () => save() },
    ],
  });
}

