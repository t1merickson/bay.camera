/**
 * Map bootstrap: MapLibre with an OpenFreeMap vector basemap (free, no key,
 * no signup), dark/light from prefers-color-scheme. Region colors live here
 * (mirrored as --r-* tokens in main.css — keep both in sync).
 *
 * Why not Carto: they started stamping "API KEY REQUIRED" diagonally across
 * every free raster tile, and their remaining free access is a 14-day trial.
 * OpenFreeMap serves the same Positron/Dark-Matter look from OpenMapTiles
 * data with no key at all.
 *
 * Their glyph endpoint was checked before switching — it returns real
 * application/x-protobuf, NOT the HTML page that fonts.openmaptiles.org
 * serves. That trap silently kills every vector layer and cost this project
 * two sessions; re-verify it with curl before ever changing this URL.
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

// positron / dark are OpenFreeMap's Carto-lookalike styles. Each is a complete
// style document (vector source + glyphs + sprite), so we hand MapLibre the URL
// instead of hand-rolling a style object.
const OFM_STYLE = (isDark: boolean) =>
  `https://tiles.openfreemap.org/styles/${isDark ? 'dark' : 'positron'}`;

// Sources this app adds on top of the basemap. Layers belonging to them are
// not part of the basemap stack and must be ignored when locating its seam.
const APP_SOURCES = new Set(['cams', 'peaks', 'goes']);

/**
 * Layer id to insert raster weather layers before, so satellite imagery covers
 * terrain but place names still float on top.
 *
 * Two traps, both hit for real:
 *
 * 1. NOT simply "the first symbol layer". In OpenFreeMap's dark style the first
 *    symbol layer sits at index 8 with every road, building and boundary drawn
 *    AFTER it, so inserting there puts roads on top of the clouds.
 * 2. The scan must skip OUR layers. cam-point, peak-point and the clusters are
 *    circle layers appended above the basemap, so a naive "last non-symbol
 *    layer" walks past the labels, returns undefined, and GOES gets appended
 *    on top of the entire map — burying every place name. That is why this
 *    filters by source rather than by type alone.
 *
 * Add a new source to the app and it belongs in APP_SOURCES above.
 */
export function firstLabelLayerId(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  let lastBasemapGeometry = -1;
  for (let i = 0; i < layers.length; i++) {
    const source = (layers[i] as { source?: string }).source;
    // A layer with no source is the style's background — basemap by definition.
    if (source !== undefined && APP_SOURCES.has(source)) continue;
    if (layers[i].type !== 'symbol') lastBasemapGeometry = i;
  }
  return layers[lastBasemapGeometry + 1]?.id;
}

export const BAY_BOUNDS: [[number, number], [number, number]] = [[-123.15, 36.9], [-121.5, 38.35]];

export function createMap(): maplibregl.Map {
  const map = new maplibregl.Map({
    container: 'map', attributionControl: false, minZoom: 5, maxZoom: 16,
    center: [-122.3, 37.75], zoom: 8,
    style: OFM_STYLE(dark),
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  // No customAttribution needed: OpenFreeMap's TileJSON at /planet already
  // carries OpenFreeMap + OpenMapTiles + OpenStreetMap credit, and MapLibre
  // surfaces it automatically. Adding our own printed OSM twice.
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  return map;
}
