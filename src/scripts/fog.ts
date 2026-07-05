/**
 * The fog story, in two parts:
 *
 * 1. GOES-18 GeoColor satellite imagery via NASA GIBS (free, no key, CORS ok)
 *    as a web-mercator raster layer sandwiched between the basemap and its
 *    labels. Daytime GeoColor is the canonical marine-layer view. ~10-min
 *    cadence; `default` time = most recent granule. Max native zoom 7
 *    (~1 km/px — that's the sensor, not us); MapLibre overzooms it.
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

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-West_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png';
const bucket = () => Math.floor(Date.now() / (10 * 60 * 1000)); // 10-min cache-buster

export function addGoesLayer(map: maplibregl.Map) {
  map.addSource('goes', { type: 'raster', tileSize: 256, maxzoom: 7,
    attribution: 'GOES-18 · NASA GIBS',
    tiles: [`${GIBS}?cb=${bucket()}`] });
  map.addLayer({
    id: 'goes', type: 'raster', source: 'goes',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.88, 'raster-fade-duration': 300 },
  }, 'labels');
  // While visible, re-point tiles at the newest granule every 10 min.
  window.setInterval(() => {
    if (document.hidden || map.getLayoutProperty('goes', 'visibility') !== 'visible') return;
    (map.getSource('goes') as maplibregl.RasterTileSource).setTiles([`${GIBS}?cb=${bucket()}`]);
  }, 10 * 60 * 1000);
}

export function setGoesVisible(map: maplibregl.Map, on: boolean) {
  if (!map.getLayer('goes')) return;
  if (on) (map.getSource('goes') as maplibregl.RasterTileSource).setTiles([`${GIBS}?cb=${bucket()}`]);
  map.setLayoutProperty('goes', 'visibility', on ? 'visible' : 'none');
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
let lastEstimate: FogTopEstimate | null = null;
let running: Promise<void> | null = null;
const allReadings = new Map<string, PeakReading>();

const $ = (id: string) => document.getElementById(id);

function renderEstimate(est: FogTopEstimate, sampled: number) {
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
  main.innerHTML = `Top ≈ <strong>${mToFt(est.topM).toLocaleString()} ft</strong> <span class="fog-conf fog-conf-${est.confidence}">${est.confidence}</span>`;
  sub.textContent = `${fogCount} of ${est.sampled} peaks in cloud · ${time}`;
  if (chip) { chip.hidden = false; chip.innerHTML = `<b>Fog top</b> <span class="cond-t">${mToFt(est.topM).toLocaleString()} ft</span>`; }
}

export function runFogAnalysis(map: maplibregl.Map, sampleSize: number, force = false): Promise<void> {
  if (running) return running;
  if (!force && Date.now() - lastRun < 10 * 60 * 1000 && lastEstimate) return Promise.resolve();
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
    renderEstimate(est, inputs.length);
    updatePeakStatuses(map, allReadings);
  })().catch(() => {
    const main = $('fog-main');
    if (main && !lastEstimate) main.textContent = 'Fog analysis unavailable';
  }).finally(() => { running = null; });
  return running;
}
