#!/usr/bin/env python3
"""Caltrans CCTV cameras that the ALERTCalifornia feed lacks -> data/sources/caltrans-gap.json (letter "c").

Run: python3 scripts/sources/caltrans_gap.py
ID: c.<image folder>, e.g. c.tv102i580westofsr24: the per-camera folder in
Caltrans' own image URL. Not the district feed's "index", which is a list
number nobody promises to keep stable, and these IDs end up in shared links.
Public data. Standard library only.
"""
import json, math, os, re, sys, time, urllib.request, datetime

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "sources", "caltrans-gap.json")
ALERTCA = "https://bay-camera.netlify.app/api/alertca"
MATCH_M = 75
CURATED_M = 60
# Caltrans' own camera code, e.g. TV102 or TVA92, when the name carries one.
TV_CODE = re.compile(r"\bTV[A-Z]?\d+[A-Z]?\b")
# Caltrans gives a compass word; the map wants degrees.
HEADING = {"north": 0, "northeast": 45, "east": 90, "southeast": 135,
           "south": 180, "southwest": 225, "west": 270, "northwest": 315}
PAUSE = 0.15


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.headers.get("Content-Type", ""), r.read()


def dist_m(lat1, lng1, lat2, lng2):
    k = 111320.0
    dy = (lat2 - lat1) * k
    dx = (lng2 - lng1) * k * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def main():
    _, _, body = get(ALERTCA, 60)
    feed = json.loads(body)
    cols = feed["cols"]
    ix = {c: i for i, c in enumerate(cols)}
    known = [(r[ix["lat"]], r[ix["lng"]], r[ix["name"]]) for r in feed["rows"] if r[ix["pr"]] == "CALTRANS"]
    print(f"ALERTCalifornia Caltrans rows: {len(known)}")
    # grid for fast lookup (0.01 degree cells)
    grid = {}
    for lat, lng, name in known:
        grid.setdefault((int(lat * 100), int(lng * 100)), []).append((lat, lng, name))

    def nearby(lat, lng, radius):
        out = []
        cx, cy = int(lat * 100), int(lng * 100)
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                for k in grid.get((cx + a, cy + b), []):
                    d = dist_m(lat, lng, k[0], k[1])
                    if d <= radius:
                        out.append((d, k[2]))
        return sorted(out)

    # Hand-curated cameras in data/cameras.json win over anything generated.
    curated = []
    with open(os.path.join(ROOT, "data", "cameras.json")) as f:
        for cc in json.load(f)["cameras"]:
            co = cc.get("coords") or {}
            if co.get("lat") is not None and co.get("lng") is not None:
                curated.append((co["lat"], co["lng"], cc["id"]))

    total = 0
    matched = []
    new = []
    skipped = {"no coords": 0, "not in service": 0, "no image url": 0, "duplicate key": 0, "already curated": 0}
    kept_on_shared_pole = []
    seen = set()
    for n in range(1, 13):
        url = f"https://cwwp2.dot.ca.gov/data/d{n}/cctv/cctvStatusD{n:02d}.json"
        try:
            _, _, b = get(url, 60)
            data = json.loads(b)["data"]
        except Exception as e:
            print(f"district {n}: FAILED {e}")
            continue
        print(f"district {n}: {len(data)} cameras")
        time.sleep(PAUSE)
        for item in data:
            c = item["cctv"]
            total += 1
            loc = c["location"]
            lat, lng = num(loc.get("latitude")), num(loc.get("longitude"))
            if lat is None or lng is None or (lat == 0 and lng == 0):
                skipped["no coords"] += 1
                continue
            # Already shown via the ALERTCalifornia feed? Within MATCH_M is a
            # match, UNLESS both names carry a Caltrans code and no nearby code
            # agrees: then it's a different camera on the same pole (seen:
            # TVA92 vs TVA93 at 0 m), and it stays.
            close = nearby(lat, lng, MATCH_M)
            if close:
                mine = TV_CODE.search(loc["locationName"] or "")
                theirs = [TV_CODE.search(nm or "") for _, nm in close]
                if mine and all(t is not None for t in theirs) and all(t.group(0) != mine.group(0) for t in theirs):
                    kept_on_shared_pole.append((loc["locationName"], close[0][1], close[0][0]))
                else:
                    matched.append((loc["locationName"], close[0][1], close[0][0]))
                    continue
            if any(dist_m(lat, lng, a, b) <= CURATED_M for a, b, _ in curated):
                skipped["already curated"] += 1
                continue
            if str(c.get("inService")).lower() != "true":
                skipped["not in service"] += 1
                continue
            img = (c.get("imageData", {}).get("static", {}) or {}).get("currentImageURL", "")
            if not img:
                skipped["no image url"] += 1
                continue
            folder = img.rstrip("/").split("/")[-2].lower()
            key = re.sub(r"[^a-z0-9-]", "", folder)
            if key in seen:
                skipped["duplicate key"] += 1
                continue
            seen.add(key)
            video = c["imageData"].get("streamingVideoURL") or None
            # An https page can't load a plain-http stream, so don't offer one.
            if video and not video.startswith("https:"):
                video = None
            freq = num(c["imageData"]["static"].get("currentImageUpdateFrequency"))
            name = loc["locationName"]
            new.append({
                "id": f"c.{key}",
                "site": f"c.{key}",
                "name": name,
                "lat": lat, "lng": lng,
                "coords_from": "source feed",
                "kind": "image",
                "image_url": img,
                "video_url": video,
                "embed_url": None,
                "page_url": "https://cwwp2.dot.ca.gov/vm/streamlist.htm",
                "refresh_s": int(freq * 60) if freq else 300,
                "faces": loc.get("direction") or None,
                "azimuth": HEADING.get(str(loc.get("direction") or "").strip().lower()),
                "hours": None,
            })
    print(f"total listed: {total}; matched within {MATCH_M} m: {len(matched)}; new candidates: {len(new)}")
    for m in matched[:: max(1, len(matched) // 8)][:8]:
        print(f"  match {m[2]:5.1f} m  caltrans: {m[0]!r}  alertca: {m[1]!r}")
    print("skipped before image check:", skipped)
    print(f"kept despite a nearby feed camera (different Caltrans code on a shared pole): {len(kept_on_shared_pole)}")
    for m in kept_on_shared_pole[:6]:
        print(f"  {m[2]:5.1f} m  caltrans: {m[0]!r}  feed: {m[1]!r}")

    ok = []
    failed = {}
    for i, cam in enumerate(new):
        try:
            st, ct, body = get(cam["image_url"], 20)
            if st == 200 and ct.startswith("image/") and len(body) > 500:
                cam["check"] = {"at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "status": st, "content_type": ct, "bytes": len(body)}
                ok.append(cam)
            else:
                failed[f"status {st} {ct} {len(body)}b"] = failed.get(f"status {st} {ct} {len(body)}b", 0) + 1
        except Exception as e:
            k = type(e).__name__ + (f" {getattr(e, 'code', '')}" if hasattr(e, "code") else "")
            failed[k] = failed.get(k, 0) + 1
        time.sleep(PAUSE)
        if (i + 1) % 200 == 0:
            print(f"  checked {i + 1}/{len(new)}", flush=True)
    print(f"image check: {len(ok)} ok, {len(new) - len(ok)} dropped: {failed}")

    out = {
        "source": "caltrans-gap",
        "letter": "c",
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "provider": "Caltrans (California Department of Transportation)",
        "license": "Public data (Caltrans CWWP open data)",
        "attribution": "Caltrans",
        "home": "https://cwwp2.dot.ca.gov/vm/streamlist.htm",
        "notes": (f"Only Caltrans cameras not already shown: no ALERTCalifornia CALTRANS row within {MATCH_M} m "
                  f"(unless both carry different Caltrans TV codes, i.e. two cameras on one pole), and no curated "
                  f"camera within {CURATED_M} m. Key is the camera's image folder in Caltrans' own URL."),
        "cameras": ok,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print("wrote", OUT, len(ok))


if __name__ == "__main__":
    main()
