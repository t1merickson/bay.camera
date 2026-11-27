Task: cali-camera · Written: 2026-11-27 07:10 · Scope: turn bay.camera into cali.camera — all of California, every ALERTCalifornia camera, more cameras from a hunt, favorites lists

The Bay Area phase is archived at `checkpoints/archive/2026-09-09-bay-camera.md`.
Its decisions and discards still hold. Its open items are carried below.

## Now

Recon done, plan written, nine Haiku camera hunters running in the background.
Each one writes `data/candidates/<slug>.json` (gitignored until verified). Next:
build the statewide data layer, which needs no answers from Tim, while the
hunters run and Tim decides the questions in Plates.

## What the recon found (27 Nov)

- **cameras.alertcalifornia.org is built on the same API our proxy already
  fetches.** The 7.0 MB response is the whole ALERTWest network: 14,206
  cameras across CA, UT, WA, OR, NV, AZ, ID, AK, HI, MT, BC, CO. The shape is
  `data.locs` (10,335 sites with `el` = elevation in meters) and `data.cams`
  (cameras, joined on `lid`). Each table carries a `key` map from short field
  names to long ones.
- **California has 4,688 cameras, and 3,746 are online:**

  | provider | total | offline | has PTZ + azimuth |
  |---|---|---|---|
  | CALTRANS (road CCTV) | 2,917 | 785 | 0 |
  | UCSD (ALERTCalifornia fire cams) | 1,293 | 81 | 1,293 |
  | HPWREN | 325 | 50 | 0 |
  | FAA WeatherCams | 117 | 9 | 0 |
  | UNR | 30 | 15 | 30 |
  | ALERTWest | 6 | 2 | 6 |

  Today we show 52 curated cameras plus 183 Bay peaks, about 5% of this.
- **PTZ cameras report azimuth (`p`), tilt (`t`), zoom and field-of-view width
  (`fov`).** We can draw which way each camera points.
- **Elevation is in the feed** (`locEl`, meters; Mt Tamalpais East = 750). So
  the Open-Meteo DEM enrichment step can go away.
- **Image filenames carry a timestamp for every provider, Caltrans included**,
  so they rotate. Caltrans' own district feeds
  (`cwwp2.dot.ca.gov/data/dN/cctv/cctvStatusD0N.json`) list 3,615 cameras with
  stable image URLs. That's 698 more than the ALERT feed has, and the URLs
  don't rotate, which matters for favorites.
- **County is in the feed** (`co`), so there's a region taxonomy for free.
- **`cali.camera` has no NS records**, so it's very likely unregistered. The
  method was control-tested: `bay.camera` resolves to Namecheap, and the TLD
  SOA resolves. Price is unknown; short `.camera` names can be premium, so
  check at the registrar.
- About 46 Bay-specific references in code: `BAY_BOUNDS`, `BAY_SOLAR_REF`,
  KHAF/KSFO, and "bay.camera" / "Bay Area" copy.

## Plan

Numbered so Tim can track it. Status is in brackets.

**Phase 1 — statewide data (no decisions needed)**
1. [next] Slim the feed at the edge. The edge function returns CA-only cameras
   with only the fields we use, cached 60 s. Expect roughly 0.5 MB instead of
   7 MB, and the client parses 4.7k rows instead of 14k.
2. [ ] Drop the bundled 183-peak file. Peaks come from the live feed, so
   positions can't go stale (this closes an old open item).
3. [ ] Lock stable camera IDs before lists ship: `a<camId>` for feed cameras,
   existing slugs for curated ones. Every shared list URL depends on this.

**Phase 2 — the map at state scale**
4. [ ] California bounds; map view (center, zoom, layers) lives in the URL.
5. [ ] Cluster every camera type. Filter by type. Hide offline cameras by
   default (942 are offline).
6. [ ] Replace the 8 Bay regions with about 10 California regions, built from
   county.
7. [ ] Search by name, place, county, or highway. Needed at 4,700 cameras.
8. [ ] A "cameras in view" list replaces the grouped region list.

**Phase 3 — fog and weather statewide**
9. [ ] Fog classifier per coastal region, scoped to the viewport, using feed
   elevations. Never download frames statewide.
10. [ ] Solar elevation from the viewport center instead of a fixed SF point.
    California spans about 10° of latitude.
11. [ ] NWS readout: nearest coastal plus nearest inland station to the map
    center, instead of KHAF/KSFO.
12. [ ] Statewide weather spots in zoom tiers per region.

**Phase 4 — favorites and lists** (mock first, stop for Tim's pick)
13. [ ] Three static mocks.
14. [ ] Build the picked one. Lists are stored in localStorage (not a cookie:
    cookies ride along on every request). A shared list is a URL like
    `?l=<name>&c=<ids>`. Opening one shows it read-only, with a Save button.

**Phase 5 — camera hunt merge**
15. [ ] When hunters report: validate schema, re-check liveness, dedupe against
    curated and feed cameras by distance and name, then merge into
    `data/cameras.json` with provenance. Also ingest the 698 Caltrans cameras
    the feed lacks, by script.

**Phase 6 — rename and ship**
16. [ ] Brand strings, manifest, humans.txt, README, RESUME, and a new
    1200×630 share card.
17. [ ] Needs Tim: rename the GitHub repo (public), rename the Netlify site and
    attach the custom domain (his account), buy the domain (his money).
18. [ ] Move `astro.config.mjs` `site` to `https://cali.camera` once DNS
    resolves.

## Plates (waiting on Tim)

- **Caltrans road cameras: on by default, or a toggle?** That's 2,917 cameras,
  mostly road surface. On by default makes the first view a traffic map. A
  toggle keeps the default about sky and light. They're also the best tule fog
  sensors on 99 and I-5.
- **Public renames**: the GitHub repo rename needs his OK. The Netlify site and
  custom domain are his account (he does it, or authorizes the CLI). Renaming
  the local folder moves the Claude memory folder's key, so ask before doing it.
- **Other states**: the feed covers about 9,500 more cameras across the West.
  The name says California, so assume CA-only unless he says otherwise.
- **Carried from the Bay phase, still open:** night magenta intensity, keep or
  drop the peak-status key, the refraction effect, the predictive fog card, tule
  fog (now nearly free: the Central Valley is in scope, and Caltrans plus the
  night satellite layer already see it), analytics, and the private email in
  three pushed commits.

## Terrain

- The ALERT API and Caltrans feeds both answer curl with a generic browser UA.
  Never put an email in a UA or any request.
- The Haiku hunters were told to write only their own file and spawn nothing.
  The old Sonnet fan once recursed and burned tokens.
- `data/candidates/_SCHEMA.md` is the hunt contract. `_existing.json` is the 52
  curated cameras they skip.
- Commits now carry no Claude co-author line (Tim's current rule).

## Ideas backlog (offered to Tim 27 Nov, not yet chosen)

- View cones on PTZ cameras from azimuth + FOV, and a "facing the sunset" filter
  for photographers, the original audience.
- A camera wall: a list opens as a grid of live thumbnails.
- Wildfire layer: public perimeter feeds (NIFC/WFIGS, CAL FIRE) with no key.
  ALERTCalifornia is a fire camera network, so this is its native use.
- Caltrans chain-control and road-condition feeds on mountain passes.
- Web app install for a list ("add to home screen").
- West-wide later: same feed, same code, different bounds.
