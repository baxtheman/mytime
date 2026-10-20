// Helper DOM, icone, toast, errori e dialoghi (elemento <dialog> nativo).

import { UNDO_MS } from '../config.js';

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': '…' }, 'Testo', childNode)
 * Proprietà: class, text, dataset, style (stringa), on* (eventi), le altre come attributi
 * (true → attributo vuoto, false/null → omesso). value/checked/disabled/hidden come proprietà.
 */
export function h(tag, props = {}, ...children) {
  const el = tag === 'svg' || props?.ns === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false || k === 'ns') continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'hidden', 'selected', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

/** Come replaceChildren, ma ignora null/false/undefined. */
export function setChildren(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// ---------------------------------------------------------------------------
// Icone (SVG inline, nessuna richiesta di rete)

const ICONS = {
  pin: 'M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z',
  history: 'M13 3a9 9 0 0 0-9 9H1l4 4 4-4H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3Zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12Z',
  report: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 12h2v-5H7v5Zm4 0h2V7h-2v8Zm4 0h2v-3h-2v3Z',
  places: 'M15 4.5 9 2 3 4.5v17L9 19l6 2.5 6-2.5V2l-6 2.5ZM9 4.2l6 2.5v12.1l-6-2.5V4.2Z',
  settings:
    'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5L19.4 13ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
  left: 'M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12l4.6-4.6Z',
  right: 'M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6-4.6 4.6Z',
  up: 'm7.4 15.4 4.6-4.6 4.6 4.6L18 14l-6-6-6 6 1.4 1.4Z',
  down: 'M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z',
  drag: 'M9 4h2v2H9V4Zm4 0h2v2h-2V4ZM9 9h2v2H9V9Zm4 0h2v2h-2V9Zm-4 5h2v2H9v-2Zm4 0h2v2h-2v-2Zm-4 5h2v2H9v-2Zm4 0h2v2h-2v-2Z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4Z',
  gps: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2Zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z',
  share: 'M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1Z',
  mail: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z',
  copy: 'M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-1 7V3.5L18.5 9H13Z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z',
  edit: 'M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25ZM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83Z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z',
  warn: 'M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z',
};

export function icon(name, size = 24) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.info);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

// ---------------------------------------------------------------------------
// Toast (aria-live="polite") ed errori (role="alert")

export function toast(message, { action, duration } = {}) {
  const region = document.getElementById('toasts');
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  const el = h(
    'div',
    { class: 'toast' },
    h('span', { text: message }),
    action &&
      h('button', {
        class: 'btn btn-text',
        type: 'button',
        text: action.label,
        onclick: () => {
          close();
          action.onClick();
        },
      }),
  );
  region.append(el);
  const timer = setTimeout(close, duration ?? (action ? UNDO_MS : 4000));
  return close;
}

export function showError(err, title) {
  const message = typeof err === 'string' ? err : err?.message || 'Errore imprevisto.';
  if (typeof err !== 'string') console.error(err);
  const region = document.getElementById('alerts');
  const el = h(
    'div',
    { class: 'alert', role: 'alert' },
    icon('warn', 20),
    h('div', { class: 'alert-body' }, title && h('strong', { text: title }), h('span', { text: message })),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi messaggio', onclick: () => el.remove() }, icon('close', 20)),
  );
  region.append(el);
  setTimeout(() => el.remove(), 12000);
}

// ---------------------------------------------------------------------------
// Dialoghi

let dialogSeq = 0;

/**
 * Apre un dialogo modale. Ogni azione chiude il dialogo e risolve la Promise con il suo value,
 * salvo che onClick restituisca false. onClick viene eseguito in modo sincrono nel gesto
 * dell'utente (necessario per navigator.share su iOS).
 * @returns {Promise<any>} value dell'azione, o undefined se chiuso
 */
export function openDialog({ title, body, actions = [], className = '', dismissible = true, onOpen, labelledBy } = {}) {
  return new Promise((resolve) => {
    const id = `dlg-${++dialogSeq}`;
    const dlg = h('dialog', { class: ['sheet', className], 'aria-labelledby': `${id}-title` });
    let result;
    const finish = (value) => {
      result = value;
      dlg.close();
    };
    const header = h(
      'header',
      { class: 'sheet-header' },
      h('h2', { id: `${id}-title`, text: title || '' }),
      dismissible && h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', onclick: () => finish(undefined) }, icon('close')),
    );
    const content = h('div', { class: 'sheet-body' });
    append(content, [typeof body === 'function' ? body({ close: finish, dialog: dlg }) : body]);
    const footer = h('footer', { class: 'sheet-actions' });
    for (const a of actions) {
      footer.append(
        h('button', {
          type: 'button',
          class: ['btn', a.variant ? `btn-${a.variant}` : 'btn-secondary', a.wide && 'btn-wide'],
          text: a.label,
          disabled: a.disabled,
          dataset: a.key ? { key: a.key } : undefined,
          onclick: (e) => {
            const r = a.onClick ? a.onClick(e, { close: finish, dialog: dlg }) : undefined;
            if (r === false) return;
            if (r instanceof Promise) {
              e.currentTarget.disabled = true;
              const btn = e.currentTarget;
              r.then((v) => (v === false ? (btn.disabled = false) : finish(v === undefined ? a.value : v))).catch((err) => {
                btn.disabled = false;
                showError(err);
              });
              return;
            }
            finish(a.value);
          },
        }),
      );
    }
    dlg.append(header, content);
    if (actions.length) dlg.append(footer);
    dlg.addEventListener('cancel', (e) => {
      if (!dismissible) e.preventDefault();
    });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    onOpen?.(dlg);
  });
}

export async function confirmDialog(title, message, { okLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = {}) {
  const r = await openDialog({
    title,
    body: h('p', { text: message }),
    actions: [
      { label: cancelLabel, value: false },
      { label: okLabel, value: true, variant: danger ? 'danger' : 'primary' },
    ],
  });
  return r === true;
}

export function field(label, input, hint) {
  const id = input.id || `f-${Math.random().toString(36).slice(2, 9)}`;
  input.id = id;
  const hintEl = hint ? h('p', { class: 'hint', id: `${id}-hint`, text: hint }) : null;
  if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hintEl);
}

// ---------------------------------------------------------------------------
// File: prima navigator.share({ files }), poi download come fallback.

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function canShareFile(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

/**
 * Consegna un file all'utente. Se il gesto è scaduto (es. dopo una lettura lenta),
 * propone un nuovo tap. @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function deliverFile(file, { title } = {}) {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: title || file.name });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      if (e.name !== 'NotAllowedError') console.warn('share', e);
      // Gesto scaduto o condivisione non permessa: chiedi un nuovo tap.
      const choice = await openDialog({
        title: 'File pronto',
        body: h('p', { text: `${file.name} è pronto. Scegli come salvarlo.` }),
        actions: [
          {
            label: 'Scarica',
            value: 'download',
            onClick: () => {
              downloadFile(file);
            },
          },
          {
            label: 'Condividi / Salva',
            variant: 'primary',
            onClick: () =>
              navigator.share({ files: [file], title: title || file.name }).then(
                () => 'shared',
                (err) => (err.name === 'AbortError' ? 'cancelled' : (downloadFile(file), 'downloaded')),
              ),
          },
        ],
      });
      if (choice === 'download') return 'downloaded';
      return choice || 'cancelled';
    }
  }
  downloadFile(file);
  return 'downloaded';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0', readonly: true });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function prefersReducedMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
