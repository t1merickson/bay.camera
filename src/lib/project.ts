import basemap from './basemap.json';

// Web Mercator projection matching scripts/build-map.py exactly, so a camera's
// lat/lng lands on the projected county geography.
const { pad, s, Xmin, Ymax } = basemap.proj;

export function project(lat: number, lng: number): { x: number; y: number } {
  const mx = (lng * Math.PI) / 180;
  const my = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return {
    x: Math.round((pad + (mx - Xmin) * s) * 10) / 10,
    y: Math.round((pad + (Ymax - my) * s) * 10) / 10,
  };
}

export const mapMeta = {
  viewBox: basemap.viewBox as string,
  width: basemap.width as number,
  height: basemap.height as number,
  fullWidth: basemap.fullWidth as number,
  fullHeight: basemap.fullHeight as number,
  counties: basemap.counties as { name: string; path: string }[],
};
