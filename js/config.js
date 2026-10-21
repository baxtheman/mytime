// Costanti condivise. A ogni rilascio aggiornare APP_VERSION e CACHE_VERSION in sw.js.
export const APP_NAME = '📍 ndóve?';
// Nome breve senza emoji (nomi file, etichetta della schermata Home).
export const APP_SHORT_NAME = 'ndóve?';
export const FILE_PREFIX = 'ndove';
export const APP_VERSION = '1.0.6';

// Crediti (pagina Informazioni).
export const AUTHOR = { name: 'Daniele Baggio', url: 'https://github.com/baxtheman' };
export const REPO_URL = 'https://github.com/baxtheman/mytime';

// Identificatori interni (database, canale, formato backup): NON cambiarli, servono per i dati esistenti.
export const DB_NAME = 'registro-presenze';
export const DB_VERSION = 1;
export const CHANNEL_NAME = 'registro-presenze';
export const EXPORT_FORMAT = 'registro-presenze';
export const EXPORT_SCHEMA_VERSION = 1;
export const SUPPORTED_SCHEMA_VERSIONS = [1];

export const GPS_ACCURACY_LIMIT_M = 100;
export const DEFAULT_RADIUS_M = 150;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 1000;
export const PLACE_NAME_MAX = 80;
export const NOTE_MAX = 1000;

export const FORGOTTEN_CHECKOUT_MS = 12 * 3600e3;
export const BACKUP_REMINDER_DAYS = 30;
export const INSTALL_HINT_SNOOZE_DAYS = 30;
export const UNDO_MS = 8000;
export const PAGE_SIZE = 50;

export const LEAFLET = {
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  cssIntegrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  jsIntegrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};

export const PALETTE = [
  { value: '#1e88e5', label: 'Blu' },
  { value: '#43a047', label: 'Verde' },
  { value: '#e53935', label: 'Rosso' },
  { value: '#fb8c00', label: 'Arancione' },
  { value: '#8e24aa', label: 'Viola' },
  { value: '#00897b', label: 'Verde acqua' },
  { value: '#6d4c41', label: 'Marrone' },
  { value: '#546e7a', label: 'Grigio' },
];

export const FLAG_LABELS = {
  edited: 'Modificata',
  manualDeparture: 'Chiusa manualmente',
  outOfRange: 'Fuori raggio',
  lowAccuracy: 'Posizione imprecisa',
  needsClose: 'Da chiudere',
};
