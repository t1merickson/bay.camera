# camera vendors & types

A living taxonomy. We are a **second-order consumer** — we don't own any of these feeds, so we can't fix their uptime, codecs, or URL changes. What we *can* do is know each vendor well enough to (a) pull the **lightest** representation, and (b) fail gracefully when it dies. Every camera in `data/cameras.json` carries a `type` that points at an entry here.

When a crawler finds a new camera, identify its vendor by URL signature below. If it's a vendor we don't have yet, add a section.

## the golden rule

**Prefer a still JPEG snapshot over a live video player, always.** A snapshot is a single cache-bustable image (`?t=<timestamp>`); a player is hundreds of KB of JS, an autoplaying codec, and a tracking bundle. This page is left open for hours — weight is the enemy. Only embed a live player when there is no snapshot endpoint and the view is worth it.

## resiliency flags (used in cameras.json `flags`)

- `mixed-content` — asset is served over `http://` while our page is `https://`. **Browsers block these outright now.** Must find an https variant or proxy it (see below). Several legacy cams have this.
- `token-expiry` — embed URL contains a signed token (JWT, query signature) that expires. Will silently die.
- `hotlink-protection` — source rejects requests without a matching `Referer`; needs a proxy.
- `cors` — needs cross-origin headers we don't get; only matters if we fetch (not for plain `<img>`).
- `heavy` — video player / large payload; candidate for a lighter wrapper or snapshot substitute.
- `unstable-host` — self-hosted on a hobbyist box or camera's own web server; expect intermittent outages.
- `rotating-url` — the image URL embeds a timestamp/token that changes every refresh, so there's no stable static endpoint; must re-poll an API to resolve the current URL before each display (e.g. ALERTCalifornia).
- `attribution-unknown` — we can't identify the camera's owner/operator, so it fails vetting rule #3 as-is; resolve before publishing.

### finding a still URL behind a JS-only page

Many webcam pages (FogCam, St. Francis YC, others) render the image via JavaScript with no obvious `<img src>`. Two tricks that work:
- **Windy mirror:** if the cam is listed on windy.com, its current frame is fetchable at `https://imgproxy.windy.com/_/normal/plain/current/<webcamId>/original.jpg` (find the numeric id via search). Convenient, but it's a dependency on Windy's proxy — treat as a stopgap and prefer a first-party endpoint.
- **Read the inline JS:** the real snapshot/stream URL is usually built in the page's script (as with ipcamlive's `snapshot.php` and ALERTCalifornia's API). Grep the fetched HTML for `.jpg`, `snapshot`, `.m3u8`, or an API host.

### the proxy escape hatch (use sparingly — Netlify cost)

For `mixed-content`, `hotlink-protection`, or `cors`, a tiny Netlify function can fetch the upstream image server-side and re-serve it over https with our own `Referer`. Keep this for cams genuinely worth it — each proxied image is a function invocation. Cache aggressively (`Cache-Control`, short TTL) so we're not hammering either the upstream or our function quota.

---

## vendors

### satellite / gov imagery (GOES, NOAA, USGS)
- **Signature:** `fog.today`, `*.ssd.noaa.gov/goes/...`, `*.star.nesdis.noaa.gov`, `cmgp-coastcam.s3...amazonaws.com`
- **Kind:** still image / image loop. Public domain (federal).
- **Resiliency:** the most stable feeds we have — gov infra, standardized paths. Preferred backbone for the fog/cloud layer. USGS CoastCam serves plain S3 JPEGs (`.../latest/c1_snap.jpg`).
- **In our set:** fog.today (GOES-16 SF Bay loop), NOAA SSD GOES-WEST, USGS Santa Cruz.

### CalTrans / gov traffic cams
- **Signature:** `cwwp2.dot.ca.gov`, `caltrans` QuickMap, city/DOT camera portals
- **Kind:** still image, standardized refresh. Public domain.
- **Resiliency:** excellent — gov, stable, uniform URL schemes, dense coverage of bridges/highways. Underused by the old site; worth mining. (District 4 = Bay Area.)

### AngelCam (`v.angelcam.com`)
- **Signature:** `v.angelcam.com/iframe?v=<id>&token=<JWT>`
- **Kind:** iframe player. **`token-expiry`** — the JWT has an `exp` claim; when it lapses the embed dies. `heavy`.
- **Resiliency:** fragile because of the token. Some AngelCam feeds expose a snapshot endpoint — prefer it. If only the tokened iframe exists, expect to periodically re-pull a fresh token from the source page.

### Weather Underground webcams (`icons.wunderground.com/webcamramdisk`)
- **Signature:** `icons.wunderground.com/webcamramdisk/<a>/<b>/<handle>/1/current.jpg`, mp4 timelapse at `.../video.html?...current.mp4`
- **Kind:** still image + daily timelapse. Very predictable pattern.
- **Resiliency:** WU has degraded heavily since the IBM acquisition; **many handles are now dead.** Verify before trusting. When alive, it's a clean lightweight JPEG.

### Axis network cameras (direct CGI)
- **Signature:** `.../axis-cgi/jpg/image.cgi?...`, `.../axis-cgi/mjpg/video.cgi?...`, often on a raw IP or a `:20001`-style port
- **Kind:** the camera's *own* web server. `image.cgi` = single JPEG (light, good); `mjpg/video.cgi` = MJPEG stream (`heavy`).
- **Resiliency:** `unstable-host` by nature — it's one box. Watch for http→https flips, port/firewall changes, and resolution params (`?resolution=704x480`). Prefer `image.cgi` snapshots; poll on our schedule.
- **In our set:** Sam's Chowder House (Half Moon Bay).

### news-station skycams (ABC7, NBC, CBS/Anvato)
- **ABC7** — `cdns.abclocal.go.com/three/kgo/webcam/<place>.jpg`. Still image, light, fairly stable. **Good.** (Emeryville, Mt Tam.)
- **NBC Bay Area** — `nbcbayarea.com/assets/weather/kntv/CAM###-*.jpg`. Mostly **dead** now.
- **CBS / Anvato** — `w3.cdn.anvato.net/player/.../anvload.html?key=<base64>`. Full video player, very `heavy`, base64 config blob. Salesforce Tower uses four of these stacked. Prime candidate for a lighter wrapper or a snapshot substitute if one exists.

### EarthCam (`earthcam.com`)
- **Signature:** `earthcam.com/usa/california/...?cam=<name>`
- **Kind:** commercial; embeds are gated/heavy. Usually **link-out only** for us.
- **Resiliency:** they actively discourage hotlinking. Treat as a "see also" link, not an embed.

### Verkada (`command.verkada.com/embed.html#`)
- **Signature:** `command.verkada.com/embed.html#<params>`
- **Kind:** iframe embed, increasingly common for businesses, marinas, and municipal cams. `heavy`.
- **Resiliency:** depends on the operator leaving the share public; can be revoked. Investigate whether a still/thumbnail endpoint exists behind the embed. Growing footprint — worth a dedicated crawler sweep.

### institutional / observatory / university
- **Signature:** `mthamilton.ucolick.org/hamcam`, `*.lawrencehallofscience.org`, `sjsu.edu/meteorology`
- **Kind:** still images, often self-published from a department server.
- **Resiliency:** moderately stable (institutional infra) but low-priority for the host, so paths change without notice. Frequently `mixed-content` (old http servers).

### personal / hobbyist weather stations
- **Signature:** one-off domains — `sheltons.net/wx/webcam.jpg`, `sigward.com/MuirBeach.jpg`, WeatherSTEM/Weatherlink boxes
- **Kind:** single JPEG from someone's home station. Charming, unique angles.
- **Resiliency:** `unstable-host` + often `mixed-content`. These are the soul of the project and the most fragile. This is exactly the group where we should **carry forward any donation ask** — they're paying for the bandwidth we're leeching.

### live-stream platforms (YouTube Live, etc.)
- **Signature:** many operators have migrated to a YouTube Live embed
- **Kind:** `heavy` iframe. But: YouTube exposes a static thumbnail (`i.ytimg.com/vi/<id>/hqdefault.jpg`) that updates periodically — a near-free lightweight substitute for the default page state.
- **Resiliency:** the stream itself is reliable (Google infra); the operator may end it. Prefer the thumbnail for the at-rest view, upgrade to the player on click.

### ipcamlive (`*.ipcamlive.com`)
- **Signature:** player at `g1.ipcamlive.com/player/player.php?alias=<alias>`; direct snapshot at `s<NN>.ipcamlive.com/streams/<streamid>/snapshot.jpg`
- **Kind:** self-serve IP-camera hosting platform used by yacht clubs, businesses, small operators. The player iframe is often domain-locked (only plays inside the operator's page — `hotlink-protection`), but the **`snapshot.jpg` endpoint frequently works without a referer** — prefer it.
- **Resiliency:** `unstable-host`. The server subdomain (`s133`) and `streamid` can rotate when the camera reconnects; if a snapshot src goes stale, re-derive the `alias`/`streamid` from the player page's inline JS. Often `mixed-content` (http snapshots).
- **In our set:** Golden Gate Bridge cam, Pillar Point Harbor (Half Moon Bay Yacht Club).

### ALERTCalifornia (`*.alertcalifornia.org`, `*.ucsd.edu`)
- **Signature:** UC San Diego / Scripps wildfire-detection network (formerly ALERTWildfire). Axis PTZ cameras named `Axis-<PlaceName>`. Snapshot JPEGs with `cache-control: max-age=10` (refresh every ~10s).
- **Kind:** still snapshot from shared public-safety PTZ cameras on mountain peaks — superb fog/marine-layer vantages (Mt Tam, Wolfback Ridge, Big Rock Ridge, etc.).
- **Resiliency:** government-grade, very reliable host, but `unstable-host` in the *framing* sense — they're shared PTZ cams, so the view can pan/tilt without notice. Public feed is lower-res and slightly delayed (their docs say it's not meant for neighborhood monitoring) — fine for our purpose, but flag it.
- **The API (found):** public, unauthenticated camera list at **`https://ops.alertcalifornia.org/api/getCameraDataByLoc`** — returns every camera's internal `id`, online flag (`off:0`=online), lat/lng, and current `img` filename. Build the image URL as `https://img.cdn.prod.alertwest.com/data/img/<id>/<yyyy>/<mm>/<dd>/<img-filename>`.
- **`rotating-url` gotcha:** the image filename carries a unix timestamp + random suffix that changes every ~1–2 min, so **there is no stable static endpoint** — a live integration must re-poll the API to resolve the current filename before each display (cache-then-refresh). This is the one vendor that genuinely needs a small server-side or scheduled fetch, not a plain `<img src>`.
- **The prize:** 1,200+ cameras statewide, ~12 in Marin alone, on every Bay peak (Mt Tam, Sutro Tower, Wolfback Ridge, Big Rock, etc.). With the API in hand, a single pass can enumerate every online Bay Area cam and drop them straight into `cameras.json`. Highest-value remaining sweep.

### California State Parks HLS (`video.parks.ca.gov`)
- **Signature:** `video.parks.ca.gov/<Park>/<Stream>.stream/playlist.m3u8`
- **Kind:** self-hosted HLS video stream (not YouTube). `heavy` — no snapshot JPEG alternative, so it needs an `<video>`/hls.js wrapper.
- **Resiliency:** state infra, reasonably stable, but each park's stream name must be discovered individually and dead streams 404 silently. Likely the same pattern across other parks' nature cams — worth an enumeration sweep.
- **In our set:** Año Nuevo State Park (elephant-seal colony).

### NDBC BuoyCAM (`ndbc.noaa.gov`)
- **Signature:** `ndbc.noaa.gov/station_page.php?station=<id>` embeds `/images/buoycam/<CODE>_<timestamp>.jpg` — a stitched 6-panel 2880×300 ocean panorama.
- **Kind:** hourly-during-daylight still panorama from open-water buoys. Public domain (federal). Only the **open-water** buoys have cams (46026 SF Bar, 46042 Monterey Bay); in-bay stations don't.
- **Resiliency:** the **filename is timestamped and rotates every capture** — you can't hotlink one static URL; must scrape the station page for the current filename. Niche but genuinely offshore (fog approaching from the sea).

### dead / historical (do not re-add without a live re-check)
- **Nest / Dropcam** (`video.nest.com/embedded/live/...`) — Google killed public embeds. DoloCam died this way.
- **webcams.travel / windy webcams** — aggregator; API exists but coverage is thin here.
