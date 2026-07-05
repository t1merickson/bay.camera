#!/usr/bin/env python3
"""
Regenerate data/alertcalifornia-bay.json from the ALERTCalifornia public API.

ALERTCalifornia (UC San Diego / Cal Fire) runs 1,200+ PTZ wildfire cameras
statewide; ~150 sit on Bay Area peaks and make superb marine-layer / fog
vantages. This pulls the public, unauthenticated camera list, filters to the
Bay Area's online Axis cameras (the elevated peak cams — not the re-aggregated
Caltrans CCTV traffic cams), and writes a lightweight layer file.

The image URLs embed a rotating timestamp and expire within ~1-2 minutes, so
this file is a *snapshot in time* — the live site must re-resolve current URLs
by re-running this fetch (client- or edge-side), not by hotlinking these.

Run:  python3 scripts/fetch-alertcalifornia.py
"""
import json, datetime, urllib.request, pathlib

API = "https://ops.alertcalifornia.org/api/getCameraDataByLoc"
IMG_BASE = "https://img.cdn.prod.alertwest.com/data/img"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"

# Bay Area + immediate ring. bbox is the real filter; county names vary in spelling.
def in_bay(lat, lon):
    return 36.85 <= lat <= 38.55 and -123.6 <= lon <= -121.2

def image_url(cam):
    img = cam["img"]                      # e.g. Grizzly_Peak_Overlook_1_1783229894_1725.jpg
    ts = int(img.split("_")[-2])          # unix timestamp baked into the filename
    dt = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)
    return f"{IMG_BASE}/{cam['id']}/{dt:%Y/%m/%d}/{img}"

def main():
    req = urllib.request.Request(API, headers={"User-Agent": UA})
    raw = json.load(urllib.request.urlopen(req, timeout=60))
    locs = {l["id"]: l for l in raw["data"]["locs"]["data"]}
    out = []
    for c in raw["data"]["cams"]["data"]:
        if c.get("off") != 0:            # offline
            continue
        if c.get("cc") != "axis":        # skip re-aggregated Caltrans CCTV etc.
            continue
        loc = locs.get(c.get("lid"))
        if not loc:
            continue
        try:
            lat, lon = float(loc["lat"]), float(loc["lon"])
        except (TypeError, ValueError):
            continue
        if not in_bay(lat, lon):
            continue
        out.append({
            "camId": c["id"],
            "name": c.get("cn", "").replace("_", " "),
            "county": c.get("co", ""),
            "coords": {"lat": lat, "lon": lon},
            "sponsor": c.get("sp", ""),
            "ptz": bool(c.get("ptz")),
            "image_url": image_url(c),    # snapshot — expires in ~1-2 min
        })
    out.sort(key=lambda x: (x["county"], x["name"]))
    dest = pathlib.Path(__file__).resolve().parent.parent / "data" / "alertcalifornia-bay.json"
    doc = {
        "source": "ALERTCalifornia (UC San Diego / Cal Fire), https://alertcalifornia.org/",
        "api": API,
        "note": "Bay Area online Axis peak cameras. image_url is a snapshot that expires in ~1-2 min; re-run this script (or re-poll the API) to refresh. Public-domain / public-safety network.",
        "generated_from_api_at_field": "camScreenshot timestamps; wall-clock not stamped here (regenerate for current URLs)",
        "count": len(out),
        "cameras": out,
    }
    dest.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {dest} — {len(out)} Bay Area peak cameras")

if __name__ == "__main__":
    main()
