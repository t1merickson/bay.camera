#!/usr/bin/env python3
"""
Add ground elevation (elev_m) to every camera in data/alertcalifornia-bay.json.

These are peak/ridge webcams, and elevation is the whole point of a lot of
them (fog line, marine layer, "is this above or below the clouds") — but the
ALERTCalifornia API doesn't return it, only lat/lon. Open-Meteo's elevation
endpoint is free, keyless, and backed by Copernicus DEM 90m, which is plenty
of resolution for "how high up is this camera."

Batches coordinates (up to 100 per request, per the API's practical limit) to
keep this to a couple of requests for the whole Bay Area set.

Run:  python3 scripts/enrich-elevations.py
"""
import json
import os
import tempfile
import urllib.parse
import urllib.request
import pathlib

API = "https://api.open-meteo.com/v1/elevation"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
BATCH = 100

DEST = pathlib.Path(__file__).resolve().parent.parent / "data" / "alertcalifornia-bay.json"

def fetch_elevations(coords):
    """coords: list of (lat, lon) -> list of elevation meters, same order."""
    out = []
    for i in range(0, len(coords), BATCH):
        chunk = coords[i:i + BATCH]
        lats = ",".join(str(lat) for lat, _ in chunk)
        lons = ",".join(str(lon) for _, lon in chunk)
        qs = urllib.parse.urlencode({"latitude": lats, "longitude": lons})
        req = urllib.request.Request(f"{API}?{qs}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.load(resp)
        out.extend(data["elevation"])
    return out

def main():
    doc = json.loads(DEST.read_text())
    cams = doc["cameras"]

    coords = [(c["coords"]["lat"], c["coords"]["lon"]) for c in cams]
    elevations = fetch_elevations(coords)
    if len(elevations) != len(cams):
        raise RuntimeError(f"got {len(elevations)} elevations for {len(cams)} cameras")

    for cam, elev in zip(cams, elevations):
        cam["elev_m"] = round(elev)

    doc["elevations_note"] = (
        "elev_m is ground elevation in meters from the Open-Meteo elevation "
        "API (https://open-meteo.com/), backed by Copernicus DEM 90m — not "
        "the camera mount height, and coastal cams may read ~0m."
    )

    fd, tmp_path = tempfile.mkstemp(dir=DEST.parent, prefix=DEST.name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
        os.replace(tmp_path, DEST)
    except Exception:
        os.unlink(tmp_path)
        raise

    print(f"wrote {DEST} — {len(cams)} cameras with elev_m")

if __name__ == "__main__":
    main()
