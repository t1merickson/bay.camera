#!/usr/bin/env python3
"""Hand-found cameras from the camera hunt -> data/sources/hunt.json (letter "h").

Source: data/candidates/{bay-area,coast-north,coast-central,coast-south,inland,sierra}.json
(nps, state-parks and science are covered by their own scripts).

The candidates had guessed coordinates, so this script does not read them.
Every camera below carries hand-checked coordinates, each with a comment on
where the number came from. Cameras whose mount could not be placed within
about 200 m are left out (see LEFT OUT at the bottom).

Run: python3 scripts/sources/hunt.py
Standard library only. Sequential requests with a pause.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
PAUSE = 1.0
TIMEOUT = 15
MAX_BYTES = 2_000_000
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "data", "sources", "hunt.json"))

YT_OEMBED = "https://www.youtube.com/oembed?format=json&url="


def hdot(stream):
    return ("https://portal.hdontap.com/s/embed/?stream=%s&ratio=16:9&fluid=true" % stream)


# Each entry: key (stable, becomes h.<key>), site, name, lat, lng, coords_from,
# kind, image_url, embed_url, page_url, refresh_s, faces, hours, note
CAMERAS = [
    # --- KTVU: terms say "may not be published, broadcast, rewritten, or
    # redistributed", so link only (kind page, no image or embed).
    # Page says the camera is KTVU's rooftop camera in Jack London Square.
    # Coordinates: KTVU studio, 2 Jack London Square (Photon/OSM geocode).
    dict(key="oakland-estuary-ktvu", site="h.oakland-estuary-ktvu",
         name="Oakland Estuary (KTVU rooftop)",
         lat=37.79105, lng=-122.27034,
         coords_from="geocoded landmark (KTVU studio at 2 Jack London Square; page says the camera is on KTVU's roof)",
         kind="page", page_url="https://www.ktvu.com/oakland-estuary-web", refresh_s=None,
         faces="Oakland Estuary and Jack London Square",
         hours=None,
         note="KTVU/FOX terms: material may not be published, broadcast, rewritten or redistributed. Link only."),

    # --- Crescent City Harbor District sunset cam. https version of the snapshot works.
    # The District office is 101 Citizens Dock Rd. Coordinates: Citizens Dock (OSM),
    # the harbor's working dock beside that road. The camera's exact mount is not
    # published, so this is the harbor's center rather than a measured pin.
    dict(key="crescent-city-harbor-sunset", site="h.crescent-city-harbor",
         name="Crescent City Harbor, sunset cam",
         lat=41.74539, lng=-124.18442,
         coords_from="geocoded landmark (Citizens Dock, OpenStreetMap; District office is 101 Citizens Dock Rd)",
         kind="image", image_url="https://s73.ipcamlive.com/streams/49jd9wa0bwzyxldpp/snapshot.jpg",
         embed_url="https://g1.ipcamlive.com/player/player.php?alias=62acf5363decd&autoplay=1&mute=1",
         page_url="https://www.ccharbor.com/sunset-cam", refresh_s=60,
         faces="west over the harbor toward the jetty and the Pacific",
         hours=None,
         note="Run by the Crescent City Harbor District (public agency). Refresh rate is a guess."),

    # --- Caspar Beach RV Park. Coordinates: mapLat/mapLng on the park's own page.
    dict(key="caspar-beach-rv-park", site="h.caspar-beach",
         name="Caspar Beach",
         lat=39.358884, lng=-123.814583,
         coords_from="source page (the park's own map pin)",
         kind="iframe", embed_url="https://rtsp.me/embed/y3hKTZ2k/",
         page_url="https://www.casparbeachrvpark.com/caspar-beach-cam", refresh_s=None,
         faces="Caspar Beach, Mendocino coast; direction not stated",
         hours=None,
         note="Free public cam run by an RV park. Stream not decoded by this check, only the embed page."),

    # --- Monterey Bay Aquarium. Coordinates: OSM node for the aquarium (886 Cannery Row).
    dict(key="monterey-bay-aquarium", site="h.monterey-bay-aquarium",
         name="Monterey Bay Aquarium, Monterey Bay Cam",
         lat=36.61809, lng=-121.90167,
         coords_from="geocoded landmark (Monterey Bay Aquarium, OpenStreetMap; camera is on its ocean-view decks)",
         kind="iframe", embed_url="https://www.youtube.com/embed/fVa6-zCBR7A?autoplay=1&mute=1",
         page_url="https://www.montereybayaquarium.org/cams-videos/live-cams/monterey-bay-cam", refresh_s=None,
         faces="Monterey Bay from the aquarium's ocean-view decks",
         hours="live about 7am-7pm Pacific; a recorded loop runs off-hours",
         yt_id="fVa6-zCBR7A",
         note="Official YouTube embed. Aquarium terms of use give no reuse license."),

    # --- Nepenthe. Coordinates: OSM node for the restaurant (48510 Highway 1). The
    # candidate's guess was about 7 km off.
    dict(key="nepenthe-big-sur", site="h.nepenthe-big-sur",
         name="Nepenthe, Big Sur",
         lat=36.22181, lng=-121.75966,
         coords_from="geocoded landmark (Nepenthe, 48510 Highway 1, OpenStreetMap)",
         kind="image", image_url="https://files.nepenthebigsur.com/camera/b.jpg",
         page_url="https://www.nepenthe.com/live-weather-cam", refresh_s=None,
         faces="Big Sur coastline from the restaurant deck, ridgelines to the ocean",
         hours="dark at night; timestamp burned into the image",
         note="Free public cam from a restaurant."),

    # --- Scripps Pier underwater cam. Camera hangs from a piling about 4 m deep;
    # the page does not say where along the pier. Coordinates: the pier (Wikipedia),
    # which is about 330 m long, so any spot on it is within about 170 m of this.
    dict(key="scripps-pier-underwater", site="h.scripps-pier",
         name="Scripps Pier, underwater",
         lat=32.867, lng=-117.2571,
         coords_from="geocoded landmark (Scripps Pier, Wikipedia; spot on the pier not stated)",
         kind="iframe", embed_url=hdot("scripps_pier-underwater-CUST"),
         page_url="https://coollab.ucsd.edu/pierviz/", refresh_s=None,
         faces="underwater, about 4 m (13 ft) down on a pier piling",
         hours="camera is turned off when items are added to the pilings",
         hd_page=None,
         note="UC San Diego Coastal Ocean Observing Lab page embeds this HDOnTap stream."),

    # --- HDOnTap streams: lat/lng from the JSON-LD GeoCoordinates on each stream's
    # own HDOnTap page (page_url). The free embed is offered on those pages.
    dict(key="hotel-del-coronado-south-beach", site="h.hotel-del-coronado",
         name="Hotel del Coronado, South Beach",
         lat=32.67998, lng=-117.17843,
         coords_from="geocoded landmark (Hotel del Coronado, OpenStreetMap; PTZ is on the south tower)",
         kind="iframe", embed_url=hdot("hdc_hoteldelsouith-4K_ptz-CUST"),
         page_url="https://www.hoteldel.com/live-webcam/", refresh_s=None,
         faces="pan-tilt-zoom over the resort, pool and beach",
         hours=None,
         note="Hotel-run cam hosted by HDOnTap; stream name spelled 'souith' as on the hotel's page."),
    dict(key="manhattan-beach-pier-panoramic", site="h.manhattan-beach-pier",
         name="Manhattan Beach Pier, panoramic",
         lat=33.884292, lng=-118.411378, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("manhattanpierpanoramic_swellmagnet-HDOT"),
         page_url="https://hdontap.com/stream/126730/manhattan-beach-pier-ultra-hd-live-webcam/about",
         refresh_s=None, faces="Manhattan Beach Pier and surf", hours=None, hd_page=True),
    dict(key="manhattan-beach-pier-south", site="h.manhattan-beach-pier",
         name="Manhattan Beach Pier, south",
         lat=33.884298, lng=-118.411177, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("manhattanpier_swellmagnet-HDOT"),
         page_url="https://hdontap.com/stream/405464/manhattan-beach-pier-south-live-webcam/about",
         refresh_s=None, faces="south side of the pier, down the beach", hours=None, hd_page=True),
    dict(key="manhattan-beach-pier-north", site="h.manhattan-beach-pier",
         name="Manhattan Beach Pier, north",
         lat=33.884298, lng=-118.411177, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("swellmagnet_manhattan-pier_north-HDOT"),
         page_url="https://hdontap.com/stream/855798/manhattan-beach-pier-north-live-cam/about",
         refresh_s=None, faces="north side of the pier, up the beach", hours=None, hd_page=True),
    dict(key="el-porto-manhattan-beach", site="h.el-porto",
         name="El Porto Beach, Manhattan Beach",
         lat=33.90277, lng=-118.420865, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("elporto_swellmagnet-HDOT"),
         page_url="https://hdontap.com/stream/256987/el-porto-manhattan-beach-live-webcam/about",
         refresh_s=None, faces="El Porto surf break and beach", hours=None, hd_page=True),
    dict(key="long-beach-harbor", site="h.long-beach-harbor",
         name="Long Beach Harbor",
         lat=33.762177, lng=-118.196509, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("lgbharbor_hdontap-HDOT"),
         page_url="https://hdontap.com/stream/247822/long-beach-harbor-live-webcam/about",
         refresh_s=None, faces="Long Beach harbor, lighthouse and waterfront", hours=None, hd_page=True,
         note="Operator not named on the page."),
    dict(key="dana-point-harbor-laguna-cliffs", site="h.dana-point-harbor",
         name="Dana Point Harbor, Laguna Cliffs Resort",
         lat=33.460726, lng=-117.706631, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("danapoint-harbor_lgm-HDOT"),
         page_url="https://hdontap.com/stream/994481/dana-point-harbor-laguna-cliffs-resort-live-webcam/about",
         refresh_s=None, faces="Dana Point Harbor, resort and Ocean Institute", hours=None, hd_page=True),
    dict(key="la-jolla-shores-hotel-la-jolla", site="h.la-jolla-shores",
         name="La Jolla Shores overlook",
         lat=32.851479, lng=-117.253276, coords_from="source page (HDOnTap GeoCoordinates; matches Hotel La Jolla, 7955 La Jolla Shores Dr)",
         kind="iframe", embed_url=hdot("hotel-la-jolla_ptz-cam-HDOT"),
         page_url="https://hdontap.com/stream/449923/la-jolla-shores-overlook-live-webcam/about",
         refresh_s=None, faces="pan-tilt-zoom over La Jolla Shores beach, surf and Scripps Pier", hours=None, hd_page=True),
    dict(key="carlsbad-seashore-on-the-sand", site="h.carlsbad-state-beach",
         name="Carlsbad State Beach, Seashore On The Sand",
         lat=33.158794, lng=-117.354095, coords_from="source page (HDOnTap GeoCoordinates)",
         kind="iframe", embed_url=hdot("carlsbad_seashoreonthesand-HDOT"),
         page_url="https://hdontap.com/stream/155380/carlsbad-beach-surf-live-webcam/about",
         refresh_s=None, faces="pan-tilt-zoom over Carlsbad State Beach and surf", hours=None, hd_page=True),

    # --- Heavenly Village (The Shops at Heavenly Village). Coordinates: OSM node for
    # the Shops at Heavenly Village. The three cams are all within the village, a
    # block or two across.
    dict(key="heavenly-village-highway-50", site="h.heavenly-village",
         name="Heavenly Village, Highway 50",
         lat=38.95612, lng=-119.94237, coords_from="geocoded landmark (The Shops at Heavenly Village, OpenStreetMap)",
         kind="iframe", embed_url="https://g1.ipcamlive.com/player/player.php?alias=663aa2e1bf523",
         page_url="https://theshopsatheavenly.com/village-web-cams/", refresh_s=None,
         faces="Highway 50 at Heavenly Village, South Lake Tahoe", hours=None, ipcam=True),
    dict(key="heavenly-village-gondola", site="h.heavenly-village",
         name="Heavenly Village, Gondola",
         lat=38.95612, lng=-119.94237, coords_from="geocoded landmark (The Shops at Heavenly Village, OpenStreetMap)",
         kind="iframe", embed_url="https://g1.ipcamlive.com/player/player.php?alias=663aa40c3decb",
         page_url="https://theshopsatheavenly.com/village-web-cams/", refresh_s=None,
         faces="Heavenly gondola area at the village", hours=None, ipcam=True),
    dict(key="heavenly-village-ice-rink", site="h.heavenly-village",
         name="Heavenly Village, ice rink and mini golf",
         lat=38.95612, lng=-119.94237, coords_from="geocoded landmark (The Shops at Heavenly Village, OpenStreetMap)",
         kind="iframe", embed_url="https://g1.ipcamlive.com/player/player.php?alias=663aa5141fa98",
         page_url="https://theshopsatheavenly.com/village-web-cams/", refresh_s=None,
         faces="ice rink and mini golf at the village", hours=None, ipcam=True),

    # --- Sierra-at-Tahoe Plaza. Coordinates: OSM "Base Lodge" node (1111 Sierra-at-Tahoe Rd);
    # the plaza is at the base lodge.
    dict(key="sierra-at-tahoe-plaza", site="h.sierra-at-tahoe-base",
         name="Sierra-at-Tahoe, base plaza",
         lat=38.80031, lng=-120.08054, coords_from="geocoded landmark (Sierra-at-Tahoe Base Lodge, OpenStreetMap)",
         kind="iframe", embed_url="https://www.youtube.com/embed/1-FFKHkaYJE?autoplay=1&mute=1",
         page_url="https://www.sierraattahoe.com/live-cams/", refresh_s=None,
         faces="base plaza; direction not stated", hours="resort hours, mostly winter", yt_id="1-FFKHkaYJE",
         note="Official YouTube embed from the resort's own channel."),

    # --- Mammoth Main Lodge. Coordinates: OSM node "Main Lodge" on Minaret Road.
    dict(key="mammoth-main-lodge", site="h.mammoth-main-lodge",
         name="Mammoth Mountain, Main Lodge",
         lat=37.65095, lng=-119.03717, coords_from="geocoded landmark (Main Lodge, Minaret Road, OpenStreetMap)",
         kind="iframe", embed_url="https://www.youtube-nocookie.com/embed/m4u2kGpkYD4?autoplay=1&mute=1&playsinline=1",
         page_url="https://www.mammothmountain.com/on-the-mountain/mammoth-webcam", refresh_s=None,
         faces="Main Lodge area; direction not stated", hours="resort hours", yt_id="m4u2kGpkYD4",
         note="YouTube channel is 'Mammoth Live Cams', embedded on the resort's official page."),
]

# LEFT OUT (printed in the run summary too)
LEFT_OUT = [
    ("Lawrence Hall of Science View Cam", "duplicate of curated berkeley-hills-lawrence-hall"),
    ("Piedras Blancas seal cam", "covered by the state parks source (video.parks.ca.gov)"),
    ("Santa Barbara Waterfront HarborCam", "Verkada player returned a 512-byte stub, so liveness is unconfirmed; mount not published"),
    ("Lick HamCam 2, SkyCam, All-Sky, APF; Palomar Hale and All-Sky", "duplicates of the observatories source (letter o, o.lick-*, o.palomar-*)"),
    ("Farallon Islands (Cal Academy)", "mount is a lighthouse on Southeast Farallon Island; lighthouse position not confirmed; feed is an interactive queue and all rights reserved"),
    ("Horseshoe Cove, Bodega Marine Lab", "page returns 403 (Cloudflare) to scripts; stream not confirmed; cannot be checked"),
    ("Morro Bay Baycam", "page gives only the office address (601 Embarcadero), not the camera mount"),
    ("SBCC CoachCam East and West", "page says Coach Cam is down for maintenance; which feed is which view is unknown"),
    ("Catalina Avalon (Mt Ada) and Isthmus Cove", "camera mounts not published; only an OSM water tank node for Mt Ada, which is not the camera"),
    ("Big Bear City Airport PTZ", "mount spot on a 1.7 km airfield not published"),
    ("Crestline mtncams", "town-center guess only; mount not published"),
    ("Mount Shasta SnowCam", "page gives mile marker and elevation only"),
    ("Mount Shasta Ski Park summit view", "camera not named on the page; ski area position unconfirmed"),
    ("Sierra-at-Tahoe Grandview and West Bowl", "mid-mountain mounts not published"),
    ("Edgewood Tahoe (EarthCam)", "EarthCam gates embeds (script, not an iframe) and the mount spot in the resort is not published"),
]


def get(url, limit=MAX_BYTES):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        ctype = r.headers.get("Content-Type", "")
        body = r.read(limit)
        return r.status, ctype, body, r.geturl()


def try_get(url):
    time.sleep(PAUSE)
    try:
        return get(url)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), b"", url
    except Exception as e:  # network, timeout, tls
        return 0, str(e)[:80], b"", url


def check(c):
    """Return (check dict, problem string or None)."""
    kind = c["kind"]
    target = c.get("image_url") if kind == "image" else c.get("embed_url") if kind == "iframe" else c["page_url"]
    st, ct, body, final = try_get(target)
    rec = {"at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "status": st, "content_type": ct.split(";")[0].strip(), "bytes": len(body)}
    if st != 200:
        return rec, "GET %s returned %s" % (target, st or ct)
    if kind == "image":
        if not ct.startswith("image/") or len(body) < 2000:
            return rec, "not a real image (%s, %d bytes)" % (ct, len(body))
    elif kind == "iframe":
        if not (ct.startswith("text/html") or "javascript" in ct):
            return rec, "embed is not an HTML page (%s)" % ct
        if c.get("ipcam") and len(body) < 3000:  # bogus ipcamlive aliases return ~1.3 KB
            return rec, "ipcamlive alias looks unknown (%d bytes)" % len(body)
        if "rtsp.me" in target and "/embed/" not in final:
            return rec, "rtsp.me redirected away (%s)" % final
    # extra checks
    if c.get("yt_id"):
        s2, c2, b2, _ = try_get(YT_OEMBED + urllib.parse.quote("https://www.youtube.com/watch?v=" + c["yt_id"], safe=""))
        if s2 != 200:
            return rec, "YouTube oEmbed says %s (video gone or embedding off)" % s2
    if c.get("hd_page"):  # HDOnTap embed shell is identical for bogus names; the stream's own page proves it exists
        s2, c2, b2, _ = try_get(c["page_url"])
        if s2 != 200:
            return rec, "HDOnTap stream page returned %s" % s2
    return rec, None


def main():
    out, dropped = [], []
    seen = set()
    for c in CAMERAS:
        cid = "h." + c["key"]
        assert cid not in seen, cid
        seen.add(cid)
        if c["kind"] != "page" and not (c.get("image_url") or c.get("embed_url")):
            raise SystemExit("bad entry " + cid)
        for k in ("image_url", "embed_url"):
            u = c.get(k)
            if u and u.startswith("http://"):
                raise SystemExit("plain http URL in " + cid)  # mixed content on an https site
        rec, problem = check(c)
        print("%-45s %s" % (cid, problem or "ok %s %s %sB" % (rec["status"], rec["content_type"], rec["bytes"])))
        if problem:
            dropped.append((cid, problem))
            continue
        cam = {
            "id": cid, "site": c["site"], "name": c["name"],
            "lat": c["lat"], "lng": c["lng"], "coords_from": c["coords_from"],
            "kind": c["kind"],
            "image_url": c.get("image_url"), "video_url": None, "embed_url": c.get("embed_url"),
            "page_url": c["page_url"], "refresh_s": c.get("refresh_s"),
            "faces": c.get("faces"), "azimuth": None, "hours": c.get("hours"),
            "check": rec,
        }
        if c.get("note"):
            cam["note"] = c["note"]
        out.append(cam)
    doc = {
        "source": "hunt", "letter": "h",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "provider": "Hand-found public cameras (agencies, universities, nonprofits, businesses)",
        "license": "Each camera stays with its owner. Only free public cameras with no login are listed; "
                   "cameras whose pages bar republishing are links only (kind page).",
        "attribution": "Camera owners as named on each page_url",
        "home": "https://cali.camera",
        "cameras": out,
    }
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=2)
        f.write("\n")
    print("\nwrote %d cameras to %s" % (len(out), OUT))
    if dropped:
        print("\nFAILED the live check, left out:")
        for d in dropped:
            print("  %s: %s" % d)
    print("\nLEFT OUT by hand:")
    for n, why in LEFT_OUT:
        print("  %s: %s" % (n, why))


if __name__ == "__main__":
    main()
