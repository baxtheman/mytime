// Mappa opzionale (Leaflet + tile OpenStreetMap), caricata solo se attivata nelle Impostazioni.

import { LEAFLET } from '../config.js';
import * as db from '../db.js';
import { h } from './dom.js';

let leafletPromise = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = h('link', { rel: 'stylesheet', href: LEAFLET.css, integrity: LEAFLET.cssIntegrity, crossorigin: '' });
    const js = h('script', { src: LEAFLET.js, integrity: LEAFLET.jsIntegrity, crossorigin: '' });
    js.onload = () => resolve(window.L);
    js.onerror = () => {
      leafletPromise = null;
      css.remove();
      js.remove();
      reject(new Error('Leaflet non disponibile'));
    };
    document.head.append(css, js);
  });
  return leafletPromise;
}

export async function isMapEnabled() {
  return Boolean(await db.getMeta('mapEnabled', true));
}

export function attribution() {
  return h(
    'p',
    { class: 'attribution' },
    'Indirizzi e mappe © ',
    h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'contributori OpenStreetMap' }),
    ' · ',
    h('a', { href: 'https://opendatacommons.org/licenses/odbl/', target: '_blank', rel: 'noopener', text: 'licenza ODbL' }),
  );
}

/** Layer delle tile OSM (nessuna chiave API); mostra "offline" dopo 2 errori consecutivi. */
function osmTiles(L, showOffline) {
  let tileErrors = 0;
  const tiles = L.tileLayer(LEAFLET.tiles, {
    maxZoom: 19,
    crossOrigin: 'anonymous',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  tiles.on('tileerror', () => {
    if (++tileErrors >= 2) showOffline(true);
  });
  tiles.on('tileload', () => {
    tileErrors = 0;
    showOffline(false);
  });
  return tiles;
}

/** Link alla posizione su openstreetmap.org (si apre fuori dall'app, senza chiave API). */
export function osmUrl(lat, lon, zoom = 18) {
  const la = (+lat).toFixed(6);
  const lo = (+lon).toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=${zoom}/${la}/${lo}`;
}

/**
 * Crea una mappa con segnaposto e cerchio del raggio.
 * @returns {{ el: HTMLElement, setPosition(lat, lon), setRadius(m), setColor(c), destroy() }}
 */
export function createMap({ lat, lon, radius, color = '#1d4ed8', draggable = false, onMove } = {}) {
  const canvas = h('div', { class: 'map-canvas', role: 'region', 'aria-label': 'Mappa del luogo' });
  const offline = h('div', { class: 'map-offline', hidden: true, text: 'Mappa non disponibile offline' });
  const el = h('div', { class: 'map' }, canvas, offline, attribution(), draggable && h('p', { class: 'hint', text: 'Trascina il segnaposto per correggere la posizione.' }));
  let map;
  let marker;
  let circle;
  let destroyed = false;
  const showOffline = (v) => {
    offline.hidden = !v;
  };
  const markerIcon = (c) =>
    window.L.divIcon({
      className: 'map-pin',
      html: `<span style="background:${/^#[0-9a-f]{3,8}$/i.test(c) ? c : '#1d4ed8'}"></span>`,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });

  if (!navigator.onLine) showOffline(true);
  loadLeaflet()
    .then((L) => {
      if (destroyed) return;
      map = L.map(canvas, { zoomControl: true, attributionControl: true }).setView([lat ?? 41.9, lon ?? 12.5], lat != null ? 17 : 5);
      map.attributionControl.setPrefix(false);
      osmTiles(L, showOffline).addTo(map);
      if (lat != null) {
        marker = L.marker([lat, lon], { draggable, icon: markerIcon(color), keyboard: true, title: 'Posizione del luogo' }).addTo(map);
        circle = L.circle([lat, lon], { radius: radius || 150, color, weight: 2, fillOpacity: 0.12 }).addTo(map);
        marker.on('drag', (e) => circle.setLatLng(e.target.getLatLng()));
        marker.on('dragend', (e) => {
          const p = e.target.getLatLng();
          onMove?.(p.lat, p.lng);
        });
      }
      // Il contenitore può essere appena entrato in un <dialog>: ricalcola le dimensioni.
      setTimeout(() => map?.invalidateSize(), 50);
    })
    .catch(() => showOffline(true));

  return {
    el,
    setPosition(la, lo) {
      if (!map) return;
      if (!marker) {
        marker = window.L.marker([la, lo], { draggable, icon: markerIcon(color) }).addTo(map);
        circle = window.L.circle([la, lo], { radius: radius || 150, color, weight: 2, fillOpacity: 0.12 }).addTo(map);
        marker.on('drag', (e) => circle.setLatLng(e.target.getLatLng()));
        marker.on('dragend', (e) => onMove?.(e.target.getLatLng().lat, e.target.getLatLng().lng));
      } else {
        marker.setLatLng([la, lo]);
        circle.setLatLng([la, lo]);
      }
      map.setView([la, lo], 17);
    },
    setRadius(m) {
      radius = m;
      circle?.setRadius(m);
    },
    setColor(c) {
      color = c;
      marker?.setIcon(markerIcon(c));
      circle?.setStyle({ color: c });
    },
    destroy() {
      destroyed = true;
      map?.remove();
    },
  };
}

/**
 * Mappa in sola lettura con i punti GPS di una visita (arrivo, partenza) e il raggio del luogo.
 * @param {{ points: {lat:number, lon:number, accuracy?:number, letter:string, label:string, kind:'arrival'|'departure'}[],
 *           place?: {lat:number, lon:number, radius?:number, color?:string} }} opts
 * @returns {{ el: HTMLElement, destroy() }}
 */
export function createPointsMap({ points, place } = {}) {
  const canvas = h('div', { class: 'map-canvas', role: 'region', 'aria-label': 'Mappa delle posizioni della visita' });
  const offline = h('div', { class: 'map-offline', hidden: true, text: 'Mappa non disponibile offline' });
  const el = h('div', { class: 'map' }, canvas, offline, attribution());
  let map;
  let destroyed = false;
  const showOffline = (v) => {
    offline.hidden = !v;
  };

  if (!navigator.onLine) showOffline(true);
  loadLeaflet()
    .then((L) => {
      if (destroyed) return;
      map = L.map(canvas, { zoomControl: true, attributionControl: true });
      map.attributionControl.setPrefix(false);
      osmTiles(L, showOffline).addTo(map);
      let bounds = null;
      const extend = (b) => (bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast()));
      const placeColor = /^#[0-9a-f]{3,8}$/i.test(place?.color || '') ? place.color : '#546e7a';
      if (place?.lat != null) {
        const radius = place.radius || 150;
        L.circle([place.lat, place.lon], { radius, color: placeColor, weight: 2, fillOpacity: 0.1, interactive: false }).addTo(map);
        extend(L.latLng(place.lat, place.lon).toBounds(radius * 2));
      }
      for (const p of points) {
        // Lettera fissa (A/P) inserita come testo: nessun dato utente nell'HTML del segnaposto.
        const icon = L.divIcon({
          className: `map-pin map-pin-${p.kind}`,
          html: `<span><b>${p.letter === 'P' ? 'P' : 'A'}</b></span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        if (p.accuracy) {
          L.circle([p.lat, p.lon], { radius: p.accuracy, className: `map-acc map-acc-${p.kind}`, weight: 1, dashArray: '4 4', fillOpacity: 0.08, interactive: false }).addTo(map);
        }
        L.marker([p.lat, p.lon], { icon, keyboard: true, title: p.label, alt: p.label }).addTo(map);
        extend(L.latLng(p.lat, p.lon).toBounds(Math.max(p.accuracy || 0, 10) * 2));
      }
      const fit = () => (bounds ? map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18 }) : map.setView([41.9, 12.5], 5));
      fit();
      setTimeout(() => {
        if (!map) return;
        map.invalidateSize();
        fit();
      }, 50);
    })
    .catch(() => showOffline(true));

  return {
    el,
    destroy() {
      destroyed = true;
      map?.remove();
      map = null;
    },
  };
}
