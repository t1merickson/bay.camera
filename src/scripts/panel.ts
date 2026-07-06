/**
 * Right-docked camera preview panel + left browse list + region filter.
 * Ported from the v4 inline script; ALERTCalifornia previews now re-resolve
 * their rotating image URL live instead of using the baked (stale) one.
 */
import type maplibregl from 'maplibre-gl';
import { camById, REGION_LABELS } from './data';
import { setSelected, setRegionFilter } from './cams';
import { resolveAlertCamUrl } from './alertca';
import { colorFor, iconKeyFor, iconSvg } from './wxicons';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
const EXT = '<svg class="ext" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg>';

let map: maplibregl.Map;
let previewTimer: number | null = null;
let activeId: string | null = null;

interface WeatherSpot { name: string; lat: number; lng: number; }
let weatherSpots: WeatherSpot[] = [];
interface WeatherCurrent {
  temperature_2m?: number;
  apparent_temperature?: number;
  relative_humidity_2m?: number;
  dew_point_2m?: number;
  cloud_cover?: number;
  visibility?: number;
  wind_speed_10m?: number;
  wind_gusts_10m?: number;
  wind_direction_10m?: number;
  weather_code?: number;
  is_day?: 0 | 1;
}
interface WeatherForecast {
  current?: WeatherCurrent;
  hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[]; is_day?: (0 | 1)[] };
  daily?: { sunrise?: string[]; sunset?: string[] };
}

const WEATHER_CODE_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Fog',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Snow',
  77: 'Snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm w/ hail',
  99: 'Thunderstorm w/ hail',
};
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const WEATHER_CURRENT_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'relative_humidity_2m',
  'dew_point_2m',
  'cloud_cover',
  'visibility',
  'wind_speed_10m',
  'wind_gusts_10m',
  'wind_direction_10m',
  'weather_code',
  'is_day',
].join(',');

const $ = (id: string) => document.getElementById(id)!;
const isLive = () => document.documentElement.dataset.live === 'on';
const sw = () => $('live-switch') as HTMLInputElement;

function stopPreviewTimer() { if (previewTimer) { clearInterval(previewTimer); previewTimer = null; } }
const slugFor = (name: string) => name.toLowerCase().trim().replace(/\s+/g, '-');
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const temp = (value: unknown) => {
  const n = num(value);
  return n == null ? '—' : `${Math.round(n)}°`;
};
const tempF = (value: unknown) => {
  const n = num(value);
  return n == null ? '—' : `${Math.round(n)}°F`;
};
const percent = (value: unknown) => {
  const n = num(value);
  return n == null ? '—' : `${Math.round(n)}%`;
};
const detailRow = (label: string, value: string) =>
  `<div class="wxd-row"><div class="wxd-label">${esc(label)}</div><div class="wxd-value">${esc(value)}</div></div>`;

function weatherUrl(spot: WeatherSpot) {
  return 'https://api.open-meteo.com/v1/forecast?' + [
    `latitude=${encodeURIComponent(String(spot.lat))}`,
    `longitude=${encodeURIComponent(String(spot.lng))}`,
    `current=${WEATHER_CURRENT_FIELDS}`,
    'hourly=temperature_2m,weather_code,is_day',
    'forecast_hours=12',
    'daily=sunrise,sunset',
    'forecast_days=1',
    'temperature_unit=fahrenheit',
    'wind_speed_unit=mph',
    'timezone=America%2FLos_Angeles',
  ].join('&');
}

async function fetchWeather(spot: WeatherSpot): Promise<WeatherForecast> {
  const r = await fetch(weatherUrl(spot));
  if (!r.ok) throw new Error(`open-meteo ${r.status}`);
  return await r.json() as WeatherForecast;
}

function conditionLabel(value: unknown) {
  const code = num(value);
  return code == null ? '—' : WEATHER_CODE_LABELS[code] ?? '—';
}

function compass(value: unknown) {
  const deg = num(value);
  if (deg == null) return '—';
  const normalized = ((deg % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 22.5) % 16];
}

function wind(current: WeatherCurrent) {
  const speed = num(current.wind_speed_10m);
  if (speed == null) return '—';
  const gust = num(current.wind_gusts_10m);
  const gustText = gust == null ? '' : ` (gusts ${Math.round(gust)} mph)`;
  return `${compass(current.wind_direction_10m)} ${Math.round(speed)} mph${gustText}`;
}

function visibility(value: unknown) {
  const meters = num(value);
  if (meters == null) return '—';
  if (meters >= 16000) return '10+ mi';
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function timeParts(value?: string) {
  const m = value?.match(/T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function clock(value?: string) {
  const t = timeParts(value);
  if (!t) return '—';
  const hour = t.hour % 12 || 12;
  return `${hour}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`;
}

function hourLabel(value?: string) {
  const t = timeParts(value);
  if (!t) return '—';
  return `${t.hour % 12 || 12}${t.hour < 12 ? 'a' : 'p'}`;
}

function weatherCode(value: unknown) {
  return num(value) ?? 3;
}

function isDay(value: unknown) {
  return value === 0 ? false : true;
}

const pct = (value: number) => value.toFixed(2).replace(/\.?0+$/, '');

function hourlyTrend(data: WeatherForecast) {
  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const codes = data.hourly?.weather_code ?? [];
  const days = data.hourly?.is_day ?? [];
  const count = Math.min(12, Math.max(times.length, temps.length, codes.length, days.length));
  const validTemps = temps.slice(0, 12).map(num).filter((value): value is number => value != null);
  if (!count || !validTemps.length) return '<div class="wxd-hours-empty">Hourly forecast unavailable</div>';

  const minTemp = Math.min(...validTemps);
  const maxTemp = Math.max(...validTemps);
  const domainMin = minTemp - 1;
  const domainMax = maxTemp + 1;
  const yFor = (value: number) => {
    if (minTemp === maxTemp) return 50;
    return 78 - ((value - domainMin) / (domainMax - domainMin)) * 56;
  };
  const xFor = (i: number) => count === 1 ? 50 : 4 + (i * 92) / (count - 1);
  let lastTemp = validTemps[0];
  const points = Array.from({ length: count }, (_, i) => {
    const actualTemp = num(temps[i]);
    if (actualTemp != null) lastTemp = actualTemp;
    const code = weatherCode(codes[i]);
    const day = isDay(days[i]);
    return {
      x: xFor(i),
      y: yFor(actualTemp ?? lastTemp),
      time: times[i],
      tempText: temp(actualTemp),
      code,
      day,
      color: colorFor(code, day),
      icon: iconKeyFor(code, day),
    };
  });
  const lines = points.slice(0, -1).map((point, i) => {
    const next = points[i + 1];
    return `<line x1="${pct(point.x)}" y1="${pct(point.y)}" x2="${pct(next.x)}" y2="${pct(next.y)}" stroke="${point.color}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`;
  }).join('');
  const markers = points.map((point, i) =>
    `<span class="wxl-temp" style="left:${pct(point.x)}%;top:${pct(point.y)}%;">${esc(point.tempText)}</span>` +
    `<span class="wxl-icon" style="left:${pct(point.x)}%;top:${pct(point.y)}%;color:${point.color};">${iconSvg(point.icon)}</span>` +
    (i % 2 === 0 ? `<span class="wxl-hour" style="left:${pct(point.x)}%;">${esc(hourLabel(point.time))}</span>` : '')
  ).join('');
  return `<div class="wxl"><svg class="wxl-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>${markers}</div>`;
}

function renderWeather(data: WeatherForecast) {
  const current = data.current ?? {};
  const code = weatherCode(current.weather_code);
  const day = isDay(current.is_day);
  const icon = iconKeyFor(code, day);
  const color = colorFor(code, day);
  $('cam-view').innerHTML =
    '<div class="wxd-hero">' +
    `<span class="wxd-hero-icon" style="color:${color};">${iconSvg(icon)}</span>` +
    '<div>' +
    `<div class="wxd-temp">${esc(temp(current.temperature_2m))}</div>` +
    `<div class="wxd-condition">${esc(conditionLabel(current.weather_code))}</div>` +
    `<div class="wxd-feels">feels like ${esc(temp(current.apparent_temperature))}</div>` +
    '</div>' +
    '</div>';
  $('cam-info').innerHTML =
    '<div class="wxd-grid">' +
    detailRow('Humidity', percent(current.relative_humidity_2m)) +
    detailRow('Dew point', tempF(current.dew_point_2m)) +
    detailRow('Wind', wind(current)) +
    detailRow('Cloud cover', percent(current.cloud_cover)) +
    detailRow('Visibility', visibility(current.visibility)) +
    detailRow('Sunrise', clock(data.daily?.sunrise?.[0])) +
    detailRow('Sunset', clock(data.daily?.sunset?.[0])) +
    '</div>' +
    '<div class="wxd-hours">' +
    '<div class="wxd-hours-title">Next 12 hours</div>' +
    hourlyTrend(data) +
    '</div>';
}

export function setLive(on: boolean) {
  document.documentElement.dataset.live = on ? 'on' : 'off';
  if (activeId) openCam(activeId);
}

export async function openCam(id: string) {
  const c = camById[id];
  if (!c) return;
  activeId = id;
  stopPreviewTimer();
  $('cam-title').textContent = c.name;
  const camView = $('cam-view');
  camView.className = 'cam-view';
  camView.innerHTML = '';
  // ALERTCalifornia URLs rotate every ~1-2 min; resolve the current one.
  let src = c.src;
  if (c.alertcaId) src = (await resolveAlertCamUrl(c.alertcaId)) ?? c.src;
  if (activeId !== id) return; // user moved on while we resolved
  if (c.kind === 'image' && src) {
    const a = document.createElement('a');
    a.href = c.page || src; a.target = '_blank';
    const img = document.createElement('img');
    img.alt = c.name; img.src = src;
    img.onerror = () => camView.classList.add('is-offline');
    a.appendChild(img); camView.appendChild(a);
    if (isLive()) {
      const started = Date.now();
      previewTimer = window.setInterval(async () => {
        // 12h politeness cap: a forgotten tab shouldn't hammer sources forever.
        if (Date.now() - started > 12 * 3600 * 1000) {
          stopPreviewTimer(); sw().checked = false;
          document.documentElement.dataset.live = 'off';
          try { localStorage.setItem('bay-camera:live', '0'); } catch {}
          return;
        }
        if (document.hidden) return;
        if (c.alertcaId) {
          const u = await resolveAlertCamUrl(c.alertcaId);
          if (u && activeId === id) img.src = u;
        } else {
          const sep = c.src!.includes('?') ? '&' : '?';
          img.src = c.src + sep + 't=' + Date.now();
        }
      }, c.refresh);
    }
  } else if (c.kind === 'iframe') {
    if (isLive() && c.src) {
      const f = document.createElement('iframe');
      f.src = c.src; f.allow = 'autoplay; fullscreen'; (f as any).loading = 'lazy';
      camView.appendChild(f);
    } else {
      const b = document.createElement('button');
      b.className = 'cam-embed-play'; b.innerHTML = '▶ Play live video';
      b.onclick = () => { sw().checked = true; setLive(true); };
      camView.appendChild(b);
    }
  } else {
    const a = document.createElement('a');
    a.className = 'cam-open-link'; a.href = c.page; a.target = '_blank';
    a.innerHTML = 'Open camera ' + EXT;
    camView.appendChild(a);
  }
  let html = `<p class="cam-name"><span class="dot region-${c.region}"></span>${esc(REGION_LABELS[c.region] || '')}</p>`;
  html += `<p class="cam-attr">${esc(c.attribution)}</p>`;
  for (const s of c.sources) html += `<p class="cam-source"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)} ${EXT}</a></p>`;
  if (c.page) html += `<p class="cam-source"><a href="${esc(c.page)}" target="_blank" rel="noopener">Source page ${EXT}</a></p>`;
  if (c.donation) html += `<p class="cam-donate"><a href="${esc(c.donation.url)}" target="_blank" rel="noopener">♥ ${esc(c.donation.text)}</a></p>`;
  $('cam-info').innerHTML = html;
  ($('panel-cam') as HTMLElement).hidden = false;
  document.body.classList.add('cam-open');
  document.querySelectorAll('.cam-list-item').forEach((el) => el.classList.toggle('active', (el as HTMLElement).dataset.id === id));
  setSelected(map, id);
  if (c.lat != null) map.flyTo({ center: [c.lng!, c.lat], zoom: Math.max(map.getZoom(), 10.5), padding: { right: 360 }, duration: 700 });
  try { history.replaceState(null, '', '#cam/' + encodeURIComponent(id)); } catch {}
}

/** Preview a peak cam (ALERTCalifornia layer) in the same right panel. */
export async function openPeakCam(p: { camId: string; name: string; county: string; elevM: number }) {
  activeId = 'peak:' + p.camId;
  const id = activeId;
  stopPreviewTimer();
  $('cam-title').textContent = p.name;
  const camView = $('cam-view');
  camView.className = 'cam-view';
  camView.innerHTML = '';
  const url = await resolveAlertCamUrl(p.camId);
  if (activeId !== id) return;
  if (url) {
    const a = document.createElement('a');
    a.href = 'https://cameras.alertcalifornia.org/'; a.target = '_blank';
    const img = document.createElement('img');
    img.alt = p.name; img.src = url;
    img.onerror = () => camView.classList.add('is-offline');
    a.appendChild(img); camView.appendChild(a);
    if (isLive()) {
      previewTimer = window.setInterval(async () => {
        if (document.hidden) return;
        const u = await resolveAlertCamUrl(p.camId);
        if (u && activeId === id) img.src = u;
      }, 60000);
    }
  } else {
    camView.classList.add('is-offline');
  }
  const ft = Math.round(p.elevM * 3.28084).toLocaleString();
  $('cam-info').innerHTML =
    `<p class="cam-name">Peak camera · ${esc(p.county)} · ${ft} ft</p>` +
    `<p class="cam-attr">ALERTCalifornia — UC San Diego &amp; CAL FIRE</p>` +
    `<p class="cam-source"><a href="https://cameras.alertcalifornia.org/" target="_blank" rel="noopener">alertcalifornia.org ${EXT}</a></p>`;
  ($('panel-cam') as HTMLElement).hidden = false;
  document.body.classList.add('cam-open');
  document.querySelectorAll('.cam-list-item.active').forEach((el) => el.classList.remove('active'));
  setSelected(map, null);
}

export async function openWeather(spot: WeatherSpot) {
  const slug = slugFor(spot.name);
  activeId = 'wx:' + slug;
  const id = activeId;
  stopPreviewTimer();
  $('cam-title').textContent = spot.name;
  const camView = $('cam-view');
  camView.className = 'cam-view wx-view';
  camView.innerHTML = '<div class="wxd-hero"><div class="wxd-loading">Loading weather...</div></div>';
  $('cam-info').innerHTML = '';
  ($('panel-cam') as HTMLElement).hidden = false;
  document.body.classList.add('cam-open');
  document.querySelectorAll('.cam-list-item.active').forEach((el) => el.classList.remove('active'));
  setSelected(map, null);
  map.flyTo({ center: [spot.lng, spot.lat], zoom: Math.max(map.getZoom(), 10.5), padding: { right: 360 }, duration: 700 });
  try { history.replaceState(null, '', '#wx/' + encodeURIComponent(slug)); } catch {}
  try {
    const data = await fetchWeather(spot);
    if (activeId !== id) return;
    renderWeather(data);
  } catch {
    if (activeId !== id) return;
    camView.innerHTML = '<div class="wxd-hero"><div class="wxd-error">Weather unavailable</div></div>';
    $('cam-info').innerHTML = '';
  }
}

export function registerWeatherSpots(spots: WeatherSpot[]) {
  weatherSpots = spots;
}

export function closeCam() {
  ($('panel-cam') as HTMLElement).hidden = true;
  document.body.classList.remove('cam-open');
  stopPreviewTimer();
  activeId = null;
  const camView = $('cam-view');
  camView.className = 'cam-view';
  camView.innerHTML = '';
  $('cam-info').innerHTML = '';
  document.querySelectorAll('.cam-list-item.active').forEach((el) => el.classList.remove('active'));
  setSelected(map, null);
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
}

export function initPanels(m: maplibregl.Map) {
  map = m;

  $('cam-close').onclick = closeCam;
  document.querySelectorAll('.cam-list-item').forEach((el) =>
    el.addEventListener('click', () => openCam((el as HTMLElement).dataset.id!)));

  // browse list
  const panelList = $('panel-list') as HTMLElement;
  const browseBtn = $('browse-btn');
  $('list-count').textContent = `(${Object.keys(camById).length})`;
  const toggleList = (open: boolean) => { panelList.hidden = !open; browseBtn.setAttribute('aria-expanded', String(open)); };
  browseBtn.onclick = () => toggleList(panelList.hidden);
  $('list-close').onclick = () => toggleList(false);

  // region filter
  const chips = document.querySelectorAll<HTMLElement>('[data-region-chip]');
  chips.forEach((c) => c.addEventListener('click', () => {
    const slug = c.dataset.regionChip!;
    chips.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.regionChip === slug)));
    document.querySelectorAll<HTMLElement>('[data-region-section]').forEach((sec) => {
      sec.hidden = slug !== 'all' && sec.dataset.regionSection !== slug;
    });
    setRegionFilter(map, slug);
  }));

  // live toggle
  const s = sw();
  try { if (localStorage.getItem('bay-camera:live') === '1') s.checked = true; } catch {}
  s.addEventListener('change', () => {
    try { localStorage.setItem('bay-camera:live', s.checked ? '1' : '0'); } catch {}
    setLive(s.checked);
  });
  setLive(s.checked);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeCam(); toggleList(false); } });

  // deep link
  const m2 = location.hash.match(/^#cam\/(.+)$/);
  if (m2) {
    const id = decodeURIComponent(m2[1]);
    if (camById[id]) openCam(id);
  } else {
    const wx = location.hash.match(/^#wx\/(.+)$/);
    if (wx) {
      const slug = decodeURIComponent(wx[1]);
      const spot = weatherSpots.find((s) => slugFor(s.name) === slug);
      if (spot) openWeather(spot);
    }
  }
}
