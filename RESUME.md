# RESUME — bay.camera

Architecture and hard-won knowledge for picking this project up cold. Read this
first, then [README.md](README.md) for commands and data model, and
[STYLE.md](STYLE.md) for conventions.

**This file holds durable knowledge only.** Live task state — what is in flight,
what is blocked on a decision, what was tried and rejected — lives in
`checkpoints/`. If you want to know what to do next, read the newest checkpoint
there. If you want to know how the thing works or why it is shaped this way,
read on.

## What it is

A full-screen Astro + MapLibre dashboard of Bay Area fog, weather and webcams.
Static output, no server, no framework JS, no API keys. Deployed on Netlify at
https://bay-camera.netlify.app/, auto-deploying on push to `master`.

The differentiator is **fog-top altitude**: a band `[base, top]` in feet,
inferred from live peak-camera imagery rather than reported by any API.

## How the pieces work

**Basemap.** OpenFreeMap vector tiles (`tiles.openfreemap.org/styles/positron`
and `/dark`), keyless. Raster weather layers are inserted by `beforeId` so
satellite imagery covers terrain while place names float on top — see
`firstLabelLayerId` in `map.ts`, and gotcha 1 for the two traps in computing it.

**Satellite fog layer.** Day is GOES-18 **Band 2 Red Visible** via NASA GIBS
WMTS (`GoogleMapsCompatible_Level7`, maxzoom 7). Night is SSEC RealEarth
`G18-ABI-CONUS-night-microphysics`, a purpose-built low-stratus RGB, with GIBS
**Band 13 Clean IR** (`Level6` — note Level6, not 7) as fallback. The day/night
handoff is at **+7° solar elevation**; source is recreated on mode flip because
maxzoom differs. Tiles are cache-busted on a 10-minute bucket.

**The `fogtone://` protocol.** Registered with MapLibre's `addProtocol` in
`fog.ts`. It intercepts each satellite tile and applies a luminance→alpha tone
curve in a canvas before MapLibre ever sees it, so clear air becomes transparent
and only the fog field paints. Constants, all calibrated on real frames:
black point **70**, white **185**, gamma **1.1**, max alpha **236**. The black
point is deliberately higher than microclimates.today's 30 — theirs sits on a
black background, ours sits on a map, and 70 stops bright daytime land
reflectance (~60–140) from graying out clear inland areas while the marine layer
(~150–230) stays solid. The cost is that the very thinnest wisps drop out.

**Fog-top classifier** (`fogtop.ts`). 183 ALERTCalifornia peak cams enriched
with elevations (0–1280 m, Open-Meteo DEM). A canvas pipeline downscales live
frames, crops vendor overlays, computes per-cell brightness/contrast/saturation/
edges on a 6×4 grid, and classifies each peak in-cloud vs clear — row 0 is sky
and washes out for everyone under a gray sky, so **row 1, the horizon field, is
the discriminator**. It then fits a band by two-threshold search over elevation.
Calibrated 6/7 against ground truth; the miss was a camera literally half in and
half out of the fog edge. ≤2 socked peaks renders as honest "Patchy fog" rather
than a fake-precise range. A 12-peak probe runs at boot for the HUD chip; the
full 48-peak pass runs when Fog is toggled on. All thresholds are named
constants with calibration comments at the top of the file.

Peak-cam analysis is **gated off at night** below −3° solar elevation: near-IR
frames evade the dark threshold and read "all clear", which is worse than
silence. The card says the estimate resumes at sunrise.

**Microclimates.** 41 curated spots in two zoom-gated tiers (17 tier-1, 24
tier-2), one multi-point Open-Meteo call, rendered as temp+wind pills. Refreshed
every 10 minutes, on by default. Pills are clickable — they open a detail panel
with humidity, dew point, wind and gusts, cloud, visibility, sunrise/sunset, and
a 12-hour Weather Line chart, addressable by `#wx/<slug>` deep link.

**Camera panel.** Curated and peak cameras open in the right panel. Because
every camera with a map dot has coordinates, the panel also renders the forecast
for the camera's own location, using the same renderer as the weather pills
(`weatherHeroHtml` / `weatherDetailHtml` in `panel.ts`). Forecasts are cached 10
minutes, keyed on coordinates rounded to ~100 m.

**Weather icons.** Solar Icons Bold Duotone, vendored as inline SVG strings in
`wxicons.ts` with baked-in duotone opacity, so each icon takes one hue and
renders two tones. Colour is functional: amber sun, slate cloud, blue rain,
violet storm, brand blue-teal fog.

**NWS.** KHAF (coast) and KSFO (bay) observations feed the HUD readout.

## Design system

One hand-written CSS file, `public/styles/main.css`. No Tailwind, no
preprocessor, no CSS-in-JS, no `<style>` blocks in the Astro file. System fonts.

- **Tokens are HSL triples** (`--foreground: 0 0% 7%`) so `hsl(var(--x) / .5)`
  works for alpha. Chrome neutrals are deliberately **0% saturation**: this UI
  floats over a map whose colours are the content, so tinted chrome competes
  with data. Dark mode reassigns the same tokens in one media query.
- **Semantic colour is not decoration and must survive any restyle.** Eight
  region hues, four peak-status colours, weather-condition hues, fog-confidence
  green/amber. The region hues are mirrored in `map.ts` as `REGION_COLORS` —
  change one, change both.
- **Liquid Glass, applied sparingly.** Apple's HIG says outright not to use it
  in the content layer and to limit it to the most important functional
  elements. Three sites only: floating surfaces, the zoom control, attribution.
  The 41 temperature pills are data drawn on the map, so they use a standard
  opaque material, not glass.
- **Edges are inset shadows, never borders.** A border paints one flat colour on
  all four sides and cuts across a rounded corner. `--glass-rim` gives a bright
  top edge, a neutral rim, and a darker base.
- **Corner radii are derived, not chosen.** Apple's concentricity rule: a nested
  corner shares a centre with its container's, so `inner = outer − inset`. 22px
  outer, and nested values follow from their insets.
- **Reading Apple's HIG:** the pages are JS-rendered and a plain fetch returns
  an empty shell. Use the JSON the doc site loads —
  `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`
  and `.../tutorials/data/documentation/<path>.json` — and walk
  `primaryContentSections`.

## ⚠️ Gotchas that cost real time (do not rediscover)

1. **OpenFreeMap layer insertion has two traps.** *Do not insert before the
   first symbol layer* — the dark style puts its first symbol layer at index 8
   and then draws every road, building and boundary after it, so GOES would sit
   under the roads. Insert after the last basemap **geometry** layer. *And that
   scan must skip our own layers* — `cam-point`, `peak-point` and the clusters
   are circle layers appended above the basemap, so a naive "last non-symbol
   layer" walks past the labels, returns undefined, and GOES gets appended over
   the whole map, burying every place name. Hit for real. `APP_SOURCES` in
   `map.ts` is the filter; add a new source to the app and update that set.

2. **maplibre-gl.css is injected by the JS bundle *after* our stylesheet.** On
   equal specificity MapLibre wins, silently. This has bitten three times: its
   `.maplibregl-ctrl-group:not(:empty)` ring beat our glass, its
   `border-top: 1px solid #ddd` divider kept drawing under our replacement, and
   `.maplibregl-marker`'s `transition: opacity .2s` beat ours on the temp pills.
   Match its selector class-for-class, including element tokens — its real
   icon selector is
   `.maplibregl-ctrl button.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon`,
   which grep on a shorter pattern will not show you. Trace specificity in the
   browser, not with grep.
   **Corollary that cost a bug:** raising specificity to beat a vendor sheet
   also raises it above your own `@media` overrides. Repeat the extra selector
   in the `prefers-reduced-transparency` and `prefers-contrast` blocks or the
   accessibility fallbacks silently stop applying.

3. **ALERTCalifornia's API blocks browser TLS fingerprints.** curl works; real
   Chrome fetch dies with a *spurious CORS error* (AWS WAF JA3 blocking, near
   certainly). UA, headers and HTTP version are all irrelevant — tested. Fix is
   the same-origin proxy `/api/alertca`: Vite dev proxy in `astro.config.mjs`,
   Netlify edge function plus 200-rewrite fallback in production. The image CDN
   (`img.cdn.prod.alertwest.com`) has no such block and full CORS, so canvas
   pixel reads work with `crossOrigin='anonymous'`. Deno's fetch is **not**
   blocked — the block only targets browsers — so the edge function can call
   the upstream directly.

4. **Netlify `[[headers]]` do not apply to a proxy rewrite.** Learned on live
   evidence: the proxy path reported `fwd=miss` on every request while static
   paths reported `stored`, and the upstream sends no cache directive, so every
   visitor pulled a fresh 6.65 MB from a public agency. Caching that path needs
   code at the edge (`netlify/edge-functions/alertca.ts`), which **also** needs
   `cache: 'manual'` in its config or Netlify skips the CDN cache entirely.
   Verified: `stored`, then `hit; ttl=56`.

5. **Glyph endpoints that 200 an HTML page kill every vector layer.**
   `fonts.openmaptiles.org` does exactly this — MapLibre parses the HTML as PBF
   ("Unimplemented type: 4") and the failure silently takes down all vector
   layers, not just labels. If vector layers ever vanish wholesale, check
   `map.on('error')` before anything else; the console shows only
   `[object Error]`. Curl any new glyph URL and confirm
   `content-type: application/x-protobuf` before trusting it.

6. **Headless SwiftShader renders raster but not vector layers**, and
   `queryRenderedFeatures` returns 0 there. Verify pins only on hardware GL
   (headed puppeteer). `--disable-gpu` kills WebGL entirely; the working flags
   are `--enable-unsafe-swiftshader --use-gl=angle --use-angle=swiftshader`.

7. **CSS class-name collisions between a component and a body state class have
   twice imploded the layout.** `.hide-broken` (a label styled `display:flex`)
   collided with `body.hide-broken`, and later `.cam-open` collided with
   `body.cam-open` — in both cases `<body>` became a flex container and the map
   collapsed to 0px. Body-state classes are now `hiding-offline` and the anchor
   is `cam-open-link`. When layout inexplicably implodes, check
   `getComputedStyle(document.body).display` first.

8. **`[hidden]` loses to any `display` rule.** `.panel { display: flex }`
   overrode the UA `[hidden] { display: none }`. Every component that sets
   `display` needs its own `.x[hidden] { display: none; }`.

9. **Escape all remote text before it reaches `innerHTML`.** NWS
   `textDescription` was interpolated raw — a real XSS, caught in review. Use
   the `esc()` helper.

10. **MapLibre's `Marker` constructor overwrites the element's `aria-label`.**
    Re-apply it after `.addTo(map)`.

11. **`-I` (HEAD) 404s on the ALERTCalifornia API** — always test with real GETs.

12. **Python `urllib`'s default UA gets 403 from the image CDN** — send a
    browser UA.

13. **`astro preview` ignores `vite.preview.proxy`** for static output, so
    `/api/alertca` 404s under preview while working in `astro dev` and on
    Netlify. Do not diagnose a proxy bug from a preview 404.

14. **Netlify edge caching is per-location** — repeat requests interleave
    `stored` and `hit` because they land on different edge nodes, each holding
    its own copy. Normal, not broken.

15. **There is no `tsconfig.json` in this repo.** Any claim that "tsc strict
    passed" used explicit CLI flags, not a project config.

16. **Fan-out discipline.** An early research fleet of Sonnet crawlers
    recursively spawned sub-agents and got stuck messaging each other, spending
    tokens for nothing. Cap fan-out depth.

## Verification tooling

- `scripts/verify-headless.mjs <url> <shot.png> <waitMs>` — puppeteer-core
  harness: loads the app, dumps map/layer/DOM state plus console errors, and
  screenshots. `window.__map` and `window.__fogDebug` are the handles.
- `scripts/calibrate-fogtop.mjs` — runs the real `fogtop.ts` classifier via
  `window.__fogTest` against ground-truth frames in `public/_cal/`. That
  directory has been cleaned; re-download frames to recalibrate. The ground
  truth table is in the script.
- `npm run dev` must be running for both.
- puppeteer scripts must live **inside the repo**, not `/tmp` — Node module
  resolution fails with `ERR_MODULE_NOT_FOUND` otherwise. Write
  `scripts/.name.mjs` and delete after.
- puppeteer-core's `emulateMediaFeatures` rejects
  `prefers-reduced-transparency`. Drive it over raw CDP instead:
  `(await page.createCDPSession()).send('Emulation.setEmulatedMedia', {media:'', features:[…]})`.

## File map

- `src/pages/index.astro` — markup only; script is `import '../scripts/main'`.
- `src/lib/cameras.ts` — typed access to `data/cameras.json`.
- `src/scripts/` — `main.ts` (wiring and layer toggles), `map.ts` (basemap,
  region colours, `firstLabelLayerId`), `data.ts` (JSON → typed shapes),
  `cams.ts` (pins, clusters, hover), `panel.ts` (camera preview, browse list,
  weather detail, camera-location conditions), `popover.ts` (hover card),
  `weather.ts` (microclimate pills + NWS HUD), `fog.ts` (satellite layers, the
  `fogtone://` protocol, analysis orchestration, fog card), `fogtop.ts` (the
  classifier and band fit), `peaks.ts` (183-cam layer), `alertca.ts` (rotating
  URL resolver, 60s TTL cache + sessionStorage mirror), `wxicons.ts` (vendored
  Solar Icons + WMO code mapping).
- `public/styles/main.css` — the entire design system.
- `scripts/fetch-alertcalifornia.py` — regenerates the peak-cam layer.
- `scripts/enrich-elevations.py` — adds `elev_m` afterward.
- `netlify.toml` — build config, `/api/alertca` rewrite fallback, asset caching.
- `netlify/edge-functions/alertca.ts` — the cached proxy that actually serves
  `/api/alertca`.

## microclimates.today source-dive (2026-07-06, read from their inline JS)

Their fog stack, decoded. Kept because it is the reference implementation for
this problem and their client is richly commented.

- **Products** (SSEC RealEarth, CORS `*`, no key): `G18-ABI-CONUS-BAND02`
  (day, 0.5 km visible), `G18-ABI-CONUS-night-microphysics` (night — fog reads
  pale teal, unmistakable), also `-BAND13` and `-snow-fog`. Latest timestamp
  via `realearth.ssec.wisc.edu/api/latest?products=<id>` → `"20260706.091625"`;
  tiles at `realearth.ssec.wisc.edu/tiles/<id>_20260706_091625/{z}/{x}/{y}.png`
  (underscore form, `{z}/{x}/{y}` order, ~maxzoom 7).
- **Tone curve** on Band 2: their shipped constants are black 30 / white 185 /
  γ1.1, as an SVG filter screen-blended over a dark basemap. Ours is the same
  curve with a higher black point, for the reason given above.
- **Day/night handoff at +7° solar elevation** — measured: Band-2 mean
  luminance hits the black point near +6°, and handing off earlier avoids black
  frames. `MIN_DAY_BRIGHTNESS 44` as an archiver-reported backstop.
- **Their backend tier** (Cloudflare Worker archiver, `/api/now`): satellite
  frame history feeding a fog state machine (clearing / building / socked-in /
  clear), ETA text, brightness trend and momentum, a bay-vs-ocean brightness gap
  ("is it through the Gate"), a week's-norm-at-this-hour baseline, and a fogTop
  estimate. All of it needs frame history, which means a server and storage.
  The static-site steals are the products, the tone curve and the handoff.
- **Neighborhoods page:** NWS gridded forecast area-weighted onto DataSF
  neighborhood polygons, plus "fog-escape spots". A good future feature. Their
  cyan-glow monospace aesthetic is explicitly not wanted here.

## Architecture invariants (don't relitigate without reason)

- MapLibre GL, zero React, no API keys, no Tailwind.
- **No component library.** Base UI (base-ui.com) was explicitly approved early
  as the one acceptable option, but dropping React made it moot and nothing has
  needed it since. Mentioned so it is not re-proposed as a new idea.
- `data/cameras.json` is the source of truth. Dead cameras stay **marked, not
  deleted**.
- **Fog is reported as a band `[base, top]`**, never just a top — cameras below
  the deck are clear with overcast overhead, and the two-threshold fit handles
  that correctly. ≤2 socked cameras is "patchy", never a precise range.
- Temps on by default; Fog and Peaks are opt-in, because the full fog pass
  downloads ~48 frames (≈10 MB) and that is impolite to do unasked.
- Live playback is off by default and capped at 12 hours, so a forgotten tab
  cannot hammer upstream sources forever. This is politeness, not cost — for
  most cameras the browser fetches the operator directly and costs us nothing.
- Design target is clean and clear in the spirit of shadcn/ui, restrained, not
  flashy. The product is an interactive tool; windy.com is the interaction
  reference.

## Project origin

Tim built bay.camera around 2019 as static HTML — a curated directory of public
Bay Area webcams for watching fog and light, originally aimed at photographers.
He handed the domain to a successor (gongruya) during COVID and has since
rebuilt the project from scratch. `bay.camera` itself is therefore not ours; the
product keeps the name everywhere user-facing while living on a Netlify
subdomain. gongruya's repo was used as reference early on.
