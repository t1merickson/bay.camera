#!/usr/bin/env python3
"""Great Basin Unified APCD air-quality cameras -> data/sources/gbuapcd.json (letter "g").

Coordinates: the district's public ArcGIS feature service behind its camera map
(gbuapcd.org/AirMonitoringData/AirQualityCameras/Map). Image: each camera's viewer page
names a stable file that always holds the latest still, under /cameras/.
Run: python3 scripts/sources/gbuapcd.py
"""
import json, os, re, time, datetime, urllib.request, urllib.parse

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "sources", "gbuapcd.json")
FS = ("https://services8.arcgis.com/0TgZAtU5omizWGob/arcgis/rest/services/Dust_Cams/FeatureServer/0/query"
      "?where=1%3D1&outFields=*&outSR=4326&f=json")
BASE = "https://www.gbuapcd.org"
PAUSE = 0.5


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    feats = json.loads(get(FS)[2])["features"]
    print("map features:", len(feats))
    cams, dropped = [], []
    for f in feats:
        a, g = f["attributes"], f.get("geometry") or {}
        link = a.get("PublicWebLink") or ""
        q = urllib.parse.urlparse(link).query
        site = urllib.parse.unquote_plus(q.split("=")[0]) if q else None
        if not site or "x" not in g:
            dropped.append((a.get("CameraID"), "no site name or geometry"))
            continue
        time.sleep(PAUSE)
        try:
            page = get(link)[2].decode("utf-8", "replace")
            m = re.search(r'<img id="[^"]+" src="(/cameras/[^"?]+\.jpg)', page)
            if not m:
                dropped.append((site, "no latest-image path on viewer page"))
                continue
            path = m.group(1)
            img = BASE + urllib.parse.quote(path)
            time.sleep(PAUSE)
            st, ct, body = get(img)
            if st != 200 or not ct.startswith("image/") or len(body) < 500:
                dropped.append((site, f"image check {st} {ct} {len(body)}b"))
                continue
        except Exception as e:
            dropped.append((site, f"{type(e).__name__} {e}"))
            continue
        key = re.sub(r"[^a-z0-9]+", "-", site.lower()).strip("-")
        place = re.sub(r"[^a-z0-9]+", "-", re.sub(r"\s+(C|V)?\d$", "", site).lower()).strip("-")
        cams.append({
            "id": f"g.{key}",
            "site": f"g.{place}",
            "name": f"{a['CameraID']} (GBUAPCD)",
            "lat": round(g["y"], 6), "lng": round(g["x"], 6),
            "coords_from": "source feed",
            "kind": "image",
            "image_url": img,
            "video_url": None,
            "embed_url": None,
            "page_url": link,
            "refresh_s": 60,
            "faces": f"{a['Dir']:g} deg, {a['FieldOfView']:g} deg field of view" if a.get("Dir") is not None else None,
            "azimuth": a.get("Dir"),
            "hours": "daylight only",
            "check": {"at": now(), "status": st, "content_type": ct, "bytes": len(body)},
        })
    for d in dropped:
        print("left out:", d)
    print("written:", len(cams))
    out = {
        "source": "gbuapcd", "letter": "g", "generated": now(),
        "provider": "Great Basin Unified Air Pollution Control District",
        "license": "Public agency web content; no license stated",
        "attribution": "Great Basin Unified APCD",
        "home": f"{BASE}/cgi-bin/cameraViewer",
        "notes": ("image_url is a stable file that always holds the latest still (overwritten about every minute, "
                  "cache-bust with ?t=). Today's timestamped frames are listed at /cgi-bin/camerasToday?siteName=<name>, "
                  "newest is the last <img>; not needed. Coordinates are per site from the district's ArcGIS camera map; "
                  "sites with no map point (Lone Pine East/West, NCORE, Olancha North/West, Lee Vining Ridge C1) are omitted."),
        "cameras": cams,
    }
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
