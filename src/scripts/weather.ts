/**
 * Microclimates: live temperature/wind at hand-picked spots that tell the
 * Bay Area story (55° at Ocean Beach while Walnut Creek bakes at 95°). One
 * multi-point Open-Meteo call (free, no key), rendered as small map pills.
 * Also feeds the HUD coast-vs-bay readout (NWS KHAF / KSFO observations).
 */
import maplibregl from 'maplibre-gl';
import { openWeather, registerWeatherSpots } from './panel';

export interface Spot { name: string; lat: number; lng: number; tier: 1 | 2; }
const WX_TIER2_MIN_ZOOM = 10;

// West→east transects across every gap in the coastal hills. Order matters
// only for readability; Open-Meteo returns results in request order.
export const SPOTS: Spot[] = [
  { name: 'Bodega Bay', lat: 38.333, lng: -123.048, tier: 1 },
  { name: 'Ocean Beach', lat: 37.760, lng: -122.509, tier: 1 },
  { name: 'Downtown SF', lat: 37.792, lng: -122.399, tier: 1 },
  { name: 'Marin Headlands', lat: 37.827, lng: -122.499, tier: 1 },
  { name: 'San Rafael', lat: 37.974, lng: -122.531, tier: 1 },
  { name: 'Napa', lat: 38.297, lng: -122.287, tier: 1 },
  { name: 'Fairfield', lat: 38.249, lng: -122.040, tier: 1 },
  { name: 'Richmond', lat: 37.936, lng: -122.348, tier: 1 },
  { name: 'Berkeley', lat: 37.872, lng: -122.273, tier: 1 },
  { name: 'Oakland', lat: 37.804, lng: -122.271, tier: 1 },
  { name: 'Walnut Creek', lat: 37.906, lng: -122.065, tier: 1 },
  { name: 'Livermore', lat: 37.682, lng: -121.768, tier: 1 },
  { name: 'Half Moon Bay', lat: 37.464, lng: -122.429, tier: 1 },
  { name: 'San Mateo', lat: 37.563, lng: -122.323, tier: 1 },
  { name: 'Palo Alto', lat: 37.442, lng: -122.143, tier: 1 },
  { name: 'San Jose', lat: 37.336, lng: -121.891, tier: 1 },
  { name: 'Santa Cruz', lat: 36.972, lng: -122.026, tier: 1 },
  { name: 'Inner Richmond', lat: 37.780, lng: -122.464, tier: 2 },
  { name: 'Mission', lat: 37.760, lng: -122.415, tier: 2 },
  { name: 'Noe Valley', lat: 37.751, lng: -122.433, tier: 2 },
  { name: 'Marina', lat: 37.803, lng: -122.437, tier: 2 },
  { name: 'Twin Peaks', lat: 37.754, lng: -122.446, tier: 2 },
  { name: 'Bayview', lat: 37.729, lng: -122.393, tier: 2 },
  { name: 'Excelsior', lat: 37.725, lng: -122.426, tier: 2 },
  { name: 'Presidio', lat: 37.798, lng: -122.466, tier: 2 },
  { name: 'Mill Valley', lat: 37.906, lng: -122.545, tier: 2 },
  { name: 'Sausalito', lat: 37.859, lng: -122.485, tier: 2 },
  { name: 'Tiburon', lat: 37.873, lng: -122.457, tier: 2 },
  { name: 'Fairfax', lat: 37.987, lng: -122.589, tier: 2 },
  { name: 'Novato', lat: 38.107, lng: -122.570, tier: 2 },
  { name: 'Point Reyes Station', lat: 38.069, lng: -122.807, tier: 2 },
  { name: 'Alameda', lat: 37.765, lng: -122.242, tier: 2 },
  { name: 'Oakland Hills (Montclair)', lat: 37.833, lng: -122.211, tier: 2 },
  { name: 'Concord', lat: 37.977, lng: -122.031, tier: 2 },
  { name: 'Hayward', lat: 37.669, lng: -122.081, tier: 2 },
  { name: 'Fremont', lat: 37.548, lng: -121.988, tier: 2 },
  { name: 'Pacifica', lat: 37.614, lng: -122.486, tier: 2 },
  { name: 'Daly City', lat: 37.687, lng: -122.470, tier: 2 },
  { name: 'Redwood City', lat: 37.485, lng: -122.236, tier: 2 },
  { name: 'Mountain View', lat: 37.386, lng: -122.084, tier: 2 },
  { name: 'Capitola', lat: 36.975, lng: -121.954, tier: 2 },
];
registerWeatherSpots(SPOTS);

export interface SpotReading extends Spot {
  tempF: number; windMph: number; windDir: number; humidity: number; cloud: number;
}

export async function fetchMicroclimates(): Promise<SpotReading[]> {
  const lats = SPOTS.map((s) => s.lat.toFixed(3)).join(',');
  const lngs = SPOTS.map((s) => s.lng.toFixed(3)).join(',');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lngs}` +
    '&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,cloud_cover' +
    '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FLos_Angeles';
  const r = await fetch(url);
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  const j = await r.json();
  const arr = Array.isArray(j) ? j : [j];
  return SPOTS.map((s, i) => {
    const c = arr[i]?.current ?? {};
    return {
      ...s,
      tempF: Math.round(c.temperature_2m ?? NaN),
      windMph: Math.round(c.wind_speed_10m ?? 0),
      windDir: c.wind_direction_10m ?? 0,
      humidity: c.relative_humidity_2m ?? 0,
      cloud: c.cloud_cover ?? 0,
    };
  }).filter((s) => Number.isFinite(s.tempF));
}

// Muted cold→hot ramp (hue 210→18), sat/lightness pinned so pills stay calm.
export function tempColor(f: number): string {
  const t = Math.max(0, Math.min(1, (f - 48) / 50)); // 48°F..98°F
  const hue = Math.round(210 - t * 192);
  return `hsl(${hue}, 52%, 44%)`;
}

const ARROW = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

let markers: maplibregl.Marker[] = [];
let refreshTimer: number | null = null;
let weatherMap: maplibregl.Map | null = null;
let zoomListenerMap: maplibregl.Map | null = null;

function tierIsVisible(tier: 1 | 2) {
  return tier === 1 || (weatherMap?.getZoom() ?? 0) >= WX_TIER2_MIN_ZOOM;
}

function updateTempsVisibility() {
  for (const m of markers) {
    const el = m.getElement();
    const tier = el.classList.contains('wx-pill-t2') ? 2 : 1;
    el.classList.toggle('is-on', tempsOn && tierIsVisible(tier));
  }
}

function render(map: maplibregl.Map, readings: SpotReading[]) {
  for (const m of markers) m.remove();
  markers = readings.map((r) => {
    const el = document.createElement('div');
    el.className = r.tier === 2 ? 'wx-pill wx-pill-t2' : 'wx-pill';
    // wind_direction is where wind comes FROM; arrow should point where it blows TO.
    const rot = (r.windDir + 180) % 360;
    el.innerHTML =
      `<span class="wx-t" style="color:${tempColor(r.tempF)}">${r.tempF}°</span>` +
      `<span class="wx-w" style="transform:rotate(${rot}deg)">${ARROW}</span>`;
    el.title = `${r.name} — ${r.tempF}°F · wind ${r.windMph} mph · ${r.humidity}% RH · ${r.cloud}% cloud`;
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${r.name} weather details`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openWeather(r);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      openWeather(r);
    });
    const label = document.createElement('span');
    label.className = 'wx-name';
    label.textContent = r.name;
    el.appendChild(label);
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([r.lng, r.lat])
      .addTo(map);
    marker.getElement().setAttribute('aria-label', `${r.name} weather details`);
    return marker;
  });
  updateTempsVisibility();
}

let tempsOn = false;
export function setTempsVisible(on: boolean) {
  tempsOn = on;
  updateTempsVisibility();
}

export async function initMicroclimates(map: maplibregl.Map) {
  weatherMap = map;
  if (zoomListenerMap !== map) {
    if (zoomListenerMap) zoomListenerMap.off('zoomend', updateTempsVisibility);
    zoomListenerMap = map;
    map.on('zoomend', updateTempsVisibility);
  }
  const load = async () => {
    try { render(map, await fetchMicroclimates()); } catch {}
  };
  await load();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => { if (!document.hidden) load(); }, 10 * 60 * 1000);
}

// ---- HUD conditions: NWS coast (Half Moon Bay) vs bay (SFO) ----
interface Obs { desc: string; f: number | null; visMi: number | null; }
async function obs(station: string): Promise<Obs | null> {
  try {
    const r = await fetch(`https://api.weather.gov/stations/${station}/observations/latest`, { headers: { Accept: 'application/geo+json' } });
    if (!r.ok) return null;
    const p = (await r.json()).properties;
    return {
      desc: p.textDescription || '—',
      f: p.temperature?.value != null ? Math.round(p.temperature.value * 9 / 5 + 32) : null,
      visMi: p.visibility?.value != null ? p.visibility.value / 1609 : null,
    };
  } catch { return null; }
}

const escText = (s: string) => s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

export async function initConditions() {
  const el = document.getElementById('conditions')!;
  const [coast, bay] = await Promise.all([obs('KHAF'), obs('KSFO')]);
  if (!coast && !bay) { el.innerHTML = '<span class="cond-loading">conditions unavailable</span>'; return; }
  const foggy = (o: Obs | null) => !!o && ((o.visMi != null && o.visMi < 3) || /fog|mist|haze/i.test(o.desc));
  const cell = (name: string, o: Obs | null) => o
    ? `<span class="cond"><b>${name}</b> <span class="cond-t">${o.f ?? '–'}°</span>${o.desc && o.desc !== '—' ? ` <span class="cond-d ${foggy(o) ? 'is-fog' : ''}">${escText(o.desc)}</span>` : ''}</span>`
    : '';
  el.innerHTML = cell('Coast', coast) + cell('Bay', bay);
}
