/**
 * The ALERTCalifornia camera feed: every California camera on
 * cameras.alertcalifornia.org, with its current image URL.
 *
 * That's about 4,700 cameras from Caltrans, UC San Diego's fire cameras,
 * HPWREN, FAA WeatherCams and a few others. The browser can't call the API
 * directly (an AWS WAF rejects browser TLS), so it reads /api/alertca, which
 * our server fills from the API and trims to California. See
 * src/lib/alertca-feed.mjs for the shape and netlify/functions/alertca.mts for
 * the server side.
 *
 * Image URLs rotate. Each camera's `img` filename embeds the capture time, e.g.
 *   "Berkeley_Downtown_1783230175_2957.jpg"
 * and the file lives at
 *   https://img.cdn.prod.alertwest.com/data/img/<camId>/<YYYY>/<MM>/<DD>/<img>
 * with the date taken from that timestamp in UTC. A given filename 404s within
 * a minute or two as newer frames arrive, so URLs are always resolved fresh
 * from the feed and never stored.
 *
 * Caching, two layers: an in-memory copy with a 60 s TTL (concurrent callers
 * share one in-flight request), and a sessionStorage mirror of the raw feed
 * text so a reload within the TTL skips the network. Storage access is
 * best-effort and wrapped in try/catch.
 */

const API_URL = '/api/alertca';
const CDN_BASE = 'https://img.cdn.prod.alertwest.com/data/img';
// v2: the feed changed from the raw upstream JSON to the trimmed columnar
// shape, so an old mirror must not be read as the new one.
const STORAGE_KEY = 'cali-camera:alertca:v2';
const DEFAULT_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

export type AlertProvider = 'CALTRANS' | 'UCSD' | 'HPWREN' | 'FAA' | 'UNR' | 'ALERTWest' | string;

export interface AlertCam {
  camId: string;
  name: string;
  lat: number;
  lng: number;
  /** Site elevation in meters, or null if the feed didn't say. */
  elevM: number | null;
  provider: AlertProvider;
  county: string | null;
  /** Can pan/tilt/zoom. Only these report a heading. */
  ptz: boolean;
  /** Compass heading the camera is pointing, degrees, or null. */
  azimuth: number | null;
  /** Horizontal field of view, degrees, or null. */
  fov: number | null;
  offline: boolean;
  /** Current image URL. Rotates; don't store it. */
  url: string;
}

interface Feed {
  v: number;
  fetchedAt: number;
  cols: string[];
  rows: unknown[][];
}

// Cache age is measured from when THIS browser received the feed. Not from the
// feed's own `fetchedAt`, which is when our server fetched upstream: the CDN can
// serve a copy up to three minutes old, so judging by that would make every
// copy look stale and refetch on every call. Caught in testing: two requests
// in 17 seconds.
let memoryCache: { receivedAt: number; cams: Map<string, AlertCam> } | null = null;
let inFlight: Promise<Map<string, AlertCam>> | null = null;

/** Current CDN URL for one frame, or null if the filename carries no timestamp. */
function buildUrl(camId: string, img: string): string | null {
  const parts = img.split('_');
  if (parts.length < 2) return null;
  const ts = Number(parts[parts.length - 2]);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const d = new Date(ts * 1000);
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${CDN_BASE}/${camId}/${yyyy}/${mm}/${dd}/${img}`;
}

function isFeed(x: unknown): x is Feed {
  const f = x as Feed;
  return !!f && typeof f === 'object' && typeof f.v === 'number' &&
    Array.isArray(f.cols) && Array.isArray(f.rows);
}

/** Columns are looked up by name, so the server can add one without breaking this. */
function parseFeed(feed: Feed): Map<string, AlertCam> {
  const at = (name: string) => feed.cols.indexOf(name);
  const i = {
    id: at('id'), name: at('name'), lat: at('lat'), lng: at('lng'), el: at('el'),
    pr: at('pr'), co: at('co'), ptz: at('ptz'), az: at('az'), fov: at('fov'),
    off: at('off'), img: at('img'),
  };
  const get = (row: unknown[], idx: number) => (idx < 0 ? undefined : row[idx]);
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  const out = new Map<string, AlertCam>();
  for (const row of feed.rows) {
    if (!Array.isArray(row)) continue;
    const camId = String(get(row, i.id) ?? '');
    const img = get(row, i.img);
    const lat = numOrNull(get(row, i.lat));
    const lng = numOrNull(get(row, i.lng));
    if (!camId || typeof img !== 'string' || lat === null || lng === null) continue;
    const url = buildUrl(camId, img);
    if (!url) continue;
    out.set(camId, {
      camId,
      name: String(get(row, i.name) ?? camId),
      lat, lng,
      elevM: numOrNull(get(row, i.el)),
      provider: String(get(row, i.pr) ?? ''),
      county: (get(row, i.co) as string | null) ?? null,
      ptz: get(row, i.ptz) === 1,
      azimuth: numOrNull(get(row, i.az)),
      fov: numOrNull(get(row, i.fov)),
      offline: get(row, i.off) === 1,
      url,
    });
  }
  return out;
}

function readStored(): { receivedAt: number; feed: Feed } | null {
  try {
    const text = sessionStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text) as { receivedAt?: unknown; feed?: unknown };
    if (typeof parsed?.receivedAt !== 'number' || !isFeed(parsed.feed)) return null;
    return { receivedAt: parsed.receivedAt, feed: parsed.feed };
  } catch {
    return null;
  }
}

function writeStored(receivedAt: number, feedText: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, `{"receivedAt":${receivedAt},"feed":${feedText}}`);
  } catch {
    // Quota, disabled storage, private mode: best-effort only.
  }
}

async function fetchFeed(): Promise<{ receivedAt: number; feed: Feed }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`camera feed ${res.status}`);
    const text = await res.text();
    const parsed: unknown = JSON.parse(text);
    if (!isFeed(parsed)) throw new Error('camera feed: unexpected shape');
    const receivedAt = Date.now();
    writeStored(receivedAt, text);
    return { receivedAt, feed: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every California camera, keyed by camId. Cached 60 s by default; concurrent
 * callers share one request.
 */
export async function getAlertCams(opts?: { ttlMs?: number }): Promise<Map<string, AlertCam>> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  if (memoryCache && now - memoryCache.receivedAt < ttlMs) return memoryCache.cams;

  if (!memoryCache) {
    const stored = readStored();
    if (stored && now - stored.receivedAt < ttlMs) {
      memoryCache = { receivedAt: stored.receivedAt, cams: parseFeed(stored.feed) };
      return memoryCache.cams;
    }
  }

  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { receivedAt, feed } = await fetchFeed();
      memoryCache = { receivedAt, cams: parseFeed(feed) };
      return memoryCache.cams;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Kept under its old name for callers that only want URLs. */
export const getAlertCamUrls = getAlertCams;

/** One camera's current image URL, or null if unknown or offline. */
export async function resolveAlertCamUrl(camId: string): Promise<string | null> {
  const cam = (await getAlertCams()).get(camId);
  return !cam || cam.offline ? null : cam.url;
}
