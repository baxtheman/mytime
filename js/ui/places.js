// Luoghi: elenco, riordino (maniglia + pulsanti Su/Giù), creazione, modifica, eliminazione.

import * as db from '../db.js';
import { fmtNumber } from '../format.js';
import { h, icon, openDialog, toast, showError } from './dom.js';
import { openPlaceForm } from './placeForm.js';

async function removePlace(place) {
  const open = await db.getOpenVisit();
  if (open?.placeId === place.id) throw new Error('Questo luogo ha una visita in corso: fai il check-out prima di eliminarlo.');
  const count = await db.countVisitsForPlace(place.id);
  if (count === 0) {
    const ok = await openDialog({
      title: `Eliminare "${place.name}"?`,
      body: h('p', { text: 'Il luogo non ha visite registrate.' }),
      actions: [
        { label: 'Annulla', value: false },
        { label: 'Elimina', value: true, variant: 'danger' },
      ],
    });
    if (!ok) return;
    await db.deletePlace(place.id, 'keep');
    toast('Luogo eliminato');
    return;
  }
  const mode = await openDialog({
    title: `Eliminare "${place.name}"?`,
    body: h(
      'div',
      {},
      h('p', { text: `Il luogo ha ${fmtNumber(count)} ${count === 1 ? 'visita' : 'visite'}.` }),
      h('p', { class: 'hint', text: '"Conserva le visite": il luogo non sarà più selezionabile, ma nome e colore restano in cronologia e report, marcati "(eliminato)".' }),
    ),
    actions: [
      { label: 'Annulla', value: null },
      { label: 'Elimina anche le visite', value: 'purge', variant: 'danger-text' },
      { label: 'Conserva le visite', value: 'keep', variant: 'primary' },
    ],
  });
  if (!mode) return;
  if (mode === 'purge') {
    const ok = await openDialog({
      title: 'Eliminazione definitiva',
      body: h('p', { text: `Verranno eliminati il luogo "${place.name}" e ${fmtNumber(count)} ${count === 1 ? 'visita' : 'visite'}. L’operazione non si può annullare.` }),
      actions: [
        { label: 'Annulla', value: false },
        { label: `Elimina ${fmtNumber(count)} ${count === 1 ? 'visita' : 'visite'}`, value: true, variant: 'danger' },
      ],
    });
    if (!ok) return;
  }
  const removed = await db.deletePlace(place.id, mode);
  toast(mode === 'purge' ? `Luogo e ${fmtNumber(removed)} ${removed === 1 ? 'visita eliminati' : 'visite eliminate'}` : 'Luogo eliminato, visite conservate');
}

/** Riordino con la maniglia: trascinamento verticale con pointer events. */
function enableDrag(list, handle, item, onDrop) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    item.classList.add('dragging');
    let lastY = e.clientY;
    let offset = 0;
    const move = (ev) => {
      offset += ev.clientY - lastY;
      lastY = ev.clientY;
      const prev = item.previousElementSibling;
      const next = item.nextElementSibling;
      if (prev && offset < -prev.offsetHeight / 2) {
        list.insertBefore(item, prev);
        offset += prev.offsetHeight;
      } else if (next && offset > next.offsetHeight / 2) {
        list.insertBefore(next, item);
        offset -= next.offsetHeight;
      }
      item.style.transform = `translateY(${offset}px)`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      item.classList.remove('dragging');
      item.style.transform = '';
      onDrop();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

export default {
  id: 'luoghi',
  title: 'Luoghi',
  mount(el) {
    const list = h('ol', { class: 'place-list', 'aria-label': 'Luoghi salvati' });
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const addBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary btn-wide',
        onclick: () => openPlaceForm().catch(showError),
      },
      icon('plus', 20),
      ' Nuovo luogo',
    );
    el.append(h('div', { class: 'action-dock action-dock-inline' }, addBtn), list, live);

    let places = [];

    const saveOrder = async () => {
      const ids = [...list.children].map((li) => li.dataset.id);
      if (ids.join() === places.map((p) => p.id).join()) return;
      await db.reorderPlaces(ids).catch(showError);
    };

    const moveBy = async (i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= places.length) return;
      const ids = places.map((p) => p.id);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await db.reorderPlaces(ids);
      live.textContent = `${places[i].name} spostato in posizione ${j + 1} di ${places.length}`;
      // Mantiene il focus sul pulsante usato dopo il nuovo render.
      requestAnimationFrame(() => list.querySelector(`[data-id="${ids[j]}"] [data-move="${dir}"]`)?.focus());
    };

    async function render() {
      places = await db.getPlaces();
      if (!places.length) {
        list.replaceChildren(h('li', { class: 'empty', text: 'Nessun luogo salvato. Vai sul posto e tocca "Nuovo luogo".' }));
        return;
      }
      list.replaceChildren(
        ...places.map((p, i) => {
          const handle = h('span', { class: 'drag-handle', title: 'Trascina per riordinare', 'aria-hidden': 'true' }, icon('drag'));
          const li = h(
            'li',
            { class: 'place', dataset: { id: p.id } },
            handle,
            h(
              'button',
              { type: 'button', class: 'place-open', onclick: () => openPlaceForm({ place: p }).catch(showError) },
              h(
                'span',
                { class: 'place-main' },
                h('span', { class: 'place-name', text: p.name }),
                h('span', { class: 'place-sub', text: [p.address, `raggio ${fmtNumber(p.radius)} m`].filter(Boolean).join(' · ') }),
                p.description && h('span', { class: 'place-desc', text: p.description }),
              ),
            ),
            h(
              'span',
              { class: 'place-tools' },
              h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Sposta su ${p.name}`, disabled: i === 0, dataset: { move: '-1' }, onclick: () => moveBy(i, -1).catch(showError) }, icon('up')),
              h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Sposta giù ${p.name}`, disabled: i === places.length - 1, dataset: { move: '1' }, onclick: () => moveBy(i, 1).catch(showError) }, icon('down')),
              h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Elimina ${p.name}`, onclick: () => removePlace(p).catch(showError) }, icon('trash')),
            ),
          );
          if (p.color) li.style.setProperty('--c', p.color);
          enableDrag(list, handle, li, saveOrder);
          return li;
        }),
      );
    }

    render().catch(showError);
    return { update: (detail) => detail?.store === 'places' && render().catch(showError) };
  },
};
