/**
 * Hover popover: a floating card with a live thumbnail, anchored to a map
 * point. One singleton element, repositioned per show(); content swaps are
 * cheap. Image loads are lazy and abandoned on hide (src cleared) so a fast
 * sweep across pins doesn't queue a pile of downloads.
 */
import type maplibregl from 'maplibre-gl';

let el: HTMLDivElement | null = null;
let imgEl: HTMLImageElement, titleEl: HTMLSpanElement, subEl: HTMLSpanElement, mediaEl: HTMLDivElement;
let showToken = 0;

function ensure(): HTMLDivElement {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'map-pop';
  el.setAttribute('aria-hidden', 'true');
  mediaEl = document.createElement('div');
  mediaEl.className = 'map-pop-media';
  imgEl = document.createElement('img');
  imgEl.alt = '';
  mediaEl.appendChild(imgEl);
  const meta = document.createElement('div');
  meta.className = 'map-pop-meta';
  titleEl = document.createElement('span');
  titleEl.className = 'map-pop-title';
  subEl = document.createElement('span');
  subEl.className = 'map-pop-sub';
  meta.append(titleEl, subEl);
  el.append(mediaEl, meta);
  document.querySelector('.map-stage')!.appendChild(el);
  return el;
}

export interface PopContent {
  title: string;
  sub?: string;
  /** Resolves to a thumbnail URL, or null for no image. */
  image?: () => Promise<string | null>;
}

export function showPopover(map: maplibregl.Map, lngLat: [number, number], content: PopContent) {
  const pop = ensure();
  const token = ++showToken;
  titleEl.textContent = content.title;
  subEl.textContent = content.sub ?? '';
  subEl.hidden = !content.sub;
  imgEl.removeAttribute('src');
  mediaEl.hidden = !content.image;
  mediaEl.classList.remove('is-loaded');
  if (content.image) {
    content.image().then((url) => {
      if (token !== showToken || !url) return;
      imgEl.onload = () => { if (token === showToken) mediaEl.classList.add('is-loaded'); };
      imgEl.src = url;
    }).catch(() => {});
  }
  position(map, lngLat);
  pop.classList.add('is-open');
  pop.setAttribute('aria-hidden', 'false');
}

function position(map: maplibregl.Map, lngLat: [number, number]) {
  const p = map.project(lngLat);
  const stage = map.getContainer().getBoundingClientRect();
  const w = 240, h = 200; // approx card box for edge flipping
  let x = p.x + 14, y = p.y - 12;
  if (x + w > stage.width - 8) x = p.x - w - 14;
  if (y + h > stage.height - 8) y = stage.height - h - 8;
  if (y < 64) y = 64;
  el!.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

export function hidePopover() {
  showToken++;
  if (!el) return;
  el.classList.remove('is-open');
  el.setAttribute('aria-hidden', 'true');
  imgEl.removeAttribute('src');
}
