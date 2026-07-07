/**
 * The fog story, in two parts:
 *
 * 1. GOES-18 satellite imagery as a web-mercator raster layer sandwiched
 *    between the basemap and its labels. Daytime NASA GIBS Band 2 is rendered
 *    through a transparent fog ramp; after dark, SSEC RealEarth night
 *    microphysics keeps low stratus readable. ~10-min cadence.
 *
 * 2. Fog-top altitude: sample the ALERTCalifornia peak cams across their
 *    elevation range, classify each frame in-cloud vs clear (fogtop.ts), and
 *    the elevation boundary between them is the marine-layer top.
 */
import type maplibregl from 'maplibre-gl';
import { addProtocol, type RequestParameters } from 'maplibre-gl';
import { peaks, mToFt } from './data';
import { getAlertCamUrls } from './alertca';
import { analyzePeaks, estimateFogTop, type PeakInput, type PeakReading, type FogTopEstimate } from './fogtop';
import { updatePeakStatuses } from './peaks';

const GOES_SOURCE_ID = 'goes';
const GOES_LAYER_ID = 'goes';
const GOES_BEFORE_ID = 'labels';
// Measured on real frames: Band-2 luminance hits the tone-curve black point
// near +6°, so hand off early rather than show black frames.
const SAT_SWITCH_ELEV_DEG = 7;
const CAM_NIGHT_ELEV_DEG = -3;
const BAY_SOLAR_REF = { lat: 37.77, lon: -122.42 };
const DAY_MS = 24 * 60 * 60 * 1000;
const REALEARTH_NIGHT_PRODUCT = 'G18-ABI-CONUS-night-microphysics';
const REALEARTH_LATEST_URL = `https://realearth.ssec.wisc.edu/api/latest?products=${REALEARTH_NIGHT_PRODUCT}`;
const NASA_GIBS_ATTRIBUTION = 'GOES-18 · NASA GIBS';
const SSEC_REALEARTH_ATTRIBUTION = 'GOES-18 · SSEC RealEarth';
const FOGTONE_PROTOCOL = 'fogtone';
const FOGTONE_PREFIX = `${FOGTONE_PROTOCOL}://`;
// Tone curve constants calibrated on real GOES-18 fog frames.
// Black point 70 (was 30, microclimates.today's tune for a black background):
// on our map-first design the higher cut keeps bright daytime land reflectance
// (~60-140) from graying out clear inland areas, while the marine layer
// (~150-230) stays solid. Trade-off: the very thinnest wisps drop out.
const FOG_TONE_BLACK = 70;
const FOG_TONE_WHITE = 185;
const FOG_TONE_GAMMA = 1.1;
const FOG_TONE_MAX_ALPHA = 236; // About 0.925 * 255, keeping solid fog just under opaque.

type SatMode = 'day' | 'night';
type SatSourceKind = 'gibs-day' | 'realearth-night' | 'gibs-night-fallback';
type SatTileSpec = {
  mode: SatMode;
  kind: SatSourceKind;
  url: string;
  maxzoom: number;
  attribution: string;
};

const SAT_TILES = {
  day: {
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_Band2_Red_Visible_1km/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
    maxzoom: 7,
  },
  nightFallback: {
    // In Band 13 IR, Bay fog/low stratus reads as brighter mid-gray than clear sky.
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    maxzoom: 6,
  },
} as const;

const RASTER_OPACITY = ['interpolate', ['linear'], ['zoom'], 8, 0.88, 10, 0.8, 12, 0.55] as const;

const bucket = () => Math.floor(Date.now() / (10 * 60 * 1000)); // 10-min cache-buster
const cacheBusted = (url: string) => `${url}?cb=${bucket()}`;
const fogtoneUrl = (url: string) => `${FOGTONE_PREFIX}${url}`;

function buildFogToneAlphaLookup(): Uint8ClampedArray {
  const lookup = new Uint8ClampedArray(256);
  for (let lum = 0; lum < lookup.length; lum++) {
    const linear = Math.min(Math.max((lum - FOG_TONE_BLACK) / (FOG_TONE_WHITE - FOG_TONE_BLACK), 0), 1);
    lookup[lum] = Math.round(Math.pow(linear, 1 / FOG_TONE_GAMMA) * FOG_TONE_MAX_ALPHA);
  }
  return lookup;
}

const FOG_TONE_ALPHA_LOOKUP = buildFogToneAlphaLookup();

function realUrlFromFogToneUrl(url: string): string {
  return url.startsWith(FOGTONE_PREFIX) ? url.slice(FOGTONE_PREFIX.length) : url;
}

async function loadFogToneTile(params: RequestParameters, abortController: AbortController): Promise<{ data: ArrayBuffer }> {
  const realUrl = realUrlFromFogToneUrl(params.url);
  const response = await fetch(realUrl, { signal: abortController.signal });
  if (!response.ok) throw new Error(`Fog tone tile fetch failed: ${response.status}`);

  const originalBlob = await response.blob();
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(originalBlob);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Fog tone canvas context unavailable');

    ctx.drawImage(bitmap, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    const pixels = image.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const lum = Math.round(0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]);
      const alpha = FOG_TONE_ALPHA_LOOKUP[lum];
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = Math.min(alpha, pixels[i + 3]);
    }
    ctx.putImageData(image, 0, 0);
    const toneBlob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: await toneBlob.arrayBuffer() };
  } catch {
    return { data: await originalBlob.arrayBuffer() };
  } finally {
    bitmap?.close();
  }
}

addProtocol(FOGTONE_PROTOCOL, loadFogToneTile);

// URL debug override for visual verification: `?fog=day` or `?fog=night`
// forces satellite imagery only; peak-camera analysis keeps its own dusk gate.
function readSatModeOverride(): SatMode | null {
  if (typeof window === 'undefined') return null;
  const fog = new URLSearchParams(window.location.search).get('fog');
  return fog === 'day' || fog === 'night' ? fog : null;
}

const SAT_MODE_OVERRIDE = readSatModeOverride();

function dayOfYearUtc(date: Date): number {
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  return Math.floor((day - yearStart) / DAY_MS);
}

/**
 * Solar elevation for the fixed Bay Area reference point, using NOAA's
 * fractional-year declination/equation-of-time approximation.
 * Source: NOAA Solar Calculation Details.
 */
export function solarElevationDeg(date = new Date()): number {
  const doy = dayOfYearUtc(date);
  const utcHour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000;
  const gamma = (2 * Math.PI / 365) * (doy - 1 + (utcHour - 12) / 24);
  const eqTime = 229.18 * (
    0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) -
    0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)
  );
  const decl = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const trueSolarMinutes = (utcHour * 60 + eqTime + 4 * BAY_SOLAR_REF.lon + 1440) % 1440;
  const hourAngle = (trueSolarMinutes / 4 - 180) * Math.PI / 180;
  const lat = BAY_SOLAR_REF.lat * Math.PI / 180;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle));
  return elevation * 180 / Math.PI;
}

export function satModeForDate(date = new Date()): SatMode {
  if (SAT_MODE_OVERRIDE) return SAT_MODE_OVERRIDE;
  return solarElevationDeg(date) < SAT_SWITCH_ELEV_DEG ? 'night' : 'day';
}

export function camerasAreDark(date = new Date()): boolean {
  return solarElevationDeg(date) < CAM_NIGHT_ELEV_DEG;
}

let activeSatMode: SatMode | null = null;
let activeSatKind: SatSourceKind | null = null;
let activeSatUrl: string | null = null;
let lastNightMicrophysicsTimestamp: string | null = null;
let refreshSeq = 0;

function dayTileSpec(): SatTileSpec {
  return {
    mode: 'day',
    kind: 'gibs-day',
    url: fogtoneUrl(cacheBusted(SAT_TILES.day.url)),
    maxzoom: SAT_TILES.day.maxzoom,
    attribution: NASA_GIBS_ATTRIBUTION,
  };
}

function nightFallbackTileSpec(): SatTileSpec {
  return {
    mode: 'night',
    kind: 'gibs-night-fallback',
    url: cacheBusted(SAT_TILES.nightFallback.url),
    maxzoom: SAT_TILES.nightFallback.maxzoom,
    attribution: NASA_GIBS_ATTRIBUTION,
  };
}

function realEarthNightTileSpec(timestamp: string): SatTileSpec {
  const tileTimestamp = timestamp.replace('.', '_');
  return {
    mode: 'night',
    kind: 'realearth-night',
    url: `https://realearth.ssec.wisc.edu/tiles/${REALEARTH_NIGHT_PRODUCT}_${tileTimestamp}/{z}/{x}/{y}.png`,
    maxzoom: 7,
    attribution: SSEC_REALEARTH_ATTRIBUTION,
  };
}

async function fetchLatestNightTimestamp(): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(REALEARTH_LATEST_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`RealEarth latest failed: ${response.status}`);
    const latest = await response.json() as Partial<Record<typeof REALEARTH_NIGHT_PRODUCT, unknown>>;
    const timestamp = latest[REALEARTH_NIGHT_PRODUCT];
    if (typeof timestamp !== 'string' || !/^\d{8}\.\d{6}$/.test(timestamp)) {
      throw new Error('RealEarth latest returned an invalid timestamp');
    }
    return timestamp;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function nightTileSpec(): Promise<SatTileSpec> {
  try {
    const timestamp = await fetchLatestNightTimestamp();
    if (timestamp === lastNightMicrophysicsTimestamp && lastNightMicrophysicsTimestamp) {
      return realEarthNightTileSpec(lastNightMicrophysicsTimestamp);
    }
    lastNightMicrophysicsTimestamp = timestamp;
    return realEarthNightTileSpec(timestamp);
  } catch {
    return nightFallbackTileSpec();
  }
}

function currentGoesVisibility(map: maplibregl.Map): 'visible' | 'none' {
  return map.getLayer(GOES_LAYER_ID) && map.getLayoutProperty(GOES_LAYER_ID, 'visibility') === 'visible' ? 'visible' : 'none';
}

function rasterPaint(): maplibregl.RasterLayerSpecification['paint'] {
  return {
    // Fade back as you overzoom past the sensor resolution so streets stay
    // readable under the (increasingly blurry) cloud field.
    'raster-opacity': RASTER_OPACITY as any,
    'raster-fade-duration': 300,
  };
}

function addLayerBeforeLabels(map: maplibregl.Map, layer: maplibregl.RasterLayerSpecification): boolean {
  try {
    if (map.getLayer(GOES_BEFORE_ID)) map.addLayer(layer, GOES_BEFORE_ID);
    else map.addLayer(layer);
  } catch {
    return false;
  }
  return Boolean(map.getLayer(GOES_LAYER_ID));
}

function addGoesSourceAndLayer(map: maplibregl.Map, spec: SatTileSpec, visibility: 'visible' | 'none') {
  map.addSource(GOES_SOURCE_ID, { type: 'raster', tileSize: 256, maxzoom: spec.maxzoom,
    attribution: spec.attribution,
    tiles: [spec.url] });
  const layer: maplibregl.RasterLayerSpecification = {
    id: GOES_LAYER_ID, type: 'raster', source: GOES_SOURCE_ID,
    layout: { visibility },
    paint: rasterPaint(),
  };
  const added = addLayerBeforeLabels(map, layer);
  if (!added) throw new Error('Unable to add GOES raster layer');
  activeSatMode = spec.mode;
  activeSatKind = spec.kind;
  activeSatUrl = spec.url;
}

function applyGoesTileSpec(map: maplibregl.Map, spec: SatTileSpec, visibility: 'visible' | 'none') {
  const sourceMissing = !map.getSource(GOES_SOURCE_ID);
  const layerMissing = !map.getLayer(GOES_LAYER_ID);
  const recreate = sourceMissing || layerMissing || activeSatMode !== spec.mode || activeSatKind !== spec.kind;
  if (recreate) {
    if (map.getLayer(GOES_LAYER_ID)) map.removeLayer(GOES_LAYER_ID);
    if (map.getSource(GOES_SOURCE_ID)) map.removeSource(GOES_SOURCE_ID);
    addGoesSourceAndLayer(map, spec, visibility);
    return;
  }
  if (activeSatUrl !== spec.url) {
    (map.getSource(GOES_SOURCE_ID) as maplibregl.RasterTileSource).setTiles([spec.url]);
    activeSatUrl = spec.url;
  }
  map.setLayoutProperty(GOES_LAYER_ID, 'visibility', visibility);
}

async function refreshGoesTiles(map: maplibregl.Map, visibility?: 'visible' | 'none') {
  const seq = ++refreshSeq;
  const mode = satModeForDate();
  const desiredVisibility = visibility ?? currentGoesVisibility(map);
  if (mode === 'day') {
    applyGoesTileSpec(map, dayTileSpec(), desiredVisibility);
    return;
  }
  if (activeSatMode !== 'night' || !map.getLayer(GOES_LAYER_ID) || !map.getSource(GOES_SOURCE_ID)) {
    applyGoesTileSpec(map, nightFallbackTileSpec(), desiredVisibility);
  } else if (visibility) {
    map.setLayoutProperty(GOES_LAYER_ID, 'visibility', visibility);
  }
  const spec = await nightTileSpec();
  if (seq !== refreshSeq || satModeForDate() !== 'night') return;
  applyGoesTileSpec(map, spec, desiredVisibility);
}

export function addGoesLayer(map: maplibregl.Map) {
  const mode = satModeForDate();
  addGoesSourceAndLayer(map, mode === 'day' ? dayTileSpec() : nightFallbackTileSpec(), 'none');
  if (mode === 'night') void refreshGoesTiles(map).catch(() => undefined);
  // While visible, re-point tiles at the newest granule every 10 min.
  window.setInterval(() => {
    if (document.hidden || map.getLayoutProperty(GOES_LAYER_ID, 'visibility') !== 'visible') return;
    void refreshGoesTiles(map, 'visible').catch(() => undefined);
  }, 10 * 60 * 1000);
}

export function setGoesVisible(map: maplibregl.Map, on: boolean) {
  if (!map.getLayer(GOES_LAYER_ID)) return;
  if (on) {
    void refreshGoesTiles(map, 'visible').catch(() => undefined);
    return;
  }
  refreshSeq++;
  map.setLayoutProperty(GOES_LAYER_ID, 'visibility', 'none');
}

// ---- fog-top analysis ----

/** Evenly sample n cams across the elevation ladder (keeps extremes). */
function stratifiedSample(n: number): typeof peaks {
  const sorted = [...peaks].sort((a, b) => a.elevM - b.elevM);
  if (sorted.length <= n) return sorted;
  const out = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]);
  return [...new Set(out)];
}

let lastRun = 0;
let lastSampleSize = 0;
let lastEstimate: FogTopEstimate | null = null;
let running: Promise<void> | null = null;
const allReadings = new Map<string, PeakReading>();

const $ = (id: string) => document.getElementById(id);

function renderEstimate(est: FogTopEstimate, sampled: number, fogElevs: number[] = []) {
  const main = $('fog-main'), sub = $('fog-sub'), chip = $('fog-chip');
  if (!main || !sub) return;
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const darkCount = [...est.readings.values()].filter((r) => r.status === 'dark').length;
  if (darkCount > sampled / 2) {
    main.textContent = 'Night — cameras too dark to read';
    sub.textContent = `fog-top estimate needs daylight · ${time}`;
    if (chip) chip.hidden = true;
    return;
  }
  if (est.topM == null) {
    if (est.confidence === 'high') {
      main.textContent = 'No marine layer detected';
      sub.textContent = `${est.sampled} peaks sampled, all clear · ${time}`;
      if (chip) { chip.hidden = false; chip.innerHTML = '<b>Fog top</b> <span class="cond-d">none</span>'; }
    } else {
      main.textContent = 'Fog top indeterminate';
      sub.textContent = `${est.sampled} usable peak frames · ${time}`;
      if (chip) chip.hidden = true;
    }
    return;
  }
  const fogCount = [...est.readings.values()].filter((r) => r.status === 'fog').length;
  const topFt = mToFt(est.topM).toLocaleString();
  // A couple of isolated socked-in cams = dissipating patches, not a deck;
  // a tight two-cam "band" would overclaim precision.
  if (fogCount <= 2 && fogElevs.length) {
    const lo = mToFt(Math.min(...fogElevs)).toLocaleString();
    const hi = mToFt(Math.max(...fogElevs)).toLocaleString();
    main.innerHTML = `<strong>Patchy fog</strong> <span class="fog-conf fog-conf-low">low</span>`;
    sub.textContent = `${fogCount} of ${est.sampled} peaks in cloud (${lo === hi ? lo : `${lo}–${hi}`} ft) · ${time}`;
    if (chip) { chip.hidden = false; chip.innerHTML = '<b>Fog</b> <span class="cond-d">patchy</span>'; }
    return;
  }
  const range = est.baseM != null
    ? `${mToFt(est.baseM).toLocaleString()}–${topFt} ft`
    : `top ≈ ${topFt} ft`;
  main.innerHTML = `<strong>${range}</strong> <span class="fog-conf fog-conf-${est.confidence}">${est.confidence}</span>`;
  sub.textContent = `${fogCount} of ${est.sampled} peaks in cloud · ${time}`;
  if (chip) { chip.hidden = false; chip.innerHTML = `<b>Fog top</b> <span class="cond-t">${topFt} ft</span>`; }
}

function renderNightCameraEstimate() {
  const main = $('fog-main'), sub = $('fog-sub'), chip = $('fog-chip');
  if (!main || !sub) return;
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  main.textContent = 'Night — satellite layer shows fog; cameras need daylight';
  sub.textContent = `peak-camera estimate resumes at sunrise · ${time}`;
  if (chip) chip.hidden = true;
}

export function runFogAnalysis(map: maplibregl.Map, sampleSize: number, force = false): Promise<void> {
  if (camerasAreDark()) {
    renderNightCameraEstimate();
    return Promise.resolve();
  }
  if (running) {
    // Don't swallow a bigger request (fog toggle's full pass) while the boot
    // probe is in flight — chain it; the size guard below dedupes repeats.
    return running.then(() => runFogAnalysis(map, sampleSize, force));
  }
  // A bigger requested sample upgrades a still-fresh smaller run (the boot
  // probe is 12 cams; the Fog toggle wants the full pass).
  if (!force && sampleSize <= lastSampleSize && Date.now() - lastRun < 10 * 60 * 1000 && lastEstimate) return Promise.resolve();
  running = (async () => {
    const main = $('fog-main'), sub = $('fog-sub');
    const sample = stratifiedSample(sampleSize);
    if (main && !lastEstimate) { main.textContent = 'Reading peak cameras…'; if (sub) sub.textContent = `${sample.length} peaks across 0–${mToFt(1280).toLocaleString()} ft`; }
    const urls = await getAlertCamUrls();
    const inputs: PeakInput[] = [];
    for (const p of sample) {
      const u = urls.get(p.camId);
      if (u && !u.offline) inputs.push({ camId: p.camId, name: p.name, elevM: p.elevM, url: u.url });
    }
    const readings = await analyzePeaks(inputs, {
      concurrency: 8,
      onProgress: (done, total) => { if (sub) sub.textContent = `analyzing ${done}/${total} peaks…`; },
    });
    for (const [k, v] of readings) allReadings.set(k, v);
    const est = estimateFogTop(inputs, readings);
    lastEstimate = est;
    lastRun = Date.now();
    lastSampleSize = sampleSize;
    // Debug/verification handle: per-cam readings joined with elevations.
    (window as any).__fogDebug = {
      est: { topM: est.topM, baseM: est.baseM, confidence: est.confidence, sampled: est.sampled },
      cams: inputs.map((i) => ({ name: i.name, elevM: i.elevM, ...(() => { const r = readings.get(i.camId); return r ? { status: r.status, b: Math.round(r.brightness), c: Math.round(r.contrast), s: +r.saturation.toFixed(2), e: +r.edges.toFixed(1) } : {}; })() })).sort((a, b) => a.elevM - b.elevM),
    };
    const fogElevs = inputs.filter((i) => readings.get(i.camId)?.status === 'fog').map((i) => i.elevM);
    renderEstimate(est, inputs.length, fogElevs);
    updatePeakStatuses(map, allReadings);
  })().catch(() => {
    const main = $('fog-main');
    if (main && !lastEstimate) main.textContent = 'Fog analysis unavailable';
  }).finally(() => { running = null; });
  return running;
}
