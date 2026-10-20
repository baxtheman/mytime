// Introduzione alla prima apertura: 3 schermate.

import * as db from '../db.js';
import { isIOS } from '../geo.js';
import { h, openDialog } from './dom.js';

const STEPS = [
  {
    title: 'Benvenuto in 📍 ndóve?',
    text: [
      'Registra quando arrivi e quando parti da un luogo: data, ora, posizione GPS e indirizzo.',
      'Dalla sezione Report puoi creare un riepilogo in testo semplice da inviare via email o incollare dove vuoi.',
    ],
  },
  {
    title: 'Permesso di posizione',
    text: [
      'Check-in e check-out richiedono una posizione GPS valida: così l’app verifica che tu sia davvero sul posto.',
      'La posizione viene letta solo quando tocchi un pulsante, mai in background. Quando il browser lo chiede, tocca Consenti.',
      ...(isIOS ? ['Su iPhone attiva anche "Posizione esatta" per Safari (Impostazioni › Privacy › Localizzazione › Siti Safari).'] : []),
    ],
  },
  {
    title: 'I tuoi dati restano qui',
    text: [
      'Tutto viene salvato solo su questo dispositivo: nessun account, nessun cloud.',
      'Per non perdere nulla esporta un backup ogni tanto da Impostazioni › Backup. L’app ti ricorderà di farlo ogni 30 giorni.',
      ...(isIOS ? ['Su iPhone installa l’app (Condividi › Aggiungi alla schermata Home): Safari può cancellare i dati dei siti non usati per 7 giorni.'] : []),
    ],
  },
];

export async function showOnboarding() {
  let i = 0;
  const content = h('div', { class: 'onboarding', 'aria-live': 'polite' });
  const dots = h('div', { class: 'steps', 'aria-hidden': 'true' });
  const render = (dlg) => {
    const s = STEPS[i];
    dlg.querySelector('h2').textContent = s.title;
    content.replaceChildren(...s.text.map((t) => h('p', { text: t })));
    dots.replaceChildren(...STEPS.map((_, j) => h('span', { class: j === i ? 'on' : '' })));
    const back = dlg.querySelector('[data-key="back"]');
    const next = dlg.querySelector('[data-key="next"]');
    back.hidden = i === 0;
    next.textContent = i === STEPS.length - 1 ? 'Inizia' : 'Avanti';
    content.closest('.sheet-body').scrollTop = 0;
  };
  await openDialog({
    title: STEPS[0].title,
    className: 'sheet-onboarding',
    body: h('div', {}, content, dots),
    onOpen: render,
    actions: [
      {
        label: 'Indietro',
        key: 'back',
        onClick: (e, { dialog }) => {
          i = Math.max(0, i - 1);
          render(dialog);
          return false;
        },
      },
      {
        label: 'Avanti',
        key: 'next',
        variant: 'primary',
        onClick: (e, { dialog }) => {
          if (i < STEPS.length - 1) {
            i++;
            render(dialog);
            return false;
          }
        },
      },
    ],
  });
  await db.setMeta('onboardedAt', new Date().toISOString());
}
