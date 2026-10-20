// Tema chiaro/scuro/automatico. Preferenza non critica: localStorage.

const KEY = 'registro-presenze-theme';
const COLORS = { light: '#ffffff', dark: '#000000' };

export function getTheme() {
  try {
    return localStorage.getItem(KEY) || 'auto';
  } catch {
    return 'auto';
  }
}

const media = matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme = getTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  const effective = theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = COLORS[effective];
  document.head.append(meta);
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* preferenza non salvata */
  }
  applyTheme(theme);
}

media.addEventListener?.('change', () => getTheme() === 'auto' && applyTheme('auto'));
