// Cronologia: visite dalla più recente, raggruppate per giorno di arrivo, caricate a pagine di 50.

import * as db from '../db.js';
import { PAGE_SIZE } from '../config.js';
import { dayKey, dayRange, fmtDayLong, fmtDuration } from '../format.js';
import { dailyTotals } from '../report.js';
import { h, showError } from './dom.js';
import { renderFilterBar, onFiltersChange, currentRange, currentFilters } from './filters.js';
import { renderVisitItem } from './visits.js';

export default {
  id: 'cronologia',
  title: 'Cronologia',
  mount(el) {
    const barSlot = h('div');
    const list = h('div', { class: 'history', 'aria-live': 'off' });
    const status = h('p', { class: 'empty', 'aria-live': 'polite' });
    const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
    el.append(barSlot, list, status, sentinel);

    let gen = 0;
    let nextOffset = 0;
    let done = false;
    let loading = false;
    let placesById = new Map();
    let lastDay = null;
    let lastGroup = null;
    let count = 0;

    async function reset() {
      const places = await db.getPlaces({ includeDeleted: true });
      placesById = new Map(places.map((p) => [p.id, p]));
      barSlot.replaceChildren(renderFilterBar(places));
      await reload();
    }

    async function reload() {
      gen++;
      nextOffset = 0;
      done = false;
      loading = false;
      lastDay = null;
      lastGroup = null;
      count = 0;
      list.replaceChildren();
      status.textContent = 'Caricamento…';
      await loadMore();
    }

    async function dayTotal(key, date, header, my) {
      const r = dayRange(date);
      const { items } = await db.listVisits(r, currentFilters());
      if (my !== gen) return;
      const ms = dailyTotals(items, r.start, r.end).get(key) || 0;
      header.textContent = `Totale ${fmtDuration(ms)}`;
    }

    async function loadMore() {
      if (loading || done) return;
      loading = true;
      const my = gen;
      try {
        const page = await db.listVisits(currentRange(), currentFilters(), { offset: nextOffset, limit: PAGE_SIZE });
        if (my !== gen) return;
        nextOffset = page.nextOffset;
        done = page.done;
        for (const v of page.items) {
          const key = dayKey(v.arrival);
          if (key !== lastDay) {
            lastDay = key;
            const date = new Date(v.arrival);
            const total = h('span', { class: 'section-meta', text: '…' });
            lastGroup = h('ul', { class: 'visit-list' });
            list.append(h('section', { class: 'day' }, h('h2', { class: 'day-header' }, h('span', { text: fmtDayLong(date) }), total), lastGroup));
            dayTotal(key, date, total, my).catch(showError);
          }
          lastGroup.append(renderVisitItem(v, placesById.get(v.placeId)));
          count++;
        }
        status.textContent = done ? (count ? `${count} ${count === 1 ? 'visita' : 'visite'}` : 'Nessuna visita nel periodo.') : '';
      } catch (e) {
        showError(e);
      } finally {
        if (my === gen) loading = false;
      }
      // Riempie lo schermo se la pagina non basta a far comparire la barra di scorrimento.
      if (my === gen && !done && sentinel.getBoundingClientRect().top < innerHeight + 400) loadMore();
    }

    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore(), { rootMargin: '600px' });
    io.observe(sentinel);
    const offFilters = onFiltersChange(() => reload());
    reset().catch(showError);

    return {
      update: (detail) => {
        if (detail?.store === 'meta' || detail?.store === 'visibility') return;
        (detail?.store === 'places' ? reset() : reload()).catch(showError);
      },
      destroy() {
        io.disconnect();
        offFilters();
      },
    };
  },
};
