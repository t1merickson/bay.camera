#!/usr/bin/env python3
"""National Park Service still-image cameras in California -> data/sources/nps.json (letter "n").

Discovery:
  1. Each California park unit's webcam page (nps.gov/<code>/learn/photosmultimedia/webcams.htm)
     lists viewer pages (nps.gov/media/webcam/view.htm?id=...). Each viewer page
     holds the still URL, a status (Active/Inactive), a refresh timer and a description.
  2. The NPS air-quality webcam list (featurecontent/ard/webcams/json/NPSsitelist.txt)
     gives the California air webcams; their stills sit at
     featurecontent/ard/webcams/images/<code>large.jpg.
Coordinates come from NPS "linked data" files (nps.gov/<code>/<code>_linked_data.json),
which list the park's visitor centers and campgrounds with latitude and longitude.
A camera is only written if an NPS page ties it to one of those places (COORD_RULES).

Skipped on purpose: Yosemite Conservancy cameras (usage agreement), live video
(YouTube / explore.org), and stills hosted outside nps.gov.

Python 3 standard library only. Sequential requests with a pause.
"""
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
NPS = "https://www.nps.gov"
PAUSE = 1.0
TIMEOUT = 30
OUT = Path(__file__).resolve().parents[2] / "data" / "sources" / "nps.json"

# California park units whose webcam page we try. Units without a page return 404 and are ignored.
UNITS = {
    "alca": "Alcatraz", "cabr": "Cabrillo", "chis": "Channel Islands", "deva": "Death Valley",
    "goga": "Golden Gate", "jotr": "Joshua Tree", "labe": "Lava Beds", "lavo": "Lassen Volcanic",
    "moja": "Mojave", "pinn": "Pinnacles", "pore": "Point Reyes", "redw": "Redwood",
    "samo": "Santa Monica Mountains", "seki": "Sequoia & Kings Canyon", "whis": "Whiskeytown",
    "yose": "Yosemite", "orca": "Oregon Caves", "muwo": "Muir Woods", "prsf": "Presidio",
    "safr": "San Francisco Maritime", "manz": "Manzanar", "devp": "Devils Postpile", "fopo": "Fort Point",
    "rori": "Rosie the Riveter", "juba": "Juan Bautista de Anza", "piro": "Pinnacles", "cali": "California NHT",
}
SHORT = {"redw": "Redwood", "lavo": "Lassen", "whis": "Whiskeytown", "labe": "Lava Beds",
         "yose": "Yosemite", "pore": "Point Reyes", "seki": "Sequoia"}

# A viewer page the park's webcam page does not link (the Lava Beds page is not at the usual
# path). Found through the NPS viewer search; still confirmed by fetching the viewer page.
EXTRA_VIEWERS = {"labe": ["81B46183-1DD8-B71B-0B44D2EBCDA304A5"]}

# Which NPS place (from the park's linked data) each camera is at, and why we believe it.
# Key: image file stem for viewer cams, "air-<code>" for air-quality cams.
COORD_RULES = {
    "KVC_Pacific_Ocean": ("redw", "Thomas H. Kuchel Visitor Center",
                          "NPS linked data: Thomas H. Kuchel Visitor Center; viewer page says the view is from that visitor center"),
    "Elk_Prairie": ("redw", "Elk Prairie Campground - Prairie Creek Redwoods State Park",
                    "NPS linked data: Elk Prairie Campground, the nearest NPS place to the Elk Prairie view; approximate"),
    "Jed_Smith": ("redw", "Jedediah Smith Campground - Jedediah Smith Redwoods State Park",
                  "NPS linked data: Jedediah Smith Campground; viewer page says the view is from the campground and day use area"),
    "kyvc_webcam1": ("lavo", "Kohm Yah-mah-nee Visitor Center",
                     "NPS linked data: Kohm Yah-mah-nee Visitor Center; viewer page says the view is from that visitor center"),
    "VC-Cam": ("whis", "Whiskeytown Visitor Center",
               "NPS linked data: Whiskeytown Visitor Center; viewer page says the camera is on its roof"),
    "cam42": ("labe", "Lava Beds Visitor Center ",
              "NPS linked data: Lava Beds Visitor Center; viewer page says the webcam looks out from the visitor center"),
    "air-pore": ("pore", "Point Reyes Lighthouse Visitor Center",
                 "NPS linked data: Point Reyes Lighthouse Visitor Center; the park webcam page says the view is from that visitor center"),
    "air-seki": ("seki", "Giant Forest Museum",
                 "NPS linked data: Giant Forest Museum, the nearest NPS place to the Giant Forest edge named on the park webcam page; approximate"),
}
AIR_META = {
    "pore": ("Point Reyes: Lighthouse, beach looking NNE",
             "View of Point Reyes Beach looking north-northeast from the Point Reyes Lighthouse Visitor Center.", 900, None),
    "seki": ("Sequoia: Giant Forest, west view",
             "Looks west from the edge of the Giant Forest.", 900,
             "summer only per the NPS air webcam page"),
}

_last = 0.0


def get(url):
    """GET with a pause. Returns (status, content_type, body, error)."""
    global _last
    wait = PAUSE - (time.time() - _last)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            res = (r.status, r.headers.get("Content-Type", ""), r.read(), None)
    except urllib.error.HTTPError as e:
        res = (e.code, e.headers.get("Content-Type", "") if e.headers else "", e.read() or b"", None)
    except Exception as e:
        res = (None, "", b"", str(e))
    _last = time.time()
    return res


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clean(frag):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", frag or ""))).strip()


def first_sentence(t):
    m = re.match(r"(.+?[.!?])(\s|$)", t)
    return (m.group(1) if m else t).strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def check_image(url):
    s, ct, body, err = get(url)
    c = {"at": now(), "status": s, "content_type": ct or None, "bytes": len(body)}
    if err:
        c["error"] = err
    ok = s == 200 and (ct or "").lower().startswith("image/") and len(body) > 1000
    return c, ok


def main():
    left_out = []
    linked = {}

    def places(code):
        if code not in linked:
            s, _, b, _ = get(f"{NPS}/{code}/{code}_linked_data.json")
            d = json.loads(b.decode("utf-8-sig")) if s == 200 else {}
            linked[code] = {p["name"]: p["geo"] for p in d.get("containsPlace", []) if p.get("geo")}
        return linked[code]

    def coords_for(key):
        rule = COORD_RULES.get(key)
        if not rule:
            return None
        code, place, why = rule
        geo = places(code).get(place)
        if not geo:
            return None
        return round(float(geo["latitude"]), 5), round(float(geo["longitude"]), 5), why

    cams = []

    # 1. Viewer-page cameras
    for code in UNITS:
        s, _, b, _ = get(f"{NPS}/{code}/learn/photosmultimedia/webcams.htm")
        ids = []
        if s == 200:
            page = b.decode("utf-8", "replace")
            for m in re.finditer(r"webcam/view\.htm\?id=([A-Z0-9-]+)", page):
                if m.group(1) not in ids:
                    ids.append(m.group(1))
        for i in EXTRA_VIEWERS.get(code, []):
            if i not in ids:
                ids.append(i)
        for vid in ids:
            vurl = f"{NPS}/media/webcam/view.htm?id={vid}"
            s, _, b, err = get(vurl)
            if s != 200:
                left_out.append((f"{code} viewer {vid}", f"viewer page fetch {s} {err}"))
                continue
            page = b.decode("utf-8", "replace")
            title = clean((re.search(r'<h1 class="page-title">(.*?)</h1>', page, re.S) or [0, ""])[1])
            img = re.search(r'id="webcamRefreshImage"\s*src="([^"]*)"', page)
            img = html.unescape(img.group(1)) if img else ""
            status = (re.search(r"WebcamStatus--(\w+)", page) or [0, ""])[1]
            timer = re.search(r'id="webcamRefreshTimer">(\d+)<', page)
            desc = re.search(r"Description</h2>\s*<p>(.*?)</p>", page, re.S)
            desc = clean(desc.group(1)) if desc else ""
            label = f"{SHORT.get(code, code)}: {title}"
            if status != "Active" or "inactive_webcam" in img:
                left_out.append((label, "viewer page says Inactive (placeholder image)"))
                continue
            if not img.startswith(NPS + "/"):
                host = img.split("/")[2] if img.count("/") >= 2 else img
                left_out.append((label, f"still is hosted outside nps.gov ({host}); no usage terms checked"))
                continue
            stem = img.rsplit("/", 1)[1].rsplit(".", 1)[0]
            c = coords_for(stem)
            if not c:
                left_out.append((label, "no NPS page ties it to a place with coordinates"))
                continue
            chk, ok = check_image(img)
            if not ok:
                left_out.append((label, f"image check failed: {chk}"))
                continue
            faces = re.sub(r"\s*\(Image refreshes[^)]*\)", "", desc).strip()
            cid = f"n.{code}-{slug(stem)}"
            cams.append({
                "id": cid, "site": cid, "name": label,
                "lat": c[0], "lng": c[1], "coords_from": c[2],
                "kind": "image", "image_url": img, "video_url": None, "embed_url": None,
                "page_url": vurl,
                "refresh_s": int(timer.group(1)) if timer else None,
                "faces": first_sentence(faces) if faces else None,
                "azimuth": None, "hours": None, "check": chk,
            })

    # 2. Air-quality webcams
    s, _, b, _ = get(f"{NPS}/featurecontent/ard/webcams/json/NPSsitelist.txt")
    air = [p for p in json.loads(b.decode("utf-8-sig"))["parks"] if p.get("state") == "California"] if s == 200 else []
    for p in air:
        code = p["abbr"]
        img = f"{NPS}/featurecontent/ard/webcams/images/{code}large.jpg"
        page = f"{NPS}/AirWebCams/{code.upper()}"
        if code not in AIR_META:
            left_out.append((f"{p['name']} air webcam", "NPS gives no coordinates or named place for the camera view"))
            continue
        c = coords_for(f"air-{code}")
        if not c:
            left_out.append((f"{p['name']} air webcam", "place coordinates not found"))
            continue
        chk, ok = check_image(img)
        if not ok:
            left_out.append((f"{p['name']} air webcam", f"image check failed: {chk}"))
            continue
        name, faces, refresh, hours = AIR_META[code]
        cid = f"n.{code}-air"
        cams.append({
            "id": cid, "site": cid, "name": name,
            "lat": c[0], "lng": c[1], "coords_from": c[2],
            "kind": "image", "image_url": img, "video_url": None, "embed_url": None,
            "page_url": page, "refresh_s": refresh, "faces": faces,
            "azimuth": None, "hours": hours, "check": chk,
        })

    cams.sort(key=lambda c: c["id"])
    out = {
        "source": "nps",
        "letter": "n",
        "generated": now(),
        "provider": "U.S. National Park Service",
        "license": "Public domain (US federal government work)",
        "attribution": "National Park Service",
        "home": f"{NPS}/subjects/air/webcams.htm",
        "cameras": cams,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(cams)} cameras to {OUT}")
    for c in cams:
        print(f"  {c['id']:28} {c['check']['status']} {c['check']['content_type']} {c['check']['bytes']}")
    for name, why in left_out:
        print(f"  left out: {name}: {why}")


if __name__ == "__main__":
    main()
