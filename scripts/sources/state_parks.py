#!/usr/bin/env python3
"""California State Parks live video -> data/sources/state-parks.json (letter "s").

Finds camera subpages from the gallery at parks.ca.gov/?page_id=29480, reads
each subpage for its HLS URL, gets park coordinates from the park's own page on
parks.ca.gov (the "daddr=lat,lng" directions link), and checks each playlist
with a GET. Cameras whose playlist fails stay in the file with the failure in
`check`, because some only stream during posted hours.

Python 3 standard library only. Sequential requests with a pause.
"""
import html
import json
import re
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
GALLERY = "https://www.parks.ca.gov/?page_id=29480"
PAGE = "https://www.parks.ca.gov/?page_id={}"
PAUSE = 1.0
TIMEOUT = 25
OUT = Path(__file__).resolve().parents[2] / "data" / "sources" / "state-parks.json"

# Which park page holds the coordinates for each stream folder (first path
# segment of the HLS URL). Page IDs are parks.ca.gov park pages; the script
# reads the coordinates from them at run time.
PARKS = {
    "Hearst": ("hearst-san-simeon", 590, "Hearst San Simeon State Park"),
    "HearstSealcamNorth": ("hearst-san-simeon", 590, "Hearst San Simeon State Park"),
    "HearstMotel": ("hearst-san-simeon", 590, "Hearst San Simeon State Park"),
    "PoppyReserve": ("poppy-reserve", 627, "Antelope Valley California Poppy Reserve SNR"),
    "Mono": ("mono-lake", 514, "Mono Lake Tufa State Natural Reserve"),
    "Seacliff": ("seacliff", 543, "Seacliff State Beach"),
    "PointLobos": ("point-lobos", 571, "Point Lobos State Natural Reserve"),
    "OrovilleDamTop": ("lake-oroville", 462, "Lake Oroville State Recreation Area"),
    "OrovilleForebay": ("lake-oroville", 462, "Lake Oroville State Recreation Area"),
    "Oroville": ("lake-oroville", 462, "Lake Oroville State Recreation Area"),
    "AnoNuevo": ("ano-nuevo", 523, "Año Nuevo State Park"),
    "TuleElk": ("tule-elk", 584, "Tule Elk State Natural Reserve"),
}

# Gallery omits some subpages from its links; these are leads the gallery
# itself may not link. They are kept only if the page really holds a stream.
EXTRA_LEADS = [31947, 31197]

_last = 0.0


def get(url, accept_any=True):
    """GET with a pause. Returns (status, content_type, body_bytes, error)."""
    global _last
    wait = PAUSE - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            body = r.read()
            res = (r.status, r.headers.get("Content-Type", ""), body, None)
    except urllib.error.HTTPError as e:
        res = (e.code, e.headers.get("Content-Type", "") if e.headers else "", e.read() or b"", None)
    except Exception as e:  # timeout, DNS, etc.
        res = (None, "", b"", str(e))
    _last = time.time()
    return res


def text_of(frag):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frag))).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def main():
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    status, _, body, err = get(GALLERY)
    if status != 200:
        sys.exit(f"gallery fetch failed: {status} {err}")
    gallery = body.decode("utf-8", "replace")
    ids = []
    for m in re.finditer(r"page_id=(\d+)", gallery, re.I):
        n = int(m.group(1))
        if n not in ids:
            ids.append(n)
    # Only ids in the camera range; other page_id links are site navigation.
    # Every candidate is still confirmed by finding a stream URL on its page.
    cand = [n for n in ids if 31000 <= n < 33000] + [n for n in EXTRA_LEADS if n not in ids]

    cams = []
    skipped = []
    coord_cache = {}
    for pid in cand:
        status, _, body, err = get(PAGE.format(pid))
        if status != 200:
            skipped.append((pid, f"page fetch {status} {err}"))
            continue
        page = body.decode("utf-8", "replace")
        m = re.search(r"https://video\.parks\.ca\.gov/([A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+)/playlist\.m3u8", page)
        if not m:
            skipped.append((pid, "no stream URL on page"))
            continue
        video_url = m.group(0)
        folder, stream = m.group(1), m.group(2).replace(".stream", "")
        t = re.search(r"<title>(.*?)</title>", page, re.S)
        name = text_of(t.group(1)) if t else str(pid)
        name = re.sub(r"\s*\|\s*California State Parks\s*$", "", name)

        if folder not in PARKS:
            skipped.append((pid, f"no park mapping for stream folder {folder}"))
            continue
        site_key, park_pid, park_name = PARKS[folder]
        if park_pid not in coord_cache:
            ps, _, pb, perr = get(PAGE.format(park_pid))
            pm = re.search(r"daddr=(-?\d+\.\d+),(-?\d+\.\d+)", pb.decode("utf-8", "replace")) if ps == 200 else None
            coord_cache[park_pid] = (float(pm.group(1)), float(pm.group(2))) if pm else None
        coords = coord_cache[park_pid]
        if not coords:
            skipped.append((pid, f"no coordinates on park page {park_pid}"))
            continue

        # Text the pages state about the camera (only a few have any).
        lead = re.search(r'class="lead"[^>]*>(.*?)</p>', page, re.S)
        desc = text_of(lead.group(1)) if lead else None
        if not desc:
            bm = re.search(r"<p[^>]*>(The [^<]*camera[^<]*)</p>", page)
            desc = text_of(bm.group(1)) if bm else None
        hours = None
        blob = (desc or "") + " " + text_of(re.sub(r"<script.*?</script>", "", page, flags=re.S))
        hm = re.search(r"live from (\d{1,2}(?::\d\d)?\s*[ap]m)\s*[-–to]+\s*(\d{1,2}(?::\d\d)?\s*[ap]m)", blob, re.I)
        if hm:
            hours = f"live {hm.group(1)}-{hm.group(2)} (Pacific, per camera page)"
        nm = re.search(r"Notice:\s*(.{10,200}?(?:recharge|offline).*?\.)", blob)
        if nm and not hours:
            hours = nm.group(1).strip()
        faces = desc.split(". ")[0].rstrip(".") if desc else None

        cs, ctype, cbody, cerr = get(video_url)
        check = {
            "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": cs,
            "content_type": ctype or None,
            "bytes": len(cbody),
        }
        if cerr:
            check["error"] = cerr
        live = cs == 200 and "mpegurl" in (ctype or "").lower()
        if not live:
            print(f"  NOT LIVE now: {name} -> {cs} {ctype} {cerr or ''}", file=sys.stderr)

        cid = f"s.{slug(folder + '-' + stream)}"
        cams.append({
            "id": cid,
            "site": f"s.{site_key}",
            "name": name,
            "lat": coords[0], "lng": coords[1],
            "coords_from": f"source page: park page for {park_name} on parks.ca.gov (page_id={park_pid}, directions point); "
                           "park-level, not the camera's exact spot",
            "kind": "video",
            "image_url": None,
            "video_url": video_url,
            "embed_url": None,
            "page_url": PAGE.format(pid),
            "refresh_s": None,
            "faces": faces,
            "azimuth": None,
            "hours": hours,
            "check": check,
        })

    # Where the camera actually is, for cameras the park-level point misplaces.
    # Looked up on OpenStreetMap (Nominatim), 27 Nov 2026. The park "directions"
    # point is the entrance, which put the Piedras Blancas seal cams 15 km
    # south of the rookery and all three Oroville cams on one spot.
    # (lat, lng, site, where the point came from)
    PLACED = {
        "s.hearst-piedras": (35.66350, -121.2584, "s.piedras-blancas-rookery", "OpenStreetMap: Elephant Seal Vista Point"),
        "s.hearstsealcamnorth-northbeach": (35.66350, -121.2584, "s.piedras-blancas-rookery", "OpenStreetMap: Elephant Seal Vista Point (north beach of the same rookery)"),
        "s.hearstmotel-lighthouse": (35.66597, -121.2834, None, "OpenStreetMap: Piedras Blancas Motel; the stream folder names the motel as the mount"),
        "s.anonuevo-island": (37.10829, -122.3368, None, "OpenStreetMap: Año Nuevo Island (islet)"),
        "s.pointlobos-whalerscove": (36.51996, -121.9385, None, "OpenStreetMap: Whalers Cove"),
        "s.oroville-visitorcenter": (39.53506, -121.4668, None, "OpenStreetMap: Lake Oroville Visitor Center"),
        "s.orovilledamtop-spillwaytop": (39.53719, -121.4855, None, "OpenStreetMap: Oroville Dam"),
        "s.orovilleforebay-orovilleforebay": (39.52399, -121.6156, None, "OpenStreetMap: Thermalito Forebay (reservoir centre; approximate)"),
    }
    for c in cams:
        if c["id"] in PLACED:
            lat, lng, site, where = PLACED[c["id"]]
            c["lat"], c["lng"], c["coords_from"] = lat, lng, where
            c["site"] = site or c["id"]

    # A site with one camera uses that camera's id as its site value.
    counts = {}
    for c in cams:
        counts[c["site"]] = counts.get(c["site"], 0) + 1
    for c in cams:
        if counts[c["site"]] == 1:
            c["site"] = c["id"]
    cams.sort(key=lambda c: c["id"])

    out = {
        "source": "state-parks",
        "letter": "s",
        "generated": now,
        "provider": "California State Parks",
        "license": "No license stated on the camera pages; California State Parks public live video",
        "attribution": "California State Parks",
        "home": GALLERY,
        "cameras": cams,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(cams)} cameras to {OUT}")
    for pid, why in skipped:
        print(f"  left out page_id={pid}: {why}")
    for c in cams:
        print(f"  {c['id']:34} {c['check']['status']} {c['check']['content_type']}")


if __name__ == "__main__":
    main()
