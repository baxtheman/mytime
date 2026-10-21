// Impostazioni: tema, notifiche, mappa, Nominatim, archiviazione, backup/import/export.

import * as db from '../db.js';
import * as geocode from '../geocode.js';
import { APP_VERSION, APP_SHORT_NAME } from '../config.js';
import { fmtBytes, fmtDateTime, fmtNumber } from '../format.js';
import { buildBackupFile, markBackupDone, buildCsvFile, readJsonFile, validateBackup, importSummary } from '../io.js';
import { h, setChildren, openDialog, toast, showError, field, deliverFile, downloadFile } from './dom.js';
import { getTheme, setTheme } from './theme.js';
import { storageStatus, requestPersistence } from './install.js';
import { showOnboarding } from './onboarding.js';
import * as notifications from './notifications.js';

async function exportJson() {
  const file = await buildBackupFile();
  const r = await deliverFile(file, { title: `Backup ${APP_SHORT_NAME}` });
  if (r !== 'cancelled') {
    await markBackupDone();
    toast('Backup esportato');
  }
}

async function exportCsv() {
  const [{ visits }, places] = await Promise.all([db.exportAll(), db.getPlaces({ includeDeleted: true })]);
  const file = buildCsvFile(visits, new Map(places.map((p) => [p.id, p])));
  await deliverFile(file, { title: `Visite ${APP_SHORT_NAME} (CSV)` });
}

async function importFile(file) {
  const read = await readJsonFile(file);
  let errors = read.errors || [];
  let data;
  const existing = await db.getAllIds();
  if (!errors.length) ({ errors, data } = validateBackup(read.json, existing.places));
  if (errors.length) {
    await openDialog({
      title: 'Import non riuscito',
      body: h(
        'div',
        { role: 'alert' },
        h('p', { text: 'Nessun dato è stato modificato. Problemi trovati:' }),
        h('ul', { class: 'error-list' }, errors.slice(0, 50).map((e) => h('li', { text: e }))),
        errors.length > 50 && h('p', { class: 'hint', text: `… e altri ${fmtNumber(errors.length - 50)} errori.` }),
      ),
      actions: [{ label: 'Chiudi', value: null, variant: 'primary' }],
    });
    return;
  }
  const summary = importSummary(data, existing);
  const mode = await openDialog({
    title: 'Importa backup',
    body: h(
      'div',
      {},
      h('p', { text: summary.text }),
      h('p', { class: 'hint', text: '"Unisci": a parità di elemento vince la versione modificata più di recente.' }),
      h('p', { class: 'hint', text: '"Sostituisci tutto": i dati attuali vengono cancellati; prima viene creato un backup da salvare.' }),
    ),
    actions: [
      { label: 'Annulla', value: null },
      { label: 'Sostituisci tutto', value: 'replace', variant: 'danger-text' },
      { label: 'Unisci', value: 'merge', variant: 'primary' },
    ],
  });
  if (!mode) return;

  let backup = null;
  if (mode === 'replace') {
    backup = await buildBackupFile();
    const r = await openDialog({
      title: 'Backup dei dati attuali',
      body: h('p', { text: `Prima di sostituire i dati salva il backup "${backup.name}". Potrai reimportarlo in qualsiasi momento.` }),
      actions: [
        { label: 'Annulla import', value: null },
        { label: 'Salva backup e sostituisci', variant: 'primary', onClick: () => deliverFile(backup).then((x) => x) },
      ],
    });
    if (!r) return;
    if (r === 'cancelled') {
      const go = await openDialog({
        title: 'Backup non salvato',
        body: h('p', { text: 'Il backup dei dati attuali non è stato salvato. Vuoi sostituire comunque?' }),
        actions: [
          { label: 'Annulla import', value: false },
          { label: 'Scarica backup', value: null, onClick: () => (downloadFile(backup), false) },
          { label: 'Sostituisci comunque', value: true, variant: 'danger' },
        ],
      });
      if (!go) return;
    }
  }

  const res = await db.importAll(data, mode);
  geocode.processQueue();
  await openDialog({
    title: 'Import completato',
    body: h(
      'div',
      {},
      h('p', { text: `Importati o aggiornati ${fmtNumber(res.places)} luoghi e ${fmtNumber(res.visits)} visite.` }),
      res.closedForReview > 0 &&
        h('p', {
          class: 'hint warn',
          text: `${fmtNumber(res.closedForReview)} ${res.closedForReview === 1 ? 'visita risultava aperta ed è stata segnata' : 'visite risultavano aperte e sono state segnate'} "Da chiudere": resta aperta solo la più recente. Indica l’orario di partenza dalla Cronologia.`,
        }),
    ),
    actions: [
      backup && { label: 'Salva di nuovo il backup precedente', value: null, onClick: () => (deliverFile(backup), false) },
      { label: 'OK', value: null, variant: 'primary' },
    ].filter(Boolean),
  });
  toast('Import completato');
}

export default {
  id: 'impostazioni',
  title: 'Impostazioni',
  mount(el) {
    const storageInfo = h('div', { class: 'storage-info' });
    const backupInfo = h('p', { class: 'hint' });
    const email = h('input', { type: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'nome@esempio.it' });
    const mapToggle = h('input', { type: 'checkbox' });
    const notifyToggle = h('input', { type: 'checkbox' });
    const notifyInfo = h('div');
    const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });

    const themeGroup = h(
      'fieldset',
      { class: 'opts' },
      h('legend', { text: 'Tema' }),
      [
        ['auto', 'Automatico'],
        ['light', 'Chiaro'],
        ['dark', 'Scuro'],
      ].map(([value, label]) =>
        h(
          'label',
          { class: 'inline' },
          h('input', { type: 'radio', name: 'theme', value, checked: getTheme() === value, onchange: () => setTheme(value) }),
          ` ${label}`,
        ),
      ),
    );

    email.addEventListener('change', async () => {
      const v = email.value.trim();
      if (v && !email.checkValidity()) return showError('Indirizzo email non valido.');
      await db.setMeta('nominatimEmail', v);
      toast(v ? 'Email salvata' : 'Email rimossa');
    });
    mapToggle.addEventListener('change', async () => {
      await db.setMeta('mapEnabled', mapToggle.checked);
      toast(mapToggle.checked ? 'Mappa attivata' : 'Mappa disattivata');
    });
    notifyToggle.addEventListener('change', async () => {
      const on = notifyToggle.checked;
      // Il permesso si chiede subito, dentro il tap (Safari non lo concede dopo un await).
      const asked = on && notifications.permission() === 'default' ? notifications.requestPermission() : null;
      await db.setMeta('notificationsEnabled', on);
      const p = asked ? await asked : notifications.permission();
      if (!on) toast('Notifica disattivata');
      else if (p === 'granted') toast('Notifica attivata');
      else showError('Le notifiche non sono consentite: lo stato della visita resta visibile nella schermata Presenza.');
      renderNotify();
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (f) importFile(f).catch(showError);
    });

    const btn = (label, onclick, variant = 'secondary') =>
      h('button', { type: 'button', class: `btn btn-${variant}`, text: label, onclick: () => Promise.resolve(onclick()).catch(showError) });

    el.append(
      h('section', { class: 'card' }, h('h2', { class: 'section-title', text: 'Aspetto' }), themeGroup),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Notifiche' }),
        h('label', { class: 'inline' }, notifyToggle, ' Mostra la visita in corso nelle notifiche'),
        notifyInfo,
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Mappa' }),
        h('label', { class: 'inline' }, mapToggle, ' Mostra la mappa (Leaflet, tile OpenStreetMap)'),
        h('p', { class: 'hint', text: 'Attiva di serie: mostra arrivo e partenza delle visite e permette di correggere la posizione dei luoghi trascinando il segnaposto. Se la spegni, nella visita resta il pulsante «Mostra sulla mappa» e non viene scaricato nulla finché non lo tocchi. Nessuna chiave API: usa le tile di OpenStreetMap.' }),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Indirizzi (Nominatim)' }),
        field('Email di contatto per Nominatim (facoltativa)', email, 'Inviata a OpenStreetMap con le richieste di indirizzo, come chiede la loro policy d’uso. Non viene usata per altro.'),
        btn('Cerca indirizzi in attesa', async () => {
          if (!navigator.onLine) throw new Error('Sei offline: gli indirizzi verranno cercati al ritorno della rete.');
          await geocode.processQueue();
          toast('Ricerca indirizzi completata');
        }),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Archiviazione' }),
        storageInfo,
        btn('Richiedi archiviazione persistente', async () => {
          const ok = await requestPersistence();
          toast(ok ? 'Archiviazione persistente attiva' : 'Il browser non ha concesso l’archiviazione persistente');
          renderStorage();
        }),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Backup' }),
        backupInfo,
        h(
          'div',
          { class: 'button-row' },
          btn('Esporta backup (JSON)', exportJson, 'primary'),
          btn('Esporta visite (CSV)', exportCsv),
          btn('Importa backup (JSON)', () => fileInput.click()),
        ),
        fileInput,
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', { class: 'section-title', text: 'Altro' }),
        h(
          'div',
          { class: 'button-row' },
          btn('Rivedi l’introduzione', () => showOnboarding()),
          h('a', { class: 'btn btn-secondary', href: '#info', text: 'Informazioni' }),
          btn('Cerca aggiornamenti', async () => {
            const reg = await navigator.serviceWorker?.getRegistration();
            if (!reg) throw new Error('Service worker non attivo.');
            await reg.update();
            if (!reg.waiting && !reg.installing) toast('Stai usando la versione più recente');
          }),
        ),
        h('p', { class: 'hint', text: `Versione ${APP_VERSION}` }),
      ),
    );

    async function renderStorage() {
      const s = await storageStatus();
      setChildren(storageInfo, 
        h('p', { text: `Archiviazione persistente: ${s.persisted == null ? 'non supportata' : s.persisted ? 'attiva' : 'non attiva'}` }),
        h('p', { text: `Spazio usato: ${fmtBytes(s.usage)}${s.quota ? ` su ${fmtBytes(s.quota)} disponibili` : ''}` }),
        s.persisted === false && h('p', { class: 'hint', text: 'Senza archiviazione persistente il browser può cancellare i dati se manca spazio. Installare l’app di solito la attiva.' }),
      );
    }

    function renderNotify() {
      const p = notifications.permission();
      notifyToggle.disabled = p === 'unsupported';
      const text = {
        unsupported: 'Questo browser non supporta le notifiche. Su iPhone e iPad servono iOS 16.4 o successivo e l’app installata sulla schermata Home.',
        denied: 'Le notifiche sono bloccate per questo sito: puoi consentirle dalle impostazioni del browser o del telefono.',
        default: 'Il permesso verrà chiesto quando attivi l’opzione.',
        granted: '',
      }[p];
      setChildren(notifyInfo, 
        h('p', { class: 'hint', text: '«Sei in: luogo dalle ora», con il pulsante Check-out (che chiede comunque conferma). Notifica solo locale: nessun server, nessuna lettura della posizione in background.' }),
        text && h('p', { class: p === 'default' ? 'hint' : 'hint warn', text }),
      );
    }

    async function render() {
      notifyToggle.checked = notifications.permission() !== 'unsupported' && (await notifications.isEnabled());
      renderNotify();
      email.value = await db.getMeta('nominatimEmail', '');
      mapToggle.checked = Boolean(await db.getMeta('mapEnabled', true));
      const last = await db.getMeta('lastBackupAt', null);
      backupInfo.textContent = last ? `Ultimo backup: ${fmtDateTime(last)}` : 'Nessun backup esportato finora.';
      await renderStorage();
    }

    render().catch(showError);
    return { update: () => render().catch(showError) };
  },
};
