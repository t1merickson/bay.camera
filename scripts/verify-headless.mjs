// Headless verification harness for bay.camera (software WebGL: raster paints,
// vector circle layers may not composite — check state programmatically).
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:4321/';
const shot = process.argv[3] ?? 'shot.png';
const extraWaitMs = Number(process.argv[4] ?? 12000);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[PAGEERROR] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[REQFAIL] ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, extraWaitMs));

const state = await page.evaluate(() => {
  const map = window.__map;
  const out = { mapExists: !!map };
  if (map) {
    out.loaded = map.loaded();
    out.layers = map.getStyle().layers.map((l) => l.id);
    out.camFeatures = map.querySourceFeatures('cams').length;
    out.peakFeatures = map.querySourceFeatures('peaks').length;
    out.goesVisibility = map.getLayoutProperty('goes', 'visibility');
  }
  out.wxPills = document.querySelectorAll('.wx-pill').length;
  out.wxPillsVisible = document.querySelectorAll('.wx-pill.is-on').length;
  out.conditions = document.getElementById('conditions')?.textContent?.trim();
  out.fogChip = { hidden: document.getElementById('fog-chip')?.hidden, text: document.getElementById('fog-chip')?.textContent };
  out.fogMain = document.getElementById('fog-main')?.textContent;
  out.fogSub = document.getElementById('fog-sub')?.textContent;
  return out;
});

console.log(JSON.stringify(state, null, 1));
console.log('--- console (errors/warnings + last 15) ---');
const errs = logs.filter((l) => /error|PAGEERROR|REQFAIL/i.test(l));
for (const l of [...new Set([...errs.slice(0, 20), ...logs.slice(-15)])]) console.log(l.slice(0, 300));
await page.screenshot({ path: shot });
await browser.close();
