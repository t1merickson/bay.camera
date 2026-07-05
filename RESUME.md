# RESUME — bay.camera

Handoff doc for picking this up cold in a fresh session. Read this first, then
[README.md](README.md) for architecture. Written 2026-07-05.

## TL;DR of where we are

bay.camera is a revival of Tim's old (~2019) static-HTML directory of Bay Area
webcams for watching fog/light/weather. This session took it from that legacy
static page to a **full-screen, windy.com-style interactive map app**:

- **Stack:** Astro (static output, no server) + **MapLibre GL** for the map +
  hand-rolled CSS (shadcn-style tokens, no Tailwind). **Zero React** — the app
  is one `index.astro` page with an inline `<script>`. MapLibre is the only
  heavy dependency (~221KB gz).
- **Data:** `data/cameras.json` is the single source of truth (52 cameras: 2
  `live`, 9 `dead`, 41 `unverified` → 43 renderable, 41 with map pins).
- **The app** (`src/pages/index.astro`): full-viewport MapLibre map with a
  Carto dark/light basemap, camera markers **clustered** by proximity and
  colored by region, click a marker → a right-docked **preview panel** (still
  image / play-on-demand video / link), a left **browse list** with region
  filters, a top **HUD** (brand, NWS coast-vs-bay fog readout, Clouds toggle,
  Live toggle), and shareable `#cam/<id>` deep links.

Run it: `npm install && npm run dev` → http://localhost:4321/

## ⚠️ The single biggest open question

**Nobody has visually confirmed the MapLibre markers/clusters render.** This
machine's headless Chrome only has *software* WebGL, which renders the raster
basemap fine but **won't composite MapLibre's vector circle layers**. Verified
programmatically (4 marker layers created, 41 features loaded, zero console
errors) but never *seen*. **First task in any new session: open the dev server
in a real browser and confirm the colored pins + clusters appear, cluster on
zoom-out, and expand on zoom-in.** If they don't, that's the top bug.

(Also: `claude-in-chrome` MCP was NOT connected all session, and Codex's
browser runtime is unpaired — so all UI verification was headless screenshots
or Tim's own eyes. Recipe for headless WebGL shots is in README.)

## Plates still spinning / rough edges

1. **"Clouds" overlay ≠ fog.** The Clouds toggle overlays RainViewer *infrared
   satellite* (free, no key), which shows high cloud tops but **barely
   registers the low marine-layer fog we actually care about**. It's a
   pipeline placeholder, not the real fog feature. See "Fog, done right" below.
2. **ALERTCalifornia preview images are stale/blank.** Those cams
   (Grizzly Peak, Mission Peak, etc., type `alertcalifornia`) use image URLs
   that **rotate/expire every ~1–2 min**. The URL baked into `cameras.json` is
   a snapshot that 404s within minutes → preview shows blank/offline. Needs a
   re-poll of `ops.alertcalifornia.org/api/getCameraDataByLoc` (client-side or
   a scheduled Netlify function) to resolve current URLs before display.
3. **"Hide offline" was dropped** in the MapLibre rewrite (it existed in the
   pre-MapLibre version). Offline detection is now only `img.onerror` on the
   open preview — no proactive marking. Status semantics are muddy: 41 cams are
   `unverified` but all render as if fine. Codex flagged this.
4. **Weather still feels like an afterthought** — Tim's words. It's a small
   text line in the HUD (Coast/Bay temp + fog). The map has no real weather
   layer yet (see #1). This is the area most in need of a design+data pass.
5. **Not deployed.** No `netlify.toml`, no build config, no domain. Netlify is
   the assumed host (static `dist/` + maybe a function for the ALERTCalifornia
   re-poll). **Domain is undecided** — Tim gave the original `bay.camera` to
   gongruya (see below) and hasn't decided whether to reclaim it or pick a new
   name.

## Punted features / future directions (roughly priority-ordered)

- **Fog, done right (the differentiator).** microclimates.today's headline
  idea is **"fog-top altitude"**: how high the marine layer sits, i.e. what
  pokes above it. We're uniquely set up for this — `data/alertcalifornia-bay.json`
  has **183 peak cameras with elevations**; "which peaks are socked in vs.
  clear" *is* a fog-top estimate from cameras we already have. Combine with
  daytime GOES-18 GeoColor (useless at night) for a real fog view. This is the
  most valuable next build.
- **Wire the ALERTCalifornia 183-cam peak layer onto the map** as a toggleable
  layer (data file already exists; regenerate via `npm run fetch:alertca`).
  Solves both a coverage win and feeds fog-top.
- **A proper weather panel** — per-zone conditions (coast/bay/inland), maybe
  Ventusky-style wind (microclimates uses Ventusky). Make weather first-class,
  not a HUD footnote.
- **HRRR cloud/color forecast** — gongruya's marquee feature (sunrise/sunset
  color prediction). Heavy: needs a backend that parses GRIB2 (his is a
  private server, NOT in his repo). Only if we want prediction, not just
  current conditions.
- **DataSF neighborhood boundaries** for finer per-neighborhood geography/fog.
- Design polish Codex flagged: tokenize spacing/z-index magic numbers in CSS;
  consider quieting the 8 saturated region colors so a full map isn't
  "confetti"; ensure active/selected state isn't color-only (partially done —
  selected marker has a ring).
- Timelapse playback (many sources offer mp4/gif loops in `sources[]`).

## Known-messy / cleanup debt

- **Vestigial SVG-map files** — dead since the MapLibre swap, safe to delete:
  `src/lib/project.ts`, `src/lib/basemap.json`, `scripts/build-map.py`,
  `scripts/ca-counties.geojson`. (Kept this session only to avoid churn.)
- **Legacy `index.html`** in repo root — the original 2019 static site. NOT
  part of the Astro build (Astro builds `src/pages/` → `dist/`). Dead; keep as
  historical reference or delete.
- **`data/alertcalifornia-bay.json`** (183 cams) is generated but **not wired
  into the app** yet — it's staged for the peak-cam layer.
- Live-refresh + the 12h politeness cap now apply **only to the open preview
  image** (not a global grid), since only one camera streams at a time. That's
  intentional and cheaper, but different from earlier designs — don't "restore"
  a global refresher.

## Decisions already made (don't relitigate without reason)

- **MapLibre GL, not Leaflet, not the SVG.** The hand-rolled SVG basemap hit
  its ceiling (Tim: "thumbnail scaled up," couldn't zoom out, no room for a
  fog raster). Codex independently recommended the same: keep SVG only for a
  first pass, adopt MapLibre when you need slippy behavior / raster weather
  overlays / real zoom — and explicitly **NOT Leaflet** (tile dep + generic
  look; MapLibre is the better windy-like long-term base).
- **Zero React / pure static.** We briefly used React islands + Base UI for one
  switch (45KB gz for a toggle); ripped it out. The app ships no framework JS
  besides MapLibre. Keep it that way unless there's a real need.
- **Free, no-key data services:** Carto basemaps (`basemaps.cartocdn.com`,
  attribution "© OpenStreetMap © CARTO"), RainViewer clouds, NWS
  `api.weather.gov` (KHAF coast / KSFO bay), OpenMapTiles glyphs. No API keys
  anywhere — keep it that way if possible.
- **`data/cameras.json` is the single source of truth.** Everything renders
  from it. Schema in `docs/data-model.md`; vendor types in `docs/vendors.md`.
  `status: dead` cams stay in the file (history) but don't render.

## Gotchas / traps discovered this session (hard-won)

- **CSS class-name collisions are brutal here.** A `.hide-broken` class meant
  two things (a label styled `display:flex` + a body class), so `body` became
  a flex container and the whole layout imploded. Cost ~10 debug rounds. Use
  unique class names; when a layout is inexplicably broken, check
  `getComputedStyle(document.body).display`.
- **`[hidden]` vs `display`:** any element you set `display:` on needs an
  explicit `.x[hidden]{display:none}` or it ignores the `hidden` attribute
  (UA `[hidden]` loses to your class). Bit us on `.panel`.
- **Headless WebGL:** MapLibre needs `--enable-unsafe-swiftshader
  --use-gl=angle --use-angle=swiftshader` in headless Chrome, and *even then*
  vector layers won't render (basemap raster does). Don't trust a headless
  screenshot for marker verification.
- **Astro bundles inline `<script>`** as an external ES module (dev) / may
  inline (prod). Don't expect the script text in the served HTML.
- **Sonnet research subagents recursively spawn their own subagents** and get
  stuck messaging each other — cap fan-out depth explicitly and prefer a flat
  fan-out with a strict "do the work yourself, don't delegate" instruction.

## What the research fleet found (data provenance)

The camera set was built by a fleet of Sonnet crawlers + manual vetting.
Key durable findings (endpoints worth remembering):

- **ALERTCalifornia API:** `https://ops.alertcalifornia.org/api/getCameraDataByLoc`
  — public, no auth, columnar JSON of ~13.6k cams statewide; ~183 online Axis
  peak cams in the Bay Area. Image URL: `img.cdn.prod.alertwest.com/data/img/<camId>/<Y/m/d>/<file>`
  where `<file>` carries a rotating unix timestamp. Regenerator:
  `scripts/fetch-alertcalifornia.py`.
- **Caltrans D4 (Bay Area bridges/highways):** camera index at
  `https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json` (735 cams) or the
  cleaner ArcGIS GeoJSON FeatureServer (District=4). Image pattern:
  `cwwp2.dot.ca.gov/data/d4/cctv/image/<slug>/<slug>.jpg`. Caveat: dead cams
  return a "Temporarily Unavailable" placeholder JPEG (HTTP 200), so liveness
  can't be judged by status code alone.
- **USGS CoastCam:** only 2 Pacific sites exist — Santa Cruz (Dream Inn) and
  Sunset State Beach; both captured. `cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/<site>/latest/c<N>_snap.jpg`.
- **GOES-18 (NOAA STAR):** Bay Area sector is `psw`.
  `cdn.star.nesdis.noaa.gov/GOES18/ABI/SECTOR/psw/GEOCOLOR/latest.jpg` (+ 300/600/1200/2400 sizes, GIF loop). ~5-min cadence. Daytime GeoColor is the
  best satellite *fog* view; useless at night.
- **NDBC BuoyCAM:** only open-water buoys have cams (46026 SF Bar, 46042
  Monterey). Filename rotates → must scrape the station page each poll.
- Vendors + resiliency flags fully documented in `docs/vendors.md`
  (ipcamlive, AngelCam, Axis, Weather Underground [mostly dead now], ABC7,
  Anvato/CBS, EarthCam, Verkada, ALERTCalifornia, CA State Parks HLS, etc.).

## Reference projects (studied this session)

- **gongruya/bay-camera** (the person Tim gave the domain to):
  github.com/gongruya/bay-camera — rewrote it as **Next.js + React + Leaflet +
  MUI on Vercel** with an HRRR cloud-forecast heatmap. The forecast's GRIB2
  backend is a **private server not in the repo**. We harvested his fresh 2024
  camera URLs (fixed several of our mixed-content/dead entries) but did not
  adopt his heavy stack.
- **microclimates.today** — same data spine as us (NWS MTR, GOES-18,
  ALERTCalifornia, broadcast cams). Tim likes the concept, dislikes the UI
  (gradients/glow/monospace-body — the anti-pattern we're avoiding). Stole the
  **fog-top-altitude** idea and the DataSF-neighborhoods + Ventusky-wind leads.

## File map (current)

- `src/pages/index.astro` — **the entire app** (markup + inline MapLibre script).
- `public/styles/main.css` — design system (HSL shadcn tokens) + full-screen
  HUD layout + MapLibre control theming.
- `src/lib/cameras.ts` — loads `cameras.json`, exports `cameras`, `pinned`,
  `REGIONS`.
- `data/cameras.json` — **source of truth** (52 cams).
- `data/alertcalifornia-bay.json` — 183 peak cams (generated, unwired).
- `scripts/fetch-alertcalifornia.py` — regenerate that layer (`npm run fetch:alertca`).
- `docs/vendors.md` — living camera-vendor taxonomy + resiliency flags.
- `docs/data-model.md` — `cameras.json` schema + vetting rules + status lifecycle.
- `STYLE.md` — conventions + commit style + design-system notes.
- **Vestigial (delete-safe):** `src/lib/project.ts`, `src/lib/basemap.json`,
  `scripts/build-map.py`, `scripts/ca-counties.geojson`, root `index.html`.

## Session arc (how we got here, for context)

Legacy static HTML → data-driven `cameras.json` + docs → research fleet builds
the camera set → v1 Astro + React-islands + Base UI + scrolling grid w/ SVG map
hero → v2 shadcn-clean redesign, dropped React entirely → v3 full-screen
"windy-style" pivot (SVG map full-viewport, pin→preview panel) → **v4 (current)
swapped SVG for MapLibre GL** (real basemap, clustering, free zoom, clouds
toggle). Codex reviewed the design mid-way and validated the direction + caught
real bugs (XSS, `[hidden]`, dropped 12h cap, a11y) — all fixed.
