// Dialogo di creazione/modifica di un luogo. Le coordinate arrivano solo dal GPS
// (o dal trascinamento del segnaposto sulla mappa, se attiva).

import * as db from '../db.js';
import * as geocode from '../geocode.js';
import { PALETTE, DEFAULT_RADIUS_M, MIN_RADIUS_M, MAX_RADIUS_M, PLACE_NAME_MAX } from '../config.js';
import { fmtCoords, fmtNumber } from '../format.js';
import { h, openDialog, field, toast } from './dom.js';
import { acquirePosition } from './position.js';
import { createMap, isMapEnabled } from './map.js';

/**
 * @param {{ place?: object, pos?: {lat, lon, accuracy} }} opts pos: posizione appena acquisita (creazione al volo)
 * @returns {Promise<object|null>} luogo salvato
 */
export async function openPlaceForm({ place = null, pos = null } = {}) {
  const usedColors = new Set((await db.getPlaces()).map((p) => p.color));
  const state = {
    lat: place?.lat ?? pos?.lat ?? null,
    lon: place?.lon ?? pos?.lon ?? null,
    accuracy: place?.accuracy ?? pos?.accuracy ?? null,
    color: place?.color || PALETTE.find((c) => !usedColors.has(c.value))?.value || PALETTE[0].value,
  };
  const mapOn = await isMapEnabled();
  let map = null;
  let saveBtn;

  const name = h('input', { type: 'text', maxlength: PLACE_NAME_MAX, value: place?.name || '', placeholder: 'Facoltativo', autocomplete: 'off' });
  const posText = h('p', { class: 'pos-text', 'aria-live': 'polite' });
  const radius = h('input', { type: 'range', min: MIN_RADIUS_M, max: MAX_RADIUS_M, step: 10, value: place?.radius ?? DEFAULT_RADIUS_M });
  const radiusOut = h('output', { class: 'range-value' });
  const address = h('input', { type: 'text', value: place?.address || '', autocomplete: 'off' });
  const description = h('textarea', { rows: 2, value: place?.description || '' });

  const renderPos = () => {
    posText.textContent =
      state.lat == null ? 'Nessuna posizione: tocca "Usa posizione attuale" stando sul posto.' : `${fmtCoords(state.lat, state.lon)} ±${fmtNumber(state.accuracy || 0)} m`;
    posText.classList.toggle('missing', state.lat == null);
    if (saveBtn) saveBtn.disabled = state.lat == null;
  };
  const renderRadius = () => {
    radiusOut.textContent = `${fmtNumber(+radius.value)} m`;
    map?.setRadius(+radius.value);
  };
  radius.addEventListener('input', renderRadius);

  let addressLookup = null; // ricerca in corso: il salvataggio la attende se il nome è vuoto
  const fillAddress = (force) => {
    if (state.lat == null || (!force && address.value.trim())) return;
    address.placeholder = 'Ricerca indirizzo…';
    addressLookup = geocode.lookup(state.lat, state.lon).then((text) => {
      address.placeholder = text ? '' : navigator.onLine ? 'Indirizzo non trovato' : 'Offline: inseriscilo a mano o riprova più tardi';
      if (text && (force || !address.value.trim())) address.value = text;
      addressLookup = null;
    });
    return addressLookup;
  };

  const gpsBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-secondary',
      onclick: async () => {
        const p = await acquirePosition();
        if (!p) return;
        Object.assign(state, { lat: p.lat, lon: p.lon, accuracy: p.accuracy });
        renderPos();
        map?.setPosition(p.lat, p.lon);
        fillAddress(true);
      },
    },
    'Usa posizione attuale',
  );

  const swatches = h(
    'fieldset',
    { class: 'swatches' },
    h('legend', { text: 'Colore' }),
    PALETTE.map((c) => {
      const input = h('input', {
        type: 'radio',
        name: 'place-color',
        value: c.value,
        checked: c.value === state.color,
        'aria-label': c.label,
        onchange: () => {
          state.color = c.value;
          map?.setColor(c.value);
        },
      });
      const lbl = h('label', { class: 'swatch', title: c.label }, input, h('span', { 'aria-hidden': 'true' }));
      lbl.style.setProperty('--c', c.value);
      return lbl;
    }),
  );

  const mapSlot = h('div', { class: 'map-slot' });
  const body = h(
    'form',
    { class: 'form', onsubmit: (e) => e.preventDefault() },
    field('Nome', name, `Facoltativo: se vuoto si usa l’indirizzo. Massimo ${PLACE_NAME_MAX} caratteri.`),
    h('div', { class: 'field' }, h('span', { class: 'label', text: 'Posizione' }), posText, gpsBtn),
    mapSlot,
    field('Raggio di tolleranza', radius),
    radiusOut,
    h('div', { class: 'field' }, field('Indirizzo', address, 'Precompilato da OpenStreetMap, modificabile.')),
    swatches,
    field('Descrizione', description, 'Facoltativa.'),
  );
  renderPos();
  renderRadius();
  if (state.lat != null && !place) fillAddress(false);

  const result = await openDialog({
    title: place ? 'Modifica luogo' : 'Nuovo luogo',
    body,
    onOpen: (dlg) => {
      saveBtn = dlg.querySelector('[data-key="save"]');
      renderPos();
      if (mapOn) {
        map = createMap({
          lat: state.lat,
          lon: state.lon,
          radius: +radius.value,
          color: state.color,
          draggable: true,
          onMove: (la, lo) => {
            state.lat = la;
            state.lon = lo;
            renderPos();
          },
        });
        mapSlot.append(map.el);
      }
      if (!place) name.focus();
    },
    actions: [
      { label: 'Annulla', value: null },
      {
        label: 'Salva',
        key: 'save',
        variant: 'primary',
        onClick: async () => {
          if (!name.value.trim() && !address.value.trim() && addressLookup) await addressLookup;
          const saved = await db.savePlace({
            id: place?.id,
            name: name.value,
            lat: state.lat,
            lon: state.lon,
            accuracy: state.accuracy,
            radius: +radius.value,
            address: address.value,
            color: state.color,
            description: description.value,
          });
          toast(place ? 'Luogo aggiornato' : 'Luogo salvato');
          return saved;
        },
      },
    ],
  });
  map?.destroy();
  return result || null;
}
