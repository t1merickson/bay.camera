/**
 * Map bootstrap: MapLibre with a Carto raster basemap (free, no key),
 * dark/light from prefers-color-scheme. Region colors live here (mirrored
 * as --r-* tokens in main.css — keep both in sync).
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export const dark = matchMedia('(prefers-color-scheme: dark)').matches;

// Quieter than the original 8-color set: same hues, less saturation, so a
// full map reads as information, not confetti.
export const REGION_COLORS: Record<string, string> = {
  'satellite': 'hsl(215,14%,54%)', 'golden-gate': 'hsl(12,58%,54%)', 'san-francisco': 'hsl(217,62%,56%)',
  'north-bay': 'hsl(142,42%,42%)', 'east-bay': 'hsl(262,46%,62%)', 'peninsula': 'hsl(189,55%,42%)',
  'south-bay': 'hsl(32,62%,50%)', 'santa-cruz': 'hsl(330,48%,56%)',
};

export const regionMatchExpr = (): any => {
  const e: any[] = ['match', ['get', 'region']];
  for (const [k, v] of Object.entries(REGION_COLORS)) e.push(k, v);
  e.push('#888');
  return e as any;
};

const carto = (s: string) => ['a', 'b', 'c'].map((h) => `https://${h}.basemaps.cartocdn.com/${s}/{z}/{x}/{y}.png`);

export const BAY_BOUNDS: [[number, number], [number, number]] = [[-123.15, 36.9], [-121.5, 38.35]];

export function createMap(): maplibregl.Map {
  const map = new maplibregl.Map({
    container: 'map', attributionControl: false, minZoom: 5, maxZoom: 16,
    center: [-122.3, 37.75], zoom: 8,
    style: {
      version: 8,
      // NOT fonts.openmaptiles.org — it 200s an HTML page, MapLibre chokes
      // parsing it as PBF ("Unimplemented type: 4") and the failure kills
      // every vector layer, not just labels.
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      // Label-less base + labels-only overlay, so raster weather layers
      // (GOES) can slide between terrain and place names.
      sources: {
        base: { type: 'raster', tileSize: 256, attribution: '© OpenStreetMap © CARTO', tiles: carto(dark ? 'dark_nolabels' : 'light_nolabels') },
        labels: { type: 'raster', tileSize: 256, tiles: carto(dark ? 'dark_only_labels' : 'light_only_labels') },
      },
      layers: [
        { id: 'base', type: 'raster', source: 'base' },
        { id: 'labels', type: 'raster', source: 'labels' },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  return map;
}
