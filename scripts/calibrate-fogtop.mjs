// Calibration harness for the fog classifier: runs the REAL fogtop.ts code
// (via the window.__fogTest handle) against saved ground-truth frames in
// public/_cal/. Usage: node scripts/calibrate-fogtop.mjs [devServerUrl]
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:4321';

// Ground truth from eyeballing the frames (2026-07-05 late morning).
const EXPect = {
  'cal_0000m_Pillar_Point.jpg': 'clear',           // below deck, overcast overhead
  'cal_0216m_Skyline_College.jpg': 'clear',        // below deck
  'cal_0387m_San_Bruno_Mountain.jpg': 'fog',       // in cloud
  'cal_0509m_Grizzly_Peak_Overlook_1.jpg': 'fog',  // in cloud
  'check_Vollmer_Peak.jpg': 'fog',                 // in cloud
  'check_Grizzly_Peak_Overlook_1.jpg': 'fog',      // fog edge, mostly in
  'cal_1059m_Mt_Diablo_North.jpg': 'clear',        // above deck, blue sky
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForFunction('!!window.__fogTest', { timeout: 15000 });

const files = process.argv[3]
  ? [process.argv[3]]
  : await page.evaluate(async () => null) ?? Object.keys(EXPect).concat([
      'cal_0299m_San_Pedro.jpg', 'cal_0434m_Barnabe_Peak_East.jpg',
      'cal_0800m_Mt_Allison.jpg', 'cal_1268m_Mt_Hamilton_SCC_1.jpg',
      'check_Wolfback_Ridge.jpg',
    ]);

const rows = await page.evaluate(async (files) => {
  const inputs = files.map((f, i) => ({ camId: String(i), name: f, elevM: 0, url: '/_cal/' + f }));
  const readings = await window.__fogTest.analyzePeaks(inputs, { concurrency: 4 });
  return inputs.map((inp) => {
    const r = readings.get(inp.camId);
    const washed = r.cells.filter((c) =>
      c.contrast < 12 && c.edges < 4.5 && c.saturation < 0.12 && c.brightness >= 80).length;
    return { file: inp.name, status: r.status, frac: +(washed / (r.cells.length || 1)).toFixed(2),
      b: Math.round(r.brightness), c: Math.round(r.contrast), s: +r.saturation.toFixed(2), e: +r.edges.toFixed(1) };
  });
}, files);

let pass = 0, total = 0;
for (const r of rows) {
  const want = EXPect[r.file];
  const ok = want ? (r.status === want ? 'PASS' : 'FAIL') : '    ';
  if (want) { total++; if (r.status === want) pass++; }
  console.log(`${ok} ${r.status.padEnd(6)} frac=${String(r.frac).padEnd(4)} b=${r.b} c=${r.c} s=${r.s} e=${r.e}  ${r.file}${want ? ' (want ' + want + ')' : ''}`);
}
console.log(`${pass}/${total} ground-truth frames correct`);
await browser.close();
