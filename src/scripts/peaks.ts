/**
 * Peak-camera layer: every high, horizon-facing camera in California, colored
 * by fog status once the fog-top analysis has run (slate = unknown, pale = in
 * fog, green = clear, dim = dark/night).
 *
 * Positions come from the live camera feed, not a bundled file. The old
 * data/alertcalifornia-bay.json went stale silently whenever ALERTCalifornia
 * added or moved a camera, and nothing refreshed it.
 */
import type maplibregl from 'maplibre-gl';
import { mToFt, type PeakCamData } from './data';
import { dark } from './map';
import { showPopover, hidePopover } from './popover';
import { getAlertCams, resolveAlertCamUrl } from './alertca';
import type { PeakReading } from './fogtop';

// Fire cameras that pan (UC San Diego, UNR, ALERTWest) plus HPWREN's fixed
// mountaintop cameras. Caltrans and FAA cameras sit low, beside roads and
// runways, so they aren't peaks.
const PEAK_PROVIDERS = new Set(['UCSD', 'UNR', 'ALERTWest', 'HPWREN']);

let peaksPromise: Promise<PeakCamData[]> | null = null;

/** Every peak camera with a known elevation. One feed read per page load. */
export function getPeaks(): Promise<PeakCamData[]> {
  peaksPromise ??= getAlertCams()
    .then((cams) => [...cams.values()]
      .filter((c) => PEAK_PROVIDERS.has(c.provider) && c.elevM !== null)
      .map((c) => ({
        camId: c.camId, name: c.name, county: c.county ?? '', provider: c.provider,
        lat: c.lat, lng: c.lng, elevM: c.elevM!,
      })))
    .catch((err) => { peaksPromise = null; throw err; });
  return peaksPromise;
}

let peaks: PeakCamData[] = [];
let byId: Record<string, PeakCamData> = {};
let lastReadings: Map<string, PeakReading> | undefined;

const STATUS_COLORS: Record<string, string> = {
  unknown: 'hsl(215,15%,55%)',
  clear: 'hsl(142,45%,42%)',
  fog: dark ? 'hsl(210,25%,88%)' : 'hsl(210,20%,78%)',
  dark: 'hsl(217,12%,38%)',
  error: 'hsl(215,15%,55%)',
};

const geojson = (statuses?: Map<string, PeakReading>) => ({
  type: 'FeatureCollection' as const,
  features: peaks.map((p) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    properties: {
      camId: p.camId, name: p.name, elevM: p.elevM,
      status: statuses?.get(p.camId)?.status ?? 'unknown',
    },
  })),
});

export function addPeakLayer(map: maplibregl.Map, onOpen: (p: PeakCamData) => void) {
  const colorMatch: any[] = ['match', ['get', 'status']];
  for (const [k, v] of Object.entries(STATUS_COLORS)) colorMatch.push(k, v);
  colorMatch.push(STATUS_COLORS.unknown);

  // Starts empty and fills when the feed arrives; the layer is off by default,
  // so nobody sees it empty.
  map.addSource('peaks', { type: 'geojson', data: geojson() as any });
  getPeaks().then((list) => {
    peaks = list;
    byId = Object.fromEntries(list.map((p) => [p.camId, p]));
    (map.getSource('peaks') as maplibregl.GeoJSONSource | undefined)?.setData(geojson(lastReadings) as any);
  }).catch((err) => console.warn('peak cameras unavailable:', err));
  map.addLayer({ id: 'peak-point', type: 'circle', source: 'peaks',
    layout: { visibility: 'none' },
    paint: {
      'circle-color': colorMatch as any,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3, 11, 5.5],
      'circle-stroke-color': dark ? 'hsl(222,44%,8%)' : '#ffffff',
      'circle-stroke-width': 1,
      'circle-opacity': 0.92,
    },
  });

  let hoverId: string | null = null;
  map.on('mousemove', 'peak-point', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const f = e.features![0];
    const id = (f.properties as any).camId as string;
    if (id === hoverId) return;
    hoverId = id;
    const p = byId[id];
    if (!p) return;
    showPopover(map, (f.geometry as any).coordinates, {
      title: p.name,
      sub: `${mToFt(p.elevM).toLocaleString()} ft · ${p.provider === 'HPWREN' ? 'HPWREN' : 'ALERTCalifornia'}`,
      image: () => resolveAlertCamUrl(p.camId),
    });
  });
  map.on('mouseleave', 'peak-point', () => {
    map.getCanvas().style.cursor = '';
    hoverId = null;
    hidePopover();
  });
  map.on('click', 'peak-point', (e) => {
    hidePopover();
    const p = byId[(e.features![0].properties as any).camId];
    if (p) onOpen(p);
  });
}

export function setPeaksVisible(map: maplibregl.Map, on: boolean) {
  if (map.getLayer('peak-point')) map.setLayoutProperty('peak-point', 'visibility', on ? 'visible' : 'none');
}

export function updatePeakStatuses(map: maplibregl.Map, readings: Map<string, PeakReading>) {
  lastReadings = readings;
  const src = map.getSource('peaks') as maplibregl.GeoJSONSource | undefined;
  if (src) src.setData(geojson(readings) as any);
}
