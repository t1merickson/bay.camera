/**
 * Curated-camera map layers: clustered colored pins, selection ring,
 * click-to-open, hover popovers with live thumbnails.
 */
import type maplibregl from 'maplibre-gl';
import { camGeojson, camById, REGION_LABELS, type CamData } from './data';
import { dark, regionMatchExpr } from './map';
import { showPopover, hidePopover } from './popover';
import { resolveAlertCamUrl } from './alertca';

export function addCamLayers(map: maplibregl.Map, onOpen: (id: string) => void) {
  map.addSource('cams', { type: 'geojson', data: camGeojson as any, cluster: true, clusterRadius: 40, clusterMaxZoom: 12 });
  map.addLayer({ id: 'clusters', type: 'circle', source: 'cams', filter: ['has', 'point_count'], paint: {
    'circle-color': dark ? 'hsl(217,28%,24%)' : 'hsl(214,32%,90%)',
    'circle-stroke-color': dark ? 'hsl(217,20%,42%)' : 'hsl(214,25%,72%)', 'circle-stroke-width': 1,
    'circle-radius': ['step', ['get', 'point_count'], 15, 6, 19, 15, 25],
  }});
  map.addLayer({ id: 'cluster-count', type: 'symbol', source: 'cams', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12 },
    paint: { 'text-color': dark ? '#eaf0f7' : '#1f2430' } });
  map.addLayer({ id: 'cam-selected', type: 'circle', source: 'cams', filter: ['==', ['get', 'id'], '___none___'], paint: {
    'circle-radius': 11, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3,
    'circle-stroke-color': dark ? '#ffffff' : 'hsl(217,91%,45%)',
  }});
  map.addLayer({ id: 'cam-point', type: 'circle', source: 'cams', filter: ['!', ['has', 'point_count']], paint: {
    'circle-color': regionMatchExpr(), 'circle-radius': 6,
    'circle-stroke-color': dark ? 'hsl(222,44%,8%)' : '#ffffff', 'circle-stroke-width': 1.5,
  }});

  map.on('click', 'clusters', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
    (map.getSource('cams') as maplibregl.GeoJSONSource).getClusterExpansionZoom((f.properties as any).cluster_id)
      .then((z) => map.easeTo({ center: (f.geometry as any).coordinates, zoom: z }));
  });
  map.on('click', 'cam-point', (e) => {
    hidePopover();
    onOpen((e.features![0].properties as any).id);
  });

  // Hover: pointer cursor + thumbnail popover for still-image cams.
  let hoverId: string | null = null;
  map.on('mousemove', 'cam-point', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    const f = e.features![0];
    const id = (f.properties as any).id as string;
    if (id === hoverId) return;
    hoverId = id;
    const c = camById[id];
    if (!c) return;
    showPopover(map, (f.geometry as any).coordinates, {
      title: c.name,
      sub: REGION_LABELS[c.region] ?? c.region,
      image: thumbFor(c),
    });
  });
  map.on('mouseleave', 'cam-point', () => {
    map.getCanvas().style.cursor = '';
    hoverId = null;
    hidePopover();
  });
  map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
}

function thumbFor(c: CamData): (() => Promise<string | null>) | undefined {
  if (c.kind !== 'image' || !c.src) return undefined;
  if (c.alertcaId) return () => resolveAlertCamUrl(c.alertcaId!);
  const src = c.src;
  return async () => src;
}

export function setSelected(map: maplibregl.Map, id: string | null) {
  if (map.getLayer('cam-selected')) map.setFilter('cam-selected', ['==', ['get', 'id'], id ?? '___none___']);
}

export function setRegionFilter(map: maplibregl.Map, slug: string) {
  if (!map.getLayer('cam-point')) return;
  const all = slug === 'all';
  map.setLayoutProperty('clusters', 'visibility', all ? 'visible' : 'none');
  map.setLayoutProperty('cluster-count', 'visibility', all ? 'visible' : 'none');
  map.setFilter('cam-point', all ? ['!', ['has', 'point_count']] : ['all', ['!', ['has', 'point_count']], ['==', ['get', 'region'], slug]]);
}
