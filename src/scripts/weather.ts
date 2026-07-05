/**
 * Microclimates: live temperature/wind at ~17 hand-picked spots that tell the
 * Bay Area story (55° at Ocean Beach while Walnut Creek bakes at 95°). One
 * multi-point Open-Meteo call (free, no key), rendered as small map pills.
 * Also feeds the HUD coast-vs-bay readout (NWS KHAF / KSFO observations).
 */
import maplibregl from 'maplibre-gl';

interface Spot { name: string; lat: number; lng: number; }
// West→east transects across every gap in the coastal hills. Order matters
// only for readability; Open-Meteo returns results in request order.
const SPOTS: Spot[] = [
  { name: 'Bodega Bay', lat: 38.333, lng: -123.048 },
  { name: 'Ocean Beach', lat: 37.760, lng: -122.509 },
  { name: 'Downtown SF', lat: 37.792, lng: -122.399 },
  { name: 'Marin Headlands', lat: 37.827, lng: -122.499 },
  { name: 'San Rafael', lat: 37.974, lng: -122.531 },
  { name: 'Napa', lat: 38.297, lng: -122.287 },
  { name: 'Fairfield', lat: 38.249, lng: -122.040 },
  { name: 'Richmond', lat: 37.936, lng: -122.348 },
  { name: 'Berkeley', lat: 37.872, lng: -122.273 },
  { name: 'Oakland', lat: 37.804, lng: -122.271 },
  { name: 'Walnut Creek', lat: 37.906, lng: -122.065 },
  { name: 'Livermore', lat: 37.682, lng: -121.768 },
  { name: 'Half Moon Bay', lat: 37.464, lng: -122.429 },
  { name: 'San Mateo', lat: 37.563, lng: -122.323 },
  { name: 'Palo Alto', lat: 37.442, lng: -122.143 },
  { name: 'San Jose', lat: 37.336, lng: -121.891 },
  { name: 'Santa Cruz', lat: 36.972, lng: -122.026 },
];

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

function render(map: maplibregl.Map, readings: SpotReading[]) {
  for (const m of markers) m.remove();
  markers = readings.map((r) => {
    const el = document.createElement('div');
    el.className = 'wx-pill';
    // wind_direction is where wind comes FROM; arrow should point where it blows TO.
    const rot = (r.windDir + 180) % 360;
    el.innerHTML =
      `<span class="wx-t" style="color:${tempColor(r.tempF)}">${r.tempF}°</span>` +
      `<span class="wx-w" style="transform:rotate(${rot}deg)">${ARROW}</span>`;
    el.title = `${r.name} — ${r.tempF}°F · wind ${r.windMph} mph · ${r.humidity}% RH · ${r.cloud}% cloud`;
    const label = document.createElement('span');
    label.className = 'wx-name';
    label.textContent = r.name;
    el.appendChild(label);
    return new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([r.lng, r.lat])
      .addTo(map);
  });
  setTempsVisible(tempsOn);
}

let tempsOn = false;
export function setTempsVisible(on: boolean) {
  tempsOn = on;
  for (const m of markers) m.getElement().classList.toggle('is-on', on);
}

export async function initMicroclimates(map: maplibregl.Map) {
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
