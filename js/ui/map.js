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
  return Boolean(await db.getMeta('mapEnabled', false));
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
  let tileErrors = 0;
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
      tiles.addTo(map);
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
