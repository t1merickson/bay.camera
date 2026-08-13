# RESUME — bay.camera

Handoff doc for picking this up cold. Read this first, then [README.md](README.md)
for architecture. Rewritten 2026-07-05 (second big session — Fable).

## TL;DR of where we are

Full-screen Astro + MapLibre dashboard of Bay Area fog/weather/webcams. This
session took it from "unverified pins + placeholder clouds" to a working
windy-style instrument:

- **Pins render.** The two-session mystery is solved: `fonts.openmaptiles.org`
  200s an HTML page, MapLibre parses it as PBF ("Unimplemented type: 4"), and
  that failure silently kills EVERY vector layer, not just labels. Glyphs now
  come from `demotiles.maplibre.org`. Verified in real Chrome (hardware GL,
  puppeteer-core headed): clusters, counts, colored pins, all live.
- **Real fog layer:** GOES-18 GeoColor via NASA GIBS WMTS (free, no key,
  CORS ok), web-mercator tiles sandwiched between a label-less Carto basemap
  and a labels-only raster, so city names float above the satellite imagery.
  `.../GOES-West_ABI_GeoColor/default/default/GoogleMapsCompatible_Level7/{z}/{y}/{x}.png`
  — the `default` time = newest granule; maxzoom 7 (~1 km/px, the sensor's
  limit); refreshed every 10 min while visible; opacity fades on overzoom.
- **Fog-top altitude (the differentiator) works.** 183 ALERTCalifornia peak
  cams enriched with elevations (0–1280 m, Open-Meteo DEM). A canvas pipeline
  downscales live frames, crops vendor overlays, computes per-cell
  brightness/contrast/saturation/edges on a 6×4 grid, classifies each peak
  in-cloud vs clear (row 0 = sky washes for everyone under gray sky; row 1 =
  horizon field is THE discriminator), then fits a fog BAND [base, top] by
  two-threshold search over elevation. Calibrated against ground-truth frames
  (6/7; the miss was a cam literally half-in/half-out of the fog edge).
  ≤2 socked peaks renders as honest "Patchy fog" instead of a fake-precise band.
  12-peak probe at boot feeds the HUD chip; full 48-peak pass on Fog toggle.
- **Microclimates:** 17 curated spots, one multi-point Open-Meteo call →
  temp+wind pills on the map (muted cold→hot ramp), refreshed every 10 min.
  On by default. NWS KHAF/KSFO coast-vs-bay readout in the HUD.
- **Hover popovers:** any camera pin (curated or peak) shows a floating card
  with live thumbnail on hover. Verified visually.
- **Peaks layer:** all 183 peak cams toggleable, dots colored by fog status
  after analysis (green clear / pale fog / dim dark), click → preview panel
  with re-resolved (non-stale) image URL.

## ⚠️ Gotchas that cost real time (do not rediscover)

1. **ALERTCalifornia's API blocks browser TLS fingerprints.** curl works;
   real Chrome fetch dies with a *spurious CORS error* (AWS WAF JA3 blocking,
   near-certainly). UA/headers/HTTP-version are all irrelevant — tested. The
   fix: same-origin proxy `/api/alertca` → Vite dev proxy in
   `astro.config.mjs` + Netlify 200-rewrite in `netlify.toml`. The image CDN
   (`img.cdn.prod.alertwest.com`) has NO such block and full CORS — canvas
   pixel reads work with `crossOrigin='anonymous'`.
2. **The glyphs thing above.** If vector layers ever vanish wholesale, check
   `map.on('error')` before anything else — the console shows only
   `[object Error]`.
3. **Headless swiftshader** renders raster but not vector layers, and
   `queryRenderedFeatures` returns 0 there — verify pins only on hardware GL
   (headed puppeteer; the `claude-in-chrome` extension was down all session).
4. **`-I` (HEAD) 404s on the ALERTCalifornia API** — always test with real GETs.
5. Python `urllib` default UA gets 403 from the image CDN — send a browser UA.

## Verification tooling (new this session)

- `scripts/verify-headless.mjs <url> <shot.png> <waitMs>` — puppeteer-core
  harness: loads the app, dumps map/layer/DOM state + console errors,
  screenshots. `window.__map` and `window.__fogDebug` are the handles.
- `scripts/calibrate-fogtop.mjs` — runs the REAL fogtop.ts classifier
  (via `window.__fogTest`) against ground-truth frames in `public/_cal/`
  (dir was cleaned; re-download frames to recalibrate, ground truth table is
  in the script).
- `npm run dev` must be running for both.

## File map (current)

- `src/pages/index.astro` — markup only; script is `import '../scripts/main'`.
- `src/scripts/` — `main.ts` (wiring), `map.ts` (basemap sandwich, region
  colors), `data.ts` (JSON → typed shapes), `cams.ts` (pins/clusters/hover),
  `panel.ts` (preview + browse + peak preview), `popover.ts` (hover card),
  `weather.ts` (microclimate pills + NWS HUD), `fog.ts` (GOES layer +
  analysis orchestration + fog card), `fogtop.ts` (the classifier/band fit —
  all thresholds are named constants with calibration comments), `peaks.ts`
  (183-cam layer), `alertca.ts` (URL resolver, 60s TTL cache + sessionStorage).
- `scripts/enrich-elevations.py` — adds `elev_m` to alertcalifornia-bay.json
  (run after `fetch:alertca` regenerates it).
- `netlify.toml` — build + the critical `/api/alertca` proxy rewrite.
- Vestigial (still delete-safe): `src/lib/project.ts`, `src/lib/basemap.json`,
  `scripts/build-map.py`, `scripts/ca-counties.geojson`, root `index.html`.

## Evening session addendum (same day, Codex-implemented, Claude-judged)

- **Cam-click white-map bug fixed**: `.cam-open` anchor style collided with
  the `body.cam-open` state class → body went inline-flex → map collapsed to
  0px. Anchor renamed `cam-open-link`. (Same disease as the old
  `.hide-broken` incident — check `getComputedStyle(document.body).display`
  first when layout implodes.)
- **Weather pills are clickable**: right panel with current conditions,
  humidity/dew/wind/gusts/cloud/visibility/sunrise-sunset + next-12h strip,
  `#wx/<slug>` deep links (`openWeather` in panel.ts). NOTE: MapLibre's
  Marker constructor overwrites the element's aria-label — re-apply after
  `.addTo(map)`.
- **Fog layer is night-capable**: below −3° solar elevation (NOAA formula in
  fog.ts) the 'goes' layer swaps GeoColor → Band 13 Clean IR
  (`GOES-West_ABI_Band13_Clean_Infrared`, TileMatrixSet Level6 — note
  Level6, not 7). Source is recreated on mode flip (maxzoom differs). In
  Band 13, fog = brighter gray than clear sky. Peak-cam analysis is gated
  off at night (near-IR frames evade the dark threshold and read
  "all clear" — misleading), card says estimate resumes at sunrise.
- Codex delegation works well here: `codex exec` briefs live in the session
  scratchpad pattern; ALERTCalifornia/GIBS URLs must be pre-verified by the
  orchestrator (Codex sandbox has no DNS).

## microclimates.today source-dive findings (2026-07-06, read their inline JS)

Their fog stack, fully decoded (their client is richly commented):
- **Products (SSEC RealEarth, CORS `*`, no key):** `G18-ABI-CONUS-BAND02`
  (day, 0.5 km visible), `G18-ABI-CONUS-night-microphysics` (night — purpose-
  built low-stratus RGB, fog reads pale teal; verified live, unmistakable),
  also `-BAND13` and `-snow-fog`. Latest timestamp:
  `realearth.ssec.wisc.edu/api/latest?products=<id>` → `"20260706.091625"`;
  tiles `realearth.ssec.wisc.edu/tiles/<id>_20260706_091625/{z}/{x}/{y}.png`
  (underscore form, {z}/{x}/{y} order, ~maxzoom 7).
- **Tone curve** on Band 2: shipped constants black 30 / white 185 / γ1.1
  (SVG filter + screen-blend over Carto dark so clear air drops out).
  MapLibre-native equivalent: `raster-color` luminance→alpha ramp.
- **Day/night handoff at +7° solar elevation** (measured: Band-2 mean
  luminance hits the black point near +6°; earlier handoff avoids black
  frames). MIN_DAY_BRIGHTNESS 44 as archiver-reported backstop.
- **Their backend tier** (Cloudflare Worker archiver, `/api/now`): satellite
  frame history → fog state machine (clearing/building/socked-in/clear),
  ETA text, brightness trend + momentum, bay-vs-ocean brightness gap ("is it
  through the Gate"), week's-norm-at-this-hour baseline, plus a fogTop
  estimate. ALL of this needs frame history = a small server + storage; maps
  to our future Netlify function. The static-site steals are the products,
  tone curve, and handoff above.
- **Neighborhoods page:** NWS gridded forecast area-weighted onto DataSF
  neighborhood polygons + "fog-escape spots". Good future feature; their
  cyan-glow monospace aesthetic is explicitly NOT wanted here.

## Next moves (priority order)

1. **Morning fog session.** Everything was built/calibrated at 11am–noon as
   the deck burned off (patchy). Load it at 8am on a foggy July morning and
   sanity-check the band estimate against KHAF/KSFO + eyeballs. Thresholds
   live at the top of `fogtop.ts`. Verify the night→day IR handoff at dawn.
1b. **Predictive fog card (awaiting Tim's verdict):** coast–inland temp
   gradient + coastal dew-point spread (both already in fetched data) as
   honest "fog likely tonight" heuristics.
2. ~~**Deploy to Netlify**~~ — **DONE. Live at https://bay-camera.netlify.app/**
   (12 Aug 2026). Auto-deploys on push to `master` at
   github.com/t1merickson/bay.camera. The domain question is still open —
   bay.camera belongs to gongruya, and Tim decided against buying a new one
   for now. The product is still named bay.camera in all UI; only
   `astro.config.mjs`'s `site` points at the Netlify subdomain.

   **Caching gotcha, learned the hard way:** a `[[headers]]` block in
   netlify.toml does NOT apply to a proxy rewrite. The live proxy reported
   `fwd=miss` on every single request while static paths reported `stored`,
   and the upstream sends no cache directive of its own — so every visitor
   was pulling a fresh 6.65 MB from a public agency. Caching that path needs
   code at the edge: `netlify/edge-functions/alertca.ts`, which also needs
   `cache: 'manual'` in its config or Netlify skips the CDN cache entirely.
   Verified live: `stored`, then `hit; ttl=56`. The netlify.toml redirect
   stays as the fallback via `context.next()`.

   Deno's fetch is NOT blocked by the upstream's firewall — that block only
   targets browser TLS fingerprints — so the edge function can call it directly.
   Weather stays browser→Open-Meteo direct (zero cost to us) until traffic
   justifies the same treatment.
3. **Design iteration with Tim's eyes** — dark-basemap contrast (Carto dark
   is very dark at z8), fog-card typography, temp-pill density at low zoom.
4. **Night mode for fog card** — currently says "cameras too dark to read"
   after dusk; could fall back to GOES IR or NWS obs.
5. Peak-dot legend (green/pale/dim meaning is currently unexplained in UI).
6. "Hide offline" for curated cams (still dropped from the v4 rewrite).
7. Cleanup: vestigial files above; `data/cameras.json` ALERTCalifornia
   entries could carry `camId` explicitly instead of regex-from-URL.

## Decisions already made (don't relitigate without reason)

- MapLibre GL, zero React, no API keys, `data/cameras.json` is the source of
  truth, dead cams stay marked not deleted — all unchanged from last session.
- **Fog = GOES GeoColor + peak-cam band estimate.** RainViewer IR is gone
  (it never showed marine layer).
- **Fog is reported as a band [base, top]**, not just a top — cams below the
  deck are clear with overcast overhead, and the two-threshold fit handles
  that correctly. ≤2 socked cams = "patchy", never a precise range.
- Temps on by default; Fog/Peaks opt-in (the full fog pass downloads ~48
  frames ≈ 10 MB — polite to keep behind a click; boot probe is 12).
