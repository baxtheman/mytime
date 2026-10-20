// Flusso di acquisizione GPS condiviso da check-in, check-out e luoghi.

import { GPS_ACCURACY_LIMIT_M } from '../config.js';
import { getPosition, geoErrorMessage } from '../geo.js';
import { fmtNumber } from '../format.js';
import { h, openDialog } from './dom.js';

/**
 * Da chiamare direttamente nel gestore del tap: la richiesta GPS parte subito.
 * @returns {Promise<null | {lat, lon, accuracy, at, lowAccuracy: boolean}>}
 */
export async function acquirePosition() {
  for (;;) {
    const ctrl = new AbortController();
    const request = getPosition(ctrl.signal);
    let dlg;
    const waiting = openDialog({
      title: 'Sto cercando la posizione…',
      className: 'sheet-compact',
      body: h(
        'div',
        { class: 'locating' },
        h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Ricerca della posizione in corso' }),
        h('p', { text: 'Resta fermo qualche secondo: la precisione migliora all’aperto.' }),
      ),
      actions: [{ label: 'Annulla', value: 'cancel', wide: true }],
      onOpen: (d) => (dlg = d),
    });
    const outcome = await Promise.race([
      request.then(
        (pos) => ({ pos }),
        (err) => ({ err }),
      ),
      waiting.then(() => ({ cancelled: true })),
    ]);
    if (outcome.cancelled) {
      ctrl.abort();
      return null;
    }
    dlg?.close();

    if (outcome.err) {
      const code = outcome.err.code;
      if (code === 'aborted') return null;
      const msg = geoErrorMessage(code);
      const canRetry = code !== 'insecure' && code !== 'unsupported';
      const choice = await openDialog({
        title: msg.title,
        body: h('div', { role: 'alert' }, h('p', { text: msg.text }), h('p', { class: 'hint', text: 'Senza una posizione valida l’operazione non può essere registrata.' })),
        actions: [{ label: 'Chiudi', value: null }, canRetry && { label: 'Riprova', value: 'retry', variant: 'primary' }].filter(Boolean),
      });
      if (choice === 'retry') continue;
      return null;
    }

    const pos = outcome.pos;
    if (pos.accuracy <= GPS_ACCURACY_LIMIT_M) return { ...pos, lowAccuracy: false };
    const choice = await openDialog({
      title: `Posizione imprecisa (±${fmtNumber(pos.accuracy)} m)`,
      body: h(
        'p',
        { text: `La precisione è oltre ${GPS_ACCURACY_LIMIT_M} m. Puoi riprovare (meglio all’aperto) oppure usarla comunque: la visita verrà segnata come "Posizione imprecisa".` },
      ),
      actions: [
        { label: 'Annulla', value: null },
        { label: 'Usa comunque', value: 'use' },
        { label: 'Riprova', value: 'retry', variant: 'primary' },
      ],
    });
    if (choice === 'retry') continue;
    if (choice === 'use') return { ...pos, lowAccuracy: true };
    return null;
  }
}
