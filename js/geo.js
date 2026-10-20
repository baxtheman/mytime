// GPS (solo su richiesta esplicita dell'utente), distanze e rilevamento piattaforma.

export const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };

export class GeoError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'GeoError';
    this.code = code; // denied | unavailable | timeout | insecure | unsupported | aborted
  }
}

/**
 * Una sola lettura GPS (mai watchPosition). Va chiamata all'interno del gesto dell'utente.
 * @returns {Promise<{lat:number, lon:number, accuracy:number, at:string}>}
 */
export function getPosition(signal) {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new GeoError('insecure'));
    if (!('geolocation' in navigator)) return reject(new GeoError('unsupported'));
    if (signal?.aborted) return reject(new GeoError('aborted'));
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(new GeoError('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve({
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
          at: new Date().toISOString(),
        });
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        const code = { 1: 'denied', 2: 'unavailable', 3: 'timeout' }[err.code] || 'unavailable';
        reject(new GeoError(code, err.message));
      },
      GEO_OPTIONS,
    );
  });
}

/** Distanza in metri (formula dell'emisenoverso). */
export function distance(a, b) {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Luoghi ordinati per distanza, con il più vicino entro il proprio raggio come proposta. */
export function rankPlaces(pos, places) {
  const ranked = places
    .map((place) => {
      const d = distance(pos, place);
      return { place, distance: d, inRange: d <= place.radius };
    })
    .sort((x, y) => x.distance - y.distance);
  return { ranked, proposed: ranked.find((r) => r.inRange) || null };
}

// ---------------------------------------------------------------------------
// Piattaforma

const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/i.test(ua);

export function isStandalone() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

export function geoErrorMessage(code) {
  switch (code) {
    case 'denied':
      if (isIOS)
        return {
          title: 'Permesso di posizione negato',
          text:
            'Apri Impostazioni › Privacy › Localizzazione (su iOS recenti "Privacy e sicurezza") e verifica che Localizzazione sia attiva. ' +
            'Poi apri Siti Safari, scegli "Chiedi" o "Mentre usi l\'app" e attiva "Posizione esatta": senza, iOS fornisce una posizione approssimata di alcuni chilometri e il check-in risulta impreciso. ' +
            "Se usi l'app dalla schermata Home, iOS può chiedere di nuovo il permesso a ogni avvio: tocca Consenti.",
        };
      if (isAndroid)
        return {
          title: 'Permesso di posizione negato',
          text:
            "In Chrome tocca l'icona a sinistra dell'indirizzo › Autorizzazioni › Posizione › Consenti. " +
            "Se usi l'app installata: tieni premuta l'icona › Informazioni app › Autorizzazioni › Posizione › Consenti. " +
            'Verifica anche che la geolocalizzazione di Android sia attiva e che "Usa posizione precisa" sia abilitato.',
        };
      return {
        title: 'Permesso di posizione negato',
        text: "Fai clic sull'icona a sinistra dell'indirizzo, consenti l'accesso alla posizione e riprova.",
      };
    case 'unavailable':
      return {
        title: 'Posizione non disponibile',
        text: 'Verifica che la localizzazione del dispositivo sia attiva. Se sei al chiuso, avvicinati a una finestra e riprova.',
      };
    case 'timeout':
      return {
        title: 'Il GPS non ha risposto',
        text: 'Nessuna posizione entro 20 secondi. Spostati all’aperto o vicino a una finestra e riprova.',
      };
    case 'insecure':
      return {
        title: 'Connessione non sicura',
        text: "La posizione è disponibile solo su HTTPS. Apri l'app da un indirizzo https:// (o da localhost sul computer).",
      };
    case 'unsupported':
      return { title: 'GPS non supportato', text: 'Questo browser non permette di leggere la posizione. Usa Chrome o Safari aggiornati.' };
    default:
      return { title: 'Posizione non disponibile', text: 'Errore imprevisto durante la lettura della posizione. Riprova.' };
  }
}
