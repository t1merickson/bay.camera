/**
 * Trim the ALERTCalifornia camera feed to one state and the fields the map uses.
 *
 * The upstream API (ops.alertcalifornia.org/api/getCameraDataByLoc) ignores
 * every narrowing parameter and always returns the whole ALERTWest network:
 * about 14,000 cameras across 12 states and provinces, 7 MB raw, 794 KB
 * compressed. California is about a third of that. Trimming before the
 * response leaves our server cuts the compressed download to about 126 KB, and
 * the browser parses 4,700 rows instead of 24,000.
 *
 * Plain JavaScript on purpose: the Netlify Function and the dev server in
 * astro.config.mjs both import this file, and the dev server is Node without
 * a TypeScript step.
 *
 * The upstream shape is two tables with short field names:
 *   data.locs.data[]  sites:   id, lat, lon, st (state), lp (private), el (meters)
 *   data.cams.data[]  cameras: id, cn (name), lid (site id), st, pv (private),
 *                              pr (provider), co (county), ptz, p (azimuth),
 *                              fov (view width, degrees), off (offline), img
 * Each table also carries a `key` map from the short names to long ones.
 *
 * The output is columnar so it stays small: `cols` names the fields once and
 * every row is an array in that order. Readers should look columns up by name,
 * never by position, so a column can be added without breaking them.
 */

export const FEED_VERSION = 1;

export const COLS = ['id', 'name', 'lat', 'lng', 'el', 'pr', 'co', 'ptz', 'az', 'fov', 'off', 'img'];

const num = (v) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
};

// Five decimal places is about 1 m, far finer than a map pin needs.
const coord = (v) => Math.round(v * 1e5) / 1e5;

/**
 * @param {unknown} raw  the upstream JSON
 * @param {{ state?: string, fetchedAt?: number }} [opts]
 * @returns {{ v: number, fetchedAt: number, cols: string[], rows: unknown[][] }}
 */
export function trimFeed(raw, { state = 'CA', fetchedAt = Date.now() } = {}) {
  const data = raw && typeof raw === 'object' ? raw.data : null;
  const locRows = data?.locs?.data;
  const camRows = data?.cams?.data;
  if (!Array.isArray(locRows) || !Array.isArray(camRows)) {
    throw new Error('ALERTCalifornia feed changed shape: expected data.locs.data and data.cams.data');
  }

  const locs = new Map();
  for (const l of locRows) if (l && l.id != null) locs.set(l.id, l);

  const rows = [];
  for (const c of camRows) {
    if (!c || c.st !== state || c.id == null || !c.img) continue;
    // Both the camera and its site carry a private flag. Respect either.
    if (c.pv === 1) continue;
    const l = locs.get(c.lid);
    if (!l || l.lp === 1) continue;
    const lat = num(l.lat);
    const lng = num(l.lon);
    if (lat === null || lng === null) continue;

    const ptz = c.ptz ? 1 : 0;
    rows.push([
      String(c.id),
      String(c.cn ?? c.id).replace(/_/g, ' ').trim(),
      coord(lat),
      coord(lng),
      num(l.el),
      c.pr ?? null,
      c.co ?? null,
      ptz,
      // Azimuth only means something on a camera that can pan.
      ptz ? num(c.p) : null,
      num(c.fov),
      c.off ? 1 : 0,
      c.img,
    ]);
  }

  return { v: FEED_VERSION, fetchedAt, cols: COLS, rows };
}
