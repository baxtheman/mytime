// Report: riepilogo, grafico a barre per luogo (solo interfaccia) e testo condivisibile.
// Testo e CSV vengono preparati PRIMA del tap, così navigator.share resta nel gesto dell'utente.

import * as db from '../db.js';
import { computeReport, buildReportText, reportSubject, buildMailto, MAILTO_MAX_CHARS } from '../report.js';
import { buildCsvFile } from '../io.js';
import { fmtDuration, fmtNumber } from '../format.js';
import { h, icon, setChildren, showError, toast, copyText, openDialog } from './dom.js';
import { renderFilterBar, onFiltersChange, currentRange, currentFilters } from './filters.js';

const options = { detail: 'summary', notes: true, addresses: true };

function chart(rep) {
  if (!rep.byPlace.length) return h('p', { class: 'empty', text: 'Nessuna visita chiusa nel periodo.' });
  const max = Math.max(...rep.byPlace.map((p) => p.ms), 1);
  return h(
    'ul',
    { class: 'bars', 'aria-label': 'Tempo per luogo' },
    rep.byPlace.map((p) => {
      const fill = h('span', { class: 'bar-fill' });
      fill.style.width = `${Math.max(2, (p.ms / max) * 100)}%`;
      if (p.color) fill.style.setProperty('--c', p.color);
      return h(
        'li',
        { class: 'bar' },
        h('span', { class: 'bar-label' }, h('span', { text: p.name }), h('span', { class: 'bar-value', text: `${fmtDuration(p.ms)} · ${fmtNumber(p.count)} ${p.count === 1 ? 'visita' : 'visite'}` })),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, fill),
      );
    }),
  );
}

export default {
  id: 'report',
  title: 'Report',
  mount(el) {
    const barSlot = h('div');
    const stats = h('section', { class: 'stats', 'aria-live': 'polite' });
    const chartSlot = h('section', { class: 'card' });
    const preview = h('textarea', { class: 'report-text', rows: 14, spellcheck: false, 'aria-label': 'Anteprima del testo del report (modificabile)' });
    const lenInfo = h('p', { class: 'hint' });
    let rep = null;
    let summaryText = '';
    let csvFile = null;
    let gen = 0;
    let dirty = false; // testo modificato a mano: non sovrascriverlo con aggiornamenti in background
    const regenBtn = h('button', { type: 'button', class: 'btn btn-text btn-small', hidden: true, text: 'Dati aggiornati · Rigenera testo', onclick: () => regenerate(true) });

    const radio = (name, value, label) =>
      h(
        'label',
        { class: 'inline' },
        h('input', {
          type: 'radio',
          name,
          value,
          checked: options[name] === value,
          onchange: () => {
            options[name] = value;
            regenerate();
          },
        }),
        ` ${label}`,
      );
    const check = (name, label) =>
      h(
        'label',
        { class: 'inline' },
        h('input', {
          type: 'checkbox',
          checked: options[name],
          onchange: (e) => {
            options[name] = e.target.checked;
            regenerate();
          },
        }),
        ` ${label}`,
      );
    const detailOpts = h('div', { class: 'detail-opts' }, check('notes', 'Includi note'), check('addresses', 'Includi indirizzi'));

    const canShare = typeof navigator.share === 'function';
    const shareBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: share, hidden: !canShare }, icon('share', 20), ' Condividi');
    const mailBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: mail }, icon('mail', 20), ' Email');
    const copyBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: copy }, icon('copy', 20), ' Copia');
    const csvBtn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: shareCsv, hidden: true }, icon('file', 20), ' Condividi con CSV');

    el.append(
      barSlot,
      stats,
      chartSlot,
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Testo del report' }),
        h(
          'fieldset',
          { class: 'opts' },
          h('legend', { text: 'Livello di dettaglio' }),
          radio('detail', 'summary', 'Solo riepilogo'),
          radio('detail', 'full', 'Riepilogo + dettaglio visite'),
          detailOpts,
        ),
        preview,
        regenBtn,
        lenInfo,
        h('div', { class: 'share-actions' }, shareBtn, mailBtn, copyBtn, csvBtn),
      ),
    );
    preview.addEventListener('input', () => {
      dirty = true;
      updateLen();
    });

    function updateLen() {
      const n = preview.value.length;
      lenInfo.textContent = `${fmtNumber(n)} caratteri${n > MAILTO_MAX_CHARS ? ` · oltre ${fmtNumber(MAILTO_MAX_CHARS)}: via Email verrà inviato solo il riepilogo` : ''}`;
    }

    function regenerate(force = true) {
      if (!rep) return;
      detailOpts.hidden = options.detail !== 'full';
      summaryText = buildReportText(rep, { detail: 'summary' });
      if (dirty && !force) {
        regenBtn.hidden = false;
        return;
      }
      dirty = false;
      regenBtn.hidden = true;
      preview.value = buildReportText(rep, options);
      updateLen();
    }

    async function load(background = false) {
      const my = ++gen;
      const range = currentRange();
      const [{ items }, places] = await Promise.all([db.listVisits(range, currentFilters()), db.getPlaces({ includeDeleted: true })]);
      if (my !== gen) return;
      const byId = new Map(places.map((p) => [p.id, p]));
      rep = computeReport(items, range, byId);
      setChildren(stats, 
        stat('Visite', fmtNumber(rep.count)),
        stat('Tempo totale', fmtDuration(rep.totalMs)),
        stat('Durata media', rep.count ? fmtDuration(rep.avgMs) : '—'),
        rep.open && h('p', { class: 'hint full', text: 'La visita in corso è esclusa dai totali.' }),
      );
      chartSlot.replaceChildren(h('h2', { class: 'section-title', text: 'Tempo per luogo' }), chart(rep));
      regenerate(!background);
      csvFile = buildCsvFile(items.filter((v) => v.status === 'closed'), byId, range);
      csvBtn.hidden = !(canShare && navigator.canShare?.({ files: [csvFile] }));
    }

    const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-value', text: value }), h('span', { class: 'stat-label', text: label }));

    // Tutti i gestori chiamano le API di condivisione in modo sincrono nel tap.
    function share() {
      if (!rep) return;
      navigator.share({ title: reportSubject(rep.range), text: preview.value }).catch((e) => {
        if (e.name !== 'AbortError') showError('Condivisione non riuscita: usa Email o Copia.');
      });
    }

    function mail() {
      if (!rep) return;
      const subject = reportSubject(rep.range);
      const m = buildMailto(subject, preview.value, summaryText);
      if (!m.shortened) {
        location.href = m.href;
        return;
      }
      openDialog({
        title: 'Testo troppo lungo per l’email',
        body: h('p', {
          text: `Il link email supporta circa ${fmtNumber(MAILTO_MAX_CHARS)} caratteri: verrà inserito solo il riepilogo${m.truncated ? ', accorciato' : ''}. Per il testo completo usa Condividi o Copia.`,
        }),
        actions: [
          { label: 'Annulla', value: null },
          { label: 'Copia testo completo', value: null, onClick: () => copy() },
          { label: 'Apri email', variant: 'primary', onClick: () => (location.href = m.href) },
        ],
      });
    }

    async function copy() {
      if (await copyText(preview.value)) toast('Testo copiato negli appunti');
      else showError('Copia non riuscita: seleziona il testo e copialo a mano.');
    }

    function shareCsv() {
      if (!rep || !csvFile) return;
      navigator.share({ title: reportSubject(rep.range), text: preview.value, files: [csvFile] }).catch((e) => {
        if (e.name !== 'AbortError') showError('Condivisione del file non riuscita.');
      });
    }

    async function reset() {
      const places = await db.getPlaces({ includeDeleted: true });
      barSlot.replaceChildren(renderFilterBar(places));
      await load();
    }

    const offFilters = onFiltersChange(() => load().catch(showError));
    reset().catch(showError);
    return {
      update: (detail) => {
        if (detail?.store === 'meta' || detail?.store === 'visibility') return;
        (detail?.store === 'places' ? reset() : load(true)).catch(showError);
      },
      destroy: () => offFilters(),
    };
  },
};
