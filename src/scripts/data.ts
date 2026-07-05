/**
 * Client-side data spine. Imports the same JSON the server render uses and
 * derives the shapes the map modules need. `data/cameras.json` stays the
 * single source of truth; nothing here is hand-maintained.
 */
import camerasJson from '../../data/cameras.json';
import peaksJson from '../../data/alertcalifornia-bay.json';

export interface CamData {
  id: string; name: string; region: string; type: string;
  kind: 'image' | 'iframe' | 'link'; src: string | null; page: string;
  attribution: string; sources: { label: string; url: string }[];
  donation: { text: string; url: string } | null;
  refresh: number; lat: number | null; lng: number | null;
  alertcaId: string | null;
}

export interface PeakCamData {
  camId: string; name: string; county: string;
  lat: number; lng: number; elevM: number;
}

// Per-vendor refresh cadence for the open preview (ms).
const REFRESH: Record<string, number> = {
  satellite: 300000, caltrans: 60000, alertcalifornia: 60000, abc7: 30000,
  wunderground: 60000, axis: 20000, institutional: 60000, hobbyist: 60000, ipcamlive: 30000,
};

// ALERTCalifornia image URLs expire in ~1-2 min; we re-resolve them live via
// the API (see alertca.ts). The camId is baked into the stale URL path:
// .../data/img/<camId>/<Y>/<m>/<d>/<file>
const alertcaIdFrom = (src: string | null): string | null => {
  const m = src && src.match(/\/data\/img\/([^/]+)\//);
  return m ? m[1] : null;
};

export const cams: CamData[] = (camerasJson.cameras as any[])
  .filter((c) => c.status !== 'dead')
  .map((c) => ({
    id: c.id, name: c.name, region: c.region, type: c.type,
    kind: c.embed.kind, src: c.embed.src, page: c.embed.page,
    attribution: c.attribution, sources: c.sources, donation: c.donation ?? null,
    refresh: REFRESH[c.type] ?? 60000,
    lat: c.coords?.lat ?? null, lng: c.coords?.lng ?? null,
    alertcaId: c.type === 'alertcalifornia' ? alertcaIdFrom(c.embed?.src) : null,
  }));

export const camById: Record<string, CamData> = Object.fromEntries(cams.map((c) => [c.id, c]));

export const camGeojson = {
  type: 'FeatureCollection' as const,
  features: cams.filter((c) => c.lat != null).map((c) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [c.lng!, c.lat!] },
    properties: { id: c.id, region: c.region, name: c.name },
  })),
};

export const peaks: PeakCamData[] = (peaksJson.cameras as any[]).map((p) => ({
  camId: String(p.camId), name: p.name, county: p.county,
  lat: p.coords.lat, lng: p.coords.lon, elevM: p.elev_m ?? 0,
}));

export const peakById: Record<string, PeakCamData> = Object.fromEntries(peaks.map((p) => [p.camId, p]));

export const REGION_LABELS: Record<string, string> = {
  'satellite': 'Satellite & cloud layer', 'golden-gate': 'Golden Gate', 'san-francisco': 'San Francisco',
  'north-bay': 'North Bay', 'east-bay': 'East Bay', 'peninsula': 'Peninsula',
  'south-bay': 'South Bay', 'santa-cruz': 'Santa Cruz & Monterey',
};

export const mToFt = (m: number) => Math.round(m * 3.28084);
