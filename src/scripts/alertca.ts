/**
 * ALERTCalifornia (UC San Diego / CalFire) camera URL resolver.
 *
 * The problem: ALERTCalifornia's peak webcams (the "axis" cameras) don't have
 * stable image URLs. The CDN path embeds the capture timestamp, and the API
 * only ever advertises the *latest* frame — a given filename 404s within ~1-2
 * minutes as newer frames roll in. So we can't hardcode image URLs; they have
 * to be resolved fresh, client-side, from the API.
 *
 * The API:
 *   GET https://ops.alertcalifornia.org/api/getCameraDataByLoc
 * It advertises CORS (Access-Control-Allow-Origin: *) and serves curl fine,
 * but an AWS WAF in front of it rejects browser-fingerprinted TLS — real
 * Chrome fetches die with a spurious CORS error. So we go through a
 * same-origin proxy instead: /api/alertca (Vite dev proxy in
 * astro.config.mjs; Netlify 200-rewrite in netlify.toml). The image CDN
 * (img.cdn.prod.alertwest.com) has no such block — images load direct.
 * There are no working narrowing query params (lat/lon/radius, bbox,
 * north/south/east/west, lid were all tested and ignored) — it always
 * returns the full ~6.65 MB payload (~0.9 MB gzipped) of every camera in
 * the system. That's the whole reason the caching below matters.
 *
 * URL construction: each cam's `img` filename looks like
 *   "Berkeley_Downtown_1783230175_2957.jpg"
 * where the second-to-last underscore token (1783230175) is a unix timestamp.
 * The current image lives at:
 *   https://img.cdn.prod.alertwest.com/data/img/<camId>/<YYYY>/<MM>/<DD>/<img>
 * with YYYY/MM/DD derived from that timestamp interpreted in UTC.
 *
 * Caching strategy (two layers, because the payload is big):
 *   1. Module-level in-memory cache with a timestamp + TTL (default 60s). While
 *      a fetch is in flight, concurrent callers share the one pending promise
 *      (dedupe) so a page never fires the multi-MB request twice at once.
 *   2. A sessionStorage mirror ('baycam:alertca:v1') of the parsed result plus
 *      its fetchedAt. A page reload within the TTL rehydrates from there and
 *      skips the network entirely. All sessionStorage access is wrapped in
 *      try/catch — it's a best-effort optimization, never a hard dependency.
 */

const API_URL = '/api/alertca'; // same-origin proxy — see header comment
const CDN_BASE = 'https://img.cdn.prod.alertwest.com/data/img';
const STORAGE_KEY = 'baycam:alertca:v1';
const DEFAULT_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 15_000;

export interface AlertCam {
  camId: string;
  name: string;
  url: string;
  offline: boolean;
}

interface CacheEntry {
  fetchedAt: number;
  cams: Map<string, AlertCam>;
}

/** Serializable shape for the sessionStorage mirror. */
interface StoredEntry {
  fetchedAt: number;
  cams: AlertCam[];
}

let memoryCache: CacheEntry | null = null;
let inFlight: Promise<Map<string, AlertCam>> | null = null;

/**
 * Build the current CDN image URL for one cam, or null if the filename can't
 * be parsed. Uses UTC for the date path (getUTCFullYear/Month/Date) to match
 * how the CDN buckets frames.
 */
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

/**
 * Parse the raw API response into a camId -> AlertCam map. Defensive: skips
 * any cam missing id/img/lid or with an unparseable filename, and tolerates
 * the API adding or reordering fields.
 */
function parseResponse(raw: unknown): Map<string, AlertCam> {
  const out = new Map<string, AlertCam>();
  if (typeof raw !== 'object' || raw === null) return out;

  const data = (raw as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return out;

  const cams = (data as { cams?: unknown }).cams;
  if (typeof cams !== 'object' || cams === null) return out;

  const list = (cams as { data?: unknown }).data;
  if (!Array.isArray(list)) return out;

  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const rec = item as Record<string, unknown>;

    const camId = rec.id == null ? '' : String(rec.id);
    const img = typeof rec.img === 'string' ? rec.img : '';
    const lid = rec.lid;
    if (!camId || !img || lid == null) continue;

    const url = buildUrl(camId, img);
    if (!url) continue;

    const name = typeof rec.cn === 'string' ? rec.cn.replace(/_/g, ' ') : camId;
    const offline = rec.off === 1 || rec.off === true;

    out.set(camId, { camId, name, url, offline });
  }

  return out;
}

/** Read the sessionStorage mirror, if present and well-formed. */
function readStored(): CacheEntry | null {
  try {
    const rawStr = sessionStorage.getItem(STORAGE_KEY);
    if (!rawStr) return null;
    const parsed = JSON.parse(rawStr) as StoredEntry;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.fetchedAt !== 'number' ||
      !Array.isArray(parsed.cams)
    ) {
      return null;
    }
    const cams = new Map<string, AlertCam>();
    for (const c of parsed.cams) {
      if (c && typeof c.camId === 'string') cams.set(c.camId, c);
    }
    return { fetchedAt: parsed.fetchedAt, cams };
  } catch {
    return null;
  }
}

/** Mirror the parsed result into sessionStorage; failures are non-fatal. */
function writeStored(entry: CacheEntry): void {
  try {
    const stored: StoredEntry = {
      fetchedAt: entry.fetchedAt,
      cams: Array.from(entry.cams.values()),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Quota, disabled storage, private mode — best-effort only.
  }
}

/** Fetch the API and parse it, with an AbortController timeout. */
async function fetchAndParse(): Promise<Map<string, AlertCam>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`ALERTCalifornia API ${res.status}`);
    const raw: unknown = await res.json();
    return parseResponse(raw);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch (or return cached) current-URL map for all ALERTCalifornia cams.
 * TTL default 60s. Concurrent callers during an in-flight fetch share one
 * promise; a fresh in-memory or sessionStorage entry skips the network.
 */
export async function getAlertCamUrls(opts?: {
  ttlMs?: number;
}): Promise<Map<string, AlertCam>> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  if (memoryCache && now - memoryCache.fetchedAt < ttlMs) {
    return memoryCache.cams;
  }

  // Rehydrate from sessionStorage if the mirror is still within TTL.
  if (!memoryCache) {
    const stored = readStored();
    if (stored && now - stored.fetchedAt < ttlMs) {
      memoryCache = stored;
      return stored.cams;
    }
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const cams = await fetchAndParse();
      const entry: CacheEntry = { fetchedAt: Date.now(), cams };
      memoryCache = entry;
      writeStored(entry);
      return cams;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Resolve one camera's current image URL, or null if unknown/offline. */
export async function resolveAlertCamUrl(camId: string): Promise<string | null> {
  const cams = await getAlertCamUrls();
  const cam = cams.get(camId);
  if (!cam || cam.offline) return null;
  return cam.url;
}
