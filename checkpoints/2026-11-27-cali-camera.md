Task: cali-camera · Written: 2026-11-27 07:10 · Scope: turn bay.camera into cali.camera — all of California, every ALERTCalifornia camera, more cameras from a hunt, favorites lists

The Bay Area phase is archived at `checkpoints/archive/2026-09-09-bay-camera.md`.
Its decisions and discards still hold. Its open items are carried below.

## Now

Phase 1 is shipped and verified in production (Durable cache hit, 179 KB on
the wire). Phase 5 ingestion is done: **1,080 cameras from 9 sources**, in
`data/sources/`, every one checked live, all committed. None of it is on the map
yet. Waiting on Tim:
- **Push** the image-URL fix. Since the last push, all 313 HPWREN peaks show
  broken images on the live site. Fixed locally (commit "fix image URLs for
  Caltrans, HPWREN and FAA cameras"). His "go" covered only the earlier push.
- **Pick** one site-panel mock (A stack / B compass / C filmstrip) and one
  list mock (A star + My lists / B wall / C list in the top bar). PNGs are in
  `mocks/`. Phase 2's map work and the display of all new sources are blocked
  on this pick.

Tim's answers on 27 Nov ("Go, all"), as I read them, each stated back to him:
push yes; Caltrans **on by default**; free business cams **allowed**; video
**yes**, add an HLS player.

## What the recon found (27 Nov)

- **cameras.alertcalifornia.org is built on the same API our proxy already
  fetches.** The 7.0 MB response is the whole ALERTWest network: 14,206
  cameras across CA, UT, WA, OR, NV, AZ, ID, AK, HI, MT, BC, CO. The shape is
  `data.locs` (10,335 sites with `el` = elevation in meters) and `data.cams`
  (cameras, joined on `lid`). Each table carries a `key` map from short field
  names to long ones.
- **California has 4,688 cameras in the feed, but only 4,385 can be shown.**
  302 have no image filename (289 Caltrans) and 2 sit on sites marked private.
  The trim drops both. Raw breakdown:

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
1. [done] Slim the feed at the edge. The edge function returns CA-only cameras
   with only the fields we use, cached 60 s. Measured: 126 KB compressed,
   down from 794 KB. It runs as a regular Netlify Function, because edge
   functions cap CPU at 50 ms and the trim takes 16-22 ms on a fast laptop.
2. [done] Drop the bundled 183-peak file. Peaks come from the live feed, so
   positions can't go stale (this closes an old open item). 1,639 peaks
   statewide. The fog estimate still samples the calibrated population: UCSD
   cameras in the old box, lat 36.85-38.55, lon -123.6 to -121.2.
3. [done] Stable camera IDs, in `src/lib/camera-id.ts`: `a<camId>` for feed
   cameras, slugs for curated ones, and `b`/`p` reserved for buoys and
   PhenoCam.

**Phase 2 — the map at state scale**
4. [ ] California bounds; map view (center, zoom, layers) lives in the URL.
4b. [ ] **Pins become sites, not cameras.** 1,039 of 4,385 cameras (24%)
   share exact coordinates with another camera at the same site, so only the
   top one can be clicked. Example: Mt Bullion 1 and 2. Sites hold 2 cameras
   (583 sites), 4 (31), and 10 (32, mostly FAA and HPWREN arrays). Clicking a
   site should list all its cameras with headings. View cones are the same
   feature drawn on the map. Mock this alongside favorites.
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

Hunt results: 116 candidates, 57 verified live stills, and 85 with guessed
coordinates. Science was the only hunter with real coordinates, because it
used structured feeds. Hand-hunting is thin because the big networks are
already in the ALERTCalifornia feed. **The value is in the structured sources
the hunters found.** Script these and take real coordinates from them:
- NOAA BuoyCAM station list with coordinates: ndbc.noaa.gov/buoycams.php
  (8 CA buoys verified)
- PhenoCam site table: phenocam.nau.edu/webcam/network/table/ (about 92 CA
  sites, CC BY with attribution required). Latest still at
  /data/latest/SITE.jpg
- USGS CoastCam S3: cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras/<site>/latest/c1_snap.jpg
  (public domain). The Dream Inn cams can fill the null image URLs on the
  existing Santa Cruz Main Beach and Cowell's rows.
- State Parks: 12 HLS streams at video.parks.ca.gov/<Name>/<Name>.stream/playlist.m3u8
- NPS stable stills at nps.gov/webcams-<park>/<file>.jpg
- Fixed-URL observatory stills: Lick (mthamilton.ucolick.org) and Palomar
  (algol.palomar.caltech.edu)
- Great Basin APCD: 26 Owens Valley air-quality cams. Coordinates may be on
  their ArcGIS map.
- Caltrans district feeds: 698 cameras the ALERT feed lacks, with stable URLs.

Open questions for the merge, to put to Tim:
- **Policy:** 22 candidates are private businesses and 7 are "commercial-free".
  STYLE.md's principle is public-domain only. Hold that line, or allow free
  public business cams?
- **Video:** 19 candidates are HLS streams. Chrome needs a player library
  (hls.js) for those; Safari plays them natively. That's a new dependency.
- **Mixed content:** a few stills are plain http (e.g. Crescent City harbor),
  and an https page blocks those.
- **Terms:** KTVU says "may not be published... or redistributed", so it stays
  link-only. The Yosemite Conservancy cams require a usage agreement.

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

## Phase 5 results (27 Nov)

| source | cams | notes |
|---|---|---|
| caltrans-gap | 954 | IDs from the image folder; 811 have a heading |
| phenocam | 50 | CC BY; per-site `credit` on 35 |
| gbuapcd | 21 | coordinates, heading and FOV from the district's ArcGIS |
| hunt | 20 | re-placed from real sources; KTVU is link-only (its terms) |
| state-parks | 13 | HLS video; placed from OpenStreetMap |
| ndbc-buoycam | 8 | daylight only |
| nps | 7 | coordinates from NPS linked data |
| usgs-coastcam | 4 | coordinates approximate; USGS doesn't publish them |
| observatories | 3 | Palomar Hale cam dropped this run (0-byte image) |

Live wires from this pass:
- Same-pole Caltrans cameras with no TV code (e.g. ED50 WB 1 vs WB 2) are
  still merged by the 75 m rule. A few road cams are lost; count unknown.
- Caltrans publishes the last 12 frames per camera
  (`referenceImage1..12UpdatesAgoURL`), a ready-made time-lapse. That's an idea,
  and nobody has asked for it.
- Caltrans' district feeds give a direction for the 2,600 Caltrans cameras that
  are also in the ALERT feed (which has no headings). Matching them would give
  those cameras rough view cones.
- The fixed-camera FOV numbers in the ALERT feed (HPWREN 90, FAA and Caltrans
  45) look like defaults, not measurements. Some PTZ cams report FOV 0: treat
  that as unknown.
- PTZ FOV narrows with zoom, but less than the zoom number suggests (median
  50° at zoom 10+). Use the feed's FOV directly; don't derive it from zoom.
- Re-running sources: scripts are idempotent and polite. Caltrans is the
  slow one (about 1,000 GETs).
