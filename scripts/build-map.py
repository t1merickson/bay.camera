#!/usr/bin/env python3
"""
Project the Bay Area county outlines into a fixed-viewBox SVG and write
src/lib/basemap.json (county paths + projection params).

Web Mercator with a UNIFORM scale, so a camera pin projected with the same
params (see src/lib/project.ts) lands exactly on the geography. Minimal
outline, not art — layers (pins, fog) sit on top.

Run:  python3 scripts/build-map.py
"""
import json, math, pathlib

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "ca-counties.geojson"
DEST = HERE.parent / "src" / "lib" / "basemap.json"

# The Bay Area + the coastal strip our cameras cover (down to Santa Cruz).
BAY = {
    "Alameda", "Contra Costa", "Marin", "Napa", "San Francisco",
    "San Mateo", "Santa Clara", "Solano", "Sonoma", "Santa Cruz",
}

W, PAD, ROUND = 1000, 24, 1

def merc_y(lat): return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
def merc_x(lon): return math.radians(lon)

def rings(geom):
    """Yield each linear ring (list of [lon,lat]) from Polygon/MultiPolygon."""
    t = geom["type"]; c = geom["coordinates"]
    if t == "Polygon":
        yield from c
    elif t == "MultiPolygon":
        for poly in c:
            yield from poly

def main():
    fc = json.loads(SRC.read_text())
    feats = [f for f in fc["features"] if f["properties"].get("name") in BAY]
    assert feats, "no Bay Area counties matched"

    # bbox in projected units
    xs, ys = [], []
    for f in feats:
        for ring in rings(f["geometry"]):
            for lon, lat in ring:
                xs.append(merc_x(lon)); ys.append(merc_y(lat))
    Xmin, Xmax, Ymin, Ymax = min(xs), max(xs), min(ys), max(ys)
    s = (W - 2 * PAD) / (Xmax - Xmin)
    H = round((Ymax - Ymin) * s + 2 * PAD, 1)

    def px(lon): return round(PAD + (merc_x(lon) - Xmin) * s, ROUND)
    def py(lat): return round(PAD + (Ymax - merc_y(lat)) * s, ROUND)

    counties = []
    for f in feats:
        parts = []
        for ring in rings(f["geometry"]):
            pts = [f"{px(lon)},{py(lat)}" for lon, lat in ring]
            parts.append("M" + "L".join(pts) + "Z")
        counties.append({"name": f["properties"]["name"], "path": "".join(parts)})

    # Crop the viewBox to frame where the cameras actually are (they cluster in
    # the SF Bay core and south; the northern county land is mostly empty).
    cams = json.loads((HERE.parent / "data" / "cameras.json").read_text())["cameras"]
    ys = [py(c["coords"]["lat"]) for c in cams
          if c.get("coords") and c.get("status") != "dead"]
    xs = [px(c["coords"]["lng"]) for c in cams
          if c.get("coords") and c.get("status") != "dead"]
    M = 46  # margin around the pin cloud
    vx = max(0, min(xs) - M)
    vw = min(W, max(xs) + M) - vx
    vy = max(0, min(ys) - M)
    vh = min(H, max(ys) + M) - vy
    view = f"{round(vx,1)} {round(vy,1)} {round(vw,1)} {round(vh,1)}"

    doc = {
        "viewBox": view,
        "width": round(vw, 1), "height": round(vh, 1),
        "fullWidth": W, "fullHeight": H,
        "proj": {"pad": PAD, "s": s, "Xmin": Xmin, "Ymax": Ymax},
        "counties": counties,
    }
    DEST.write_text(json.dumps(doc, ensure_ascii=False) + "\n")
    print(f"wrote {DEST} — {len(counties)} counties, viewBox 0 0 {W} {H}")

if __name__ == "__main__":
    main()
