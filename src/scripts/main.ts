/**
 * Entry point. Order of operations: map up → camera + peak layers → panels →
 * weather + conditions → a delayed lightweight fog probe so the HUD has a
 * fog-top read without anyone clicking anything.
 */
import { createMap, BAY_BOUNDS } from './map';
import { addCamLayers } from './cams';
import { addPeakLayer, setPeaksVisible } from './peaks';
import { addGoesLayer, setGoesVisible, runFogAnalysis } from './fog';
import { initPanels, openCam, openPeakCam } from './panel';
import { initMicroclimates, initConditions, setTempsVisible } from './weather';

const map = createMap();
(window as any).__map = map; // debug/verification handle
// Test handle for the fog classifier (used by scripts/calibrate-fogtop.mjs).
import('./fogtop').then((m) => { (window as any).__fogTest = m; });

map.on('load', () => {
  map.fitBounds(BAY_BOUNDS, { padding: { top: 72, bottom: 40, left: 40, right: 40 }, duration: 0 });

  addGoesLayer(map);
  addPeakLayer(map, openPeakCam);
  addCamLayers(map, openCam);
  initPanels(map);
  initMicroclimates(map);

  // Layer toggles. "Fog" = GOES satellite + fog-top card + full peak analysis.
  const fogBtn = document.getElementById('fog-btn')!;
  const tempsBtn = document.getElementById('temps-btn')!;
  const peaksBtn = document.getElementById('peaks-btn')!;
  const fogCard = document.getElementById('fog-card') as HTMLElement;
  const peaksLegend = document.getElementById('peaks-legend') as HTMLElement;

  const pressed = (b: HTMLElement) => b.getAttribute('aria-pressed') === 'true';
  const setPressed = (b: HTMLElement, on: boolean) => b.setAttribute('aria-pressed', String(on));

  fogBtn.onclick = () => {
    const on = !pressed(fogBtn);
    setPressed(fogBtn, on);
    setGoesVisible(map, on);
    fogCard.hidden = !on;
    if (on) runFogAnalysis(map, 48);
  };
  tempsBtn.onclick = () => {
    const on = !pressed(tempsBtn);
    setPressed(tempsBtn, on);
    setTempsVisible(on);
  };
  peaksBtn.onclick = () => {
    const on = !pressed(peaksBtn);
    setPressed(peaksBtn, on);
    setPeaksVisible(map, on);
    peaksLegend.hidden = !on;
  };

  // Temps on by default: it's the cheapest, most alive thing on the map.
  setPressed(tempsBtn, true);
  setTempsVisible(true);

  // Background fog probe (12 peaks, ~2 MB) a beat after first paint — feeds
  // the HUD fog-top chip. The full 48-peak pass runs when Fog is toggled on.
  window.setTimeout(() => runFogAnalysis(map, 12), 2500);
});

initConditions();
