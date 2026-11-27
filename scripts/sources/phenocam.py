#!/usr/bin/env python3
"""PhenoCam network -> data/sources/phenocam.json (letter "p").

Uses the network's documented API (https://phenocam.nau.edu/api/cameras/).
The API has no state field, so California is picked by coordinates: a bounding
box with the Nevada border cut out. Only sites flagged active whose newest
image is under 45 days old are kept. Every still is checked with a real GET.
"""
import json, os, sys, time, datetime, urllib.request

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
API = "https://phenocam.nau.edu/api/cameras/?format=json&limit=2000"
LATEST = "https://phenocam.nau.edu/data/latest/%s.jpg"
PAGE = "https://phenocam.nau.edu/webcam/sites/%s/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "sources", "phenocam.json")
ATTRIBUTION = ("Data used in this research were provided by the PhenoCam Network, which has been supported by the "
    "Northeastern States Research Cooperative, the National Science Foundation, the Long-Term Agroecosystem "
    "Research (LTAR) network supported by the United States Department of Agriculture, the National Ecological "
    "Observatory Network (NEON) program sponsored by the National Science Foundation and operated under "
    "cooperative agreement by Battelle, the U.S. Department of Energy, Oak Ridge National Laboratory managed by "
    "UT-Battelle, the U.S. National Park Service Inventory and Monitoring Program, the USA National Phenology "
    "Network, and the North Central Climate Science Center of the United States Geological Survey.")
DIRS = {"N": "north", "NNE": "north-northeast", "NE": "northeast", "ENE": "east-northeast", "E": "east",
        "ESE": "east-southeast", "SE": "southeast", "SSE": "south-southeast", "S": "south",
        "SSW": "south-southwest", "SW": "southwest", "WSW": "west-southwest", "W": "west",
        "WNW": "west-northwest", "NW": "northwest", "NNW": "north-northwest"}
AZ = {k: i * 22.5 for i, k in enumerate(["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"])}

def get(url, limit=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read(limit) if limit else r.read()
        return r.status, r.headers.get_content_type(), body

def in_california(lat, lon):
    if not (32.5 <= lat <= 42.05 and -124.5 <= lon <= -114.1):
        return False
    # Nevada border: lon -120 from lat 42 to 39, then diagonal to (35.0, -114.63)
    if lat >= 39.0:
        east = -120.0
    else:
        east = -120.0 + (39.0 - lat) / (39.0 - 35.0) * (120.0 - 114.63)
    return lon <= east

def main():
    _, _, body = get(API)
    rows = json.loads(body)["results"]
    ca = [c for c in rows if in_california(c["Lat"], c["Lon"])]
    now = datetime.datetime.now(datetime.timezone.utc)
    # site grouping: cameras at identical coordinates share one site (first sitename, sorted, of all CA records)
    groups = {}
    for c in sorted(ca, key=lambda c: c["Sitename"]):
        groups.setdefault((round(c["Lat"], 4), round(c["Lon"], 4)), "p." + c["Sitename"])
    cams, left = [], []
    for c in sorted(ca, key=lambda c: c["Sitename"]):
        key = c["Sitename"]
        if not c["active"]:
            left.append((key, "marked inactive")); continue
        last = c.get("date_last")
        if not last or (now.date() - datetime.date.fromisoformat(last)).days > 45:
            left.append((key, "newest image %s (stale)" % last)); continue
        meta = c.get("sitemetadata") or {}
        time.sleep(1)
        url = LATEST % key
        try:
            st, ct, data = get(url)
        except Exception as e:
            left.append((key, "image fetch failed: %s" % e)); continue
        if st != 200 or not ct.startswith("image/") or len(data) < 5000:
            left.append((key, "bad image: %s %s %d bytes" % (st, ct, len(data)))); continue
        o = meta.get("camera_orientation")
        cams.append({
            "id": "p." + key,
            "site": groups[(round(c["Lat"], 4), round(c["Lon"], 4))],
            "name": (meta.get("site_description") or key).strip(),
            "lat": c["Lat"], "lng": c["Lon"],
            "coords_from": "source feed",
            "kind": "image",
            "image_url": url, "video_url": None, "embed_url": None,
            "page_url": PAGE % key,
            "refresh_s": 1800,
            "faces": ("Faces " + DIRS[o]) if o in DIRS else None,
            "azimuth": AZ.get(o),
            "hours": None,
            # PhenoCam's fair-use terms ask for each site's own acknowledgment
            # alongside the network credit in the file's "attribution".
            "credit": " ".join((meta.get("site_acknowledgements") or "").split()) or None,
            "check": {"at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "status": st, "content_type": ct, "bytes": len(data)},
        })
    out = {
        "source": "phenocam", "letter": "p",
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "provider": "PhenoCam Network (Northern Arizona University)",
        "license": "CC BY 4.0",
        "attribution": ATTRIBUTION,
        "home": "https://phenocam.nau.edu/",
        "cameras": cams,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False); f.write("\n")
    print("wrote %d cameras, left out %d" % (len(cams), len(left)))
    for k, why in left:
        print("  left out %s: %s" % (k, why))

if __name__ == "__main__":
    main()
