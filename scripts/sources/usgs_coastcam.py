#!/usr/bin/env python3
"""USGS CoastCam (California stations) -> data/sources/usgs-coastcam.json (letter "u").

Station folders were taken from the USGS PCMSC webcams pages, which link
cameras/<station>/latest/c<N>_snap.jpg. USGS publishes no coordinates for
these stations on pages we could reach, so coordinates are geocoded landmarks.
Station "rincon" is Rincon, Puerto Rico (Tres Palmas), not California: excluded.
"""
import json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
BASE = "https://cmgp-coastcam.s3-us-west-2.amazonaws.com/cameras"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "sources", "usgs-coastcam.json")
SC = "https://www.usgs.gov/centers/pcmsc/science/using-video-imagery-study-coastal-change-santa-cruz-beaches"
SS = "https://www.usgs.gov/centers/pcmsc/science/using-video-imagery-study-coastal-change-sunset-state-beach"

# station folder -> (site name, lat, lng, page, [(camera, view name, faces, azimuth)])
STATIONS = {
    "dreaminn": ("Santa Cruz Dream Inn", 36.9566, -122.0251, SC, [
        ("c1", "Santa Cruz Main Beach", "east, over Main Beach and the Boardwalk", 90),
        ("c2", "Santa Cruz Cowells Beach", "south, over Cowells Beach", 180)]),
    "sunset": ("Sunset State Beach", 36.8918, -121.8330, SS, [
        ("c1", "Sunset State Beach, camera 1", "northwest", 315),
        ("c2", "Sunset State Beach, camera 2", "north", 0)]),
}


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get_content_type(), r.read()


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    cams, left = [], []
    for st, (_, lat, lng, page, views) in STATIONS.items():
        for cam, name, faces, az in views:
            url = f"{BASE}/{st}/latest/{cam}_snap.jpg"
            time.sleep(1)
            try:
                status, ctype, data = get(url)
            except Exception as e:
                left.append((f"{st}.{cam}", f"fetch failed: {e}")); continue
            if status != 200 or not ctype.startswith("image/"):
                left.append((f"{st}.{cam}", f"status {status} {ctype}")); continue
            cams.append({
                "id": f"u.{st}.{cam}", "site": f"u.{st}",
                "name": name, "lat": lat, "lng": lng,
                "coords_from": "geocoded landmark",
                "kind": "image",
                "image_url": url, "video_url": None, "embed_url": None,
                "page_url": page,
                "refresh_s": 1800,
                "faces": faces, "azimuth": az,
                "hours": "daylight, about every 30 minutes",
                "check": {"at": now(), "status": status, "content_type": ctype, "bytes": len(data)},
            })
    out = {
        "source": "usgs-coastcam", "letter": "u", "generated": now(),
        "provider": "USGS Pacific Coastal and Marine Science Center",
        "license": "Public domain (US federal government work)",
        "attribution": "USGS",
        "home": "https://www.usgs.gov/programs/cmhrp/science/usgs-coastcams",
        "cameras": cams,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2); f.write("\n")
    print(f"wrote {len(cams)} cameras")
    for k, why in left:
        print(f"left out {k}: {why}")


if __name__ == "__main__":
    sys.exit(main())
