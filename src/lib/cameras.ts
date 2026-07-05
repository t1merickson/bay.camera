import data from '../../data/cameras.json';

export interface Camera {
  id: string;
  name: string;
  region: string;
  coords: { lat: number; lng: number; confidence: string } | null;
  type: string;
  embed: { kind: 'image' | 'iframe' | 'link'; src: string | null; page: string };
  attribution: string;
  sources: { label: string; url: string }[];
  donation: { text: string; url: string } | null;
  status: 'live' | 'dead' | 'unverified';
  flags: string[];
  notes?: string;
}

// Region display order + labels — mirrors the legacy page's geography.
export const REGIONS: { slug: string; label: string }[] = [
  { slug: 'satellite', label: 'Satellite & cloud layer' },
  { slug: 'golden-gate', label: 'Golden Gate' },
  { slug: 'san-francisco', label: 'San Francisco' },
  { slug: 'north-bay', label: 'North Bay' },
  { slug: 'east-bay', label: 'East Bay' },
  { slug: 'peninsula', label: 'Peninsula' },
  { slug: 'south-bay', label: 'South Bay' },
  { slug: 'santa-cruz', label: 'Santa Cruz & Monterey' },
];

const all = (data.cameras as Camera[]);

// Only cameras we'd actually show. `dead` stays in the file as history; hide it.
export const cameras: Camera[] = all.filter((c) => c.status !== 'dead');

export function byRegion(slug: string): Camera[] {
  return cameras.filter((c) => c.region === slug);
}

// Cameras that carry a map pin (everything with real coordinates).
export const pinned: Camera[] = cameras.filter((c) => c.coords !== null);
