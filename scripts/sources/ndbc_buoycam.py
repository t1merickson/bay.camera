#!/usr/bin/env python3
"""NOAA NDBC BuoyCAM -> data/sources/ndbc-buoycam.json (letter "b")."""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
LIST_URL = "https://www.ndbc.noaa.gov/buoycams.php"
SKIP = {"46026"}  # already curated in data/cameras.json
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "sources", "ndbc-buoycam.json")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get_content_type(), r.read()


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean_name(n):
    # "BODEGA BAY - 48NM NW of San Francisco, CA" -> "Bodega Bay buoy"
    head = n.split(" - ")[0].strip().title()
    return f"{head} buoy"


def main():
    _, _, body = get(LIST_URL)
    stations = json.loads(body)
    cams, left = [], []
    for s in stations:
        sid, lat, lng = str(s["id"]), s["lat"], s["lng"]
        # -126.5 keeps buoys within reach of the coast. 46059 sits at -129.9,
        # about 660 km off San Francisco, and 46006 is further still.
        if not (32.4 <= lat <= 42.1 and -126.5 <= lng < -117):
            continue
        if sid in SKIP:
            left.append((sid, "already curated")); continue
        # NOAA's own list says img: null for stations with no current camera.
        # Their buoycam.php still answers 200 for those, with one identical
        # 14,392-byte placeholder, so the HTTP check alone can't catch them.
        if not s.get("img"):
            left.append((sid, "no image in NOAA's station list (placeholder)")); continue
        url = f"https://www.ndbc.noaa.gov/buoycam.php?station={sid}"
        time.sleep(1)
        try:
            status, ctype, data = get(url)
        except Exception as e:
            left.append((sid, f"fetch failed: {e}")); continue
        if status != 200 or not ctype.startswith("image/"):
            left.append((sid, f"status {status} {ctype}")); continue
        cams.append({
            "id": f"b.{sid}", "site": f"b.{sid}",
            "name": clean_name(s["name"]),
            "lat": lat, "lng": lng,
            "coords_from": "source feed",
            "kind": "image",
            "image_url": url, "video_url": None, "embed_url": None,
            "page_url": f"https://www.ndbc.noaa.gov/station_page.php?station={sid}",
            "refresh_s": 3600,
            "faces": "panorama from the buoy mast",
            "azimuth": None,
            "hours": "daylight",
            "check": {"at": now(), "status": status, "content_type": ctype, "bytes": len(data)},
        })
    out = {
        "source": "ndbc-buoycam", "letter": "b", "generated": now(),
        "provider": "NOAA National Data Buoy Center",
        "license": "Public domain (US federal government work)",
        "attribution": "NOAA NDBC", "home": LIST_URL, "cameras": cams,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2); f.write("\n")
    print(f"wrote {len(cams)} cameras")
    for sid, why in left:
        print(f"left out {sid}: {why}")


if __name__ == "__main__":
    sys.exit(main())
