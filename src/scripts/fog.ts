/**
 * The fog story, in two parts:
 *
 * 1. GOES-18 satellite imagery via NASA GIBS (free, no key, CORS ok) as a
 *    web-mercator raster layer sandwiched between the basemap and its labels.
 *    Daytime GeoColor is the canonical marine-layer view; after dark, Band 13
 *    Clean IR keeps low stratus readable. ~10-min cadence; `default` time =
 *    most recent granule. MapLibre overzooms the native GIBS matrix.
 *
 * 2. Fog-top altitude: sample the ALERTCalifornia peak cams across their
 *    elevation range, classify each frame in-cloud vs clear (fogtop.ts), and
 *    the elevation boundary between them is the marine-layer top.
 */
import type maplibregl from 'maplibre-gl';
import { peaks, mToFt } from './data';
import { getAlertCamUrls } from './alertca';
import { analyzePeaks, estimateFogTop, type PeakInput, type PeakReading, type FogTopEstimate } from './fogtop';
import { updatePeakStatuses } from './peaks';

const ATTRIBUTION = 'GOES-18 · NASA GIBS';
const GOES_SOURCE_ID = 'goes';
const GOES_LAYER_ID = 'goes';
const GOES_BEFORE_ID = 'labels';
const NIGHT_ELEVATION_DEG = -3;
const BAY_SOLAR_REF = { lat: 37.77, lon: -122.42 };
const DAY_MS = 24 * 60 * 60 * 1000;

const GOES_TILES = {
  day: {
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png',
    maxzoom: 7,
  },
  night: {
    // In Band 13 IR, Bay fog/low stratus reads as brighter mid-gray than clear sky.
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
    maxzoom: 6,
  },
} as const;

type GoesMode = keyof typeof GOES_TILES;

const bucket = () => Math.floor(Date.now() / (10 * 60 * 1000)); // 10-min cache-buster
const tileUrl = (mode: GoesMode) => `${GOES_TILES[mode].url}?cb=${bucket()}`;

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

export function goesModeForDate(date = new Date()): GoesMode {
  return solarElevationDeg(date) < NIGHT_ELEVATION_DEG ? 'night' : 'day';
}

let activeGoesMode: GoesMode | null = null;

function addGoesSourceAndLayer(map: maplibregl.Map, mode: GoesMode, visibility: 'visible' | 'none') {
  const spec = GOES_TILES[mode];
  map.addSource(GOES_SOURCE_ID, { type: 'raster', tileSize: 256, maxzoom: spec.maxzoom,
    attribution: ATTRIBUTION,
    tiles: [tileUrl(mode)] });
  const layer: maplibregl.RasterLayerSpecification = {
    id: GOES_LAYER_ID, type: 'raster', source: GOES_SOURCE_ID,
    layout: { visibility },
    // Fade back as you overzoom past the sensor resolution so streets stay
    // readable under the (increasingly blurry) cloud field.
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.88, 10, 0.8, 12, 0.55] as any, 'raster-fade-duration': 300 },
  };
  if (map.getLayer(GOES_BEFORE_ID)) map.addLayer(layer, GOES_BEFORE_ID);
  else map.addLayer(layer);
  activeGoesMode = mode;
}

function refreshGoesTiles(map: maplibregl.Map, visibility?: 'visible' | 'none') {
  const mode = goesModeForDate();
  const currentVisibility = visibility ?? (map.getLayer(GOES_LAYER_ID) && map.getLayoutProperty(GOES_LAYER_ID, 'visibility') === 'visible' ? 'visible' : 'none');
  if (activeGoesMode !== mode || !map.getSource(GOES_SOURCE_ID) || !map.getLayer(GOES_LAYER_ID)) {
    if (map.getLayer(GOES_LAYER_ID)) map.removeLayer(GOES_LAYER_ID);
    if (map.getSource(GOES_SOURCE_ID)) map.removeSource(GOES_SOURCE_ID);
    addGoesSourceAndLayer(map, mode, currentVisibility);
    return;
  }
  (map.getSource(GOES_SOURCE_ID) as maplibregl.RasterTileSource).setTiles([tileUrl(mode)]);
  if (visibility) map.setLayoutProperty(GOES_LAYER_ID, 'visibility', visibility);
}

export function addGoesLayer(map: maplibregl.Map) {
  addGoesSourceAndLayer(map, goesModeForDate(), 'none');
  // While visible, re-point tiles at the newest granule every 10 min.
  window.setInterval(() => {
    if (document.hidden || map.getLayoutProperty(GOES_LAYER_ID, 'visibility') !== 'visible') return;
    refreshGoesTiles(map, 'visible');
  }, 10 * 60 * 1000);
}

export function setGoesVisible(map: maplibregl.Map, on: boolean) {
  if (!map.getLayer(GOES_LAYER_ID)) return;
  if (on) {
    refreshGoesTiles(map, 'visible');
    return;
  }
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
  main.textContent = 'Night — satellite IR shows fog; cameras need daylight';
  sub.textContent = `peak-camera estimate resumes at sunrise · ${time}`;
  if (chip) chip.hidden = true;
}

export function runFogAnalysis(map: maplibregl.Map, sampleSize: number, force = false): Promise<void> {
  if (goesModeForDate() === 'night') {
    renderNightCameraEstimate();
    return Promise.resolve();
  }
  if (running) return running;
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
