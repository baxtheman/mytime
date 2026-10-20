// Filtri condivisi tra Cronologia e Report: periodo, luoghi, ricerca testuale.

import { PERIODS, periodRange, shiftAnchor, toDateInputValue, addDays } from '../format.js';
import { placeLabel } from '../report.js';
import { h, icon } from './dom.js';

const today = new Date();
export const filterState = {
  period: 'week',
  anchor: today,
  customStart: toDateInputValue(addDays(today, -6)),
  customEnd: toDateInputValue(today),
  placeIds: new Set(),
  text: '',
};

const subs = new Set();
export function onFiltersChange(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
function changed() {
  subs.forEach((fn) => fn());
}

export function currentRange() {
  return periodRange(filterState);
}

export function currentFilters() {
  return { placeIds: [...filterState.placeIds], text: filterState.text.trim() };
}

/** Barra dei filtri; places include i luoghi eliminati (per filtrare lo storico). */
export function renderFilterBar(places) {
  const root = h('section', { class: 'filters', 'aria-label': 'Filtri' });
  const label = h('p', { class: 'period-label', 'aria-live': 'polite' });
  const custom = h('div', { class: 'custom-range' });

  const periodSel = h(
    'div',
    { class: 'segmented', role: 'radiogroup', 'aria-label': 'Periodo' },
    PERIODS.map((p) =>
      h('button', {
        type: 'button',
        role: 'radio',
        class: 'seg',
        text: p.label,
        dataset: { value: p.value },
        onclick: () => {
          filterState.period = p.value;
          sync();
          changed();
        },
      }),
    ),
  );

  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Periodo precedente', onclick: () => move(-1) }, icon('left'));
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Periodo successivo', onclick: () => move(1) }, icon('right'));
  const todayBtn = h('button', {
    type: 'button',
    class: 'btn btn-secondary btn-small',
    text: 'Oggi',
    onclick: () => {
      filterState.anchor = new Date();
      sync();
      changed();
    },
  });
  function move(dir) {
    filterState.anchor = shiftAnchor(filterState.period, filterState.anchor, dir);
    sync();
    changed();
  }

  const startInput = h('input', { type: 'date', value: filterState.customStart, 'aria-label': 'Dal giorno' });
  const endInput = h('input', { type: 'date', value: filterState.customEnd, 'aria-label': 'Al giorno' });
  const onCustom = () => {
    if (!startInput.value || !endInput.value) return;
    filterState.customStart = startInput.value;
    filterState.customEnd = endInput.value;
    sync();
    changed();
  };
  startInput.addEventListener('change', onCustom);
  endInput.addEventListener('change', onCustom);
  custom.append(h('label', {}, 'Dal ', startInput), h('label', {}, 'al ', endInput));

  const chips =
    places.length > 0 &&
    h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'Filtra per luogo' },
      places.map((p) => {
        const b = h('button', {
          type: 'button',
          class: 'chip',
          'aria-pressed': String(filterState.placeIds.has(p.id)),
          text: placeLabel(p),
          onclick: () => {
            if (filterState.placeIds.has(p.id)) filterState.placeIds.delete(p.id);
            else filterState.placeIds.add(p.id);
            b.setAttribute('aria-pressed', String(filterState.placeIds.has(p.id)));
            changed();
          },
        });
        if (p.color) b.style.setProperty('--c', p.color);
        return b;
      }),
    );

  let debounce;
  const search = h('input', {
    type: 'search',
    value: filterState.text,
    placeholder: 'Cerca luogo, indirizzo o nota',
    'aria-label': 'Cerca per nome del luogo, indirizzo o nota',
    oninput: (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        filterState.text = e.target.value;
        changed();
      }, 250);
    },
  });

  function sync() {
    for (const b of periodSel.children) {
      const on = b.dataset.value === filterState.period;
      b.setAttribute('aria-checked', String(on));
    }
    const isCustom = filterState.period === 'custom';
    custom.hidden = !isCustom;
    prev.hidden = next.hidden = isCustom;
    label.textContent = currentRange().label;
  }

  root.append(
    periodSel,
    h('div', { class: 'period-nav' }, prev, label, next, todayBtn),
    custom,
    chips || '',
    h('div', { class: 'search' }, search),
  );
  sync();
  return root;
}
