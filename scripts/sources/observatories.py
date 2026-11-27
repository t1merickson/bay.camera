#!/usr/bin/env python3
"""Lick and Palomar observatory webcams -> data/sources/observatories.json (letter "o").

Hand-listed fixed-URL stills; neither observatory has a feed. Every still is
checked with a real GET and left out if it fails.
"""
import json, os, time, datetime, urllib.request

UA = "Mozilla/5.0 (Macintosh) Chrome/130"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "sources", "observatories.json")

# Neither observatory publishes coordinates on its webcam pages; these are the
# standard published landmark positions (Wikipedia / Wikidata).
LICK = dict(site="o.lick", lat=37.3414, lng=-121.6429)
PALOMAR = dict(site="o.palomar", lat=33.3564, lng=-116.8650)
LICK_PAGE = "https://mthamilton.ucolick.org/hamcam/"
PAL_PAGE = "https://www.astro.caltech.edu/palomar/media/livecams.html"

CAMS = [
    # lick-hamcam1 left out: already curated as lick-observatory-west in data/cameras.json.
    dict(key="lick-hamcam2", name="Lick Observatory, Hamcam 2", loc=LICK,
         img="https://mthamilton.ucolick.org/hamcam/Cam2.ts.JPG", page=LICK_PAGE + "hamcam2.html",
         refresh=180, faces="Faces east-northeast, toward the summit domes (Shane 3-m, Crocker, APF)", az=67.5, hours=None),
    # lick-apfcam left out: its page says unauthorized use is expressly forbidden.
    dict(key="lick-allsky", name="Lick Observatory, all-sky camera", loc=LICK,
         img="https://mthamilton.ucolick.org/skycam2/current.jpg", page="https://mthamilton.ucolick.org/skycam2/",
         refresh=120, faces="Straight up (all-sky fisheye)", az=None,
         hours="Built for night sky; daytime frames can be washed out"),
    dict(key="palomar-hale-west", name="Palomar Observatory, Hale Telescope webcam", loc=PALOMAR,
         img="https://algol.palomar.caltech.edu/instruments/p200webcam/P200WestWebcam.jpg", page=PAL_PAGE,
         refresh=300, faces="Inside the Hale 200-inch dome; file name says west. Nearly black at night",
         az=None, hours="Best by day and at twilight"),
    dict(key="palomar-allsky", name="Palomar Observatory, all-sky camera", loc=PALOMAR,
         img="https://algol.palomar.caltech.edu/instruments/allsky/AllSkyCurrentImage.JPG", page=PAL_PAGE,
         refresh=300, faces="Straight up (all-sky); Hale dome sits at top right, to the north-northwest", az=None,
         hours="Built for night sky; daytime frames can be washed out"),
]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.headers.get_content_type(), r.read()

def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def main():
    cams, left = [], []
    for i, c in enumerate(CAMS):
        if i:
            time.sleep(1)
        try:
            st, ct, data = get(c["img"])
        except Exception as e:
            left.append((c["key"], str(e))); continue
        if st != 200 or not ct.startswith("image/") or len(data) < 5000:
            left.append((c["key"], "bad image: %s %s %d bytes" % (st, ct, len(data)))); continue
        cams.append({
            "id": "o." + c["key"], "site": c["loc"]["site"], "name": c["name"],
            "lat": c["loc"]["lat"], "lng": c["loc"]["lng"],
            "coords_from": "geocoded landmark",
            "kind": "image", "image_url": c["img"], "video_url": None, "embed_url": None,
            "page_url": c["page"], "refresh_s": c["refresh"],
            "faces": c["faces"], "azimuth": c["az"], "hours": c["hours"],
            "check": {"at": now(), "status": st, "content_type": ct, "bytes": len(data)},
        })
    out = {
        "source": "observatories", "letter": "o", "generated": now(),
        "provider": "Lick Observatory (UC Observatories) and Palomar Observatory (Caltech)",
        "license": "Images are the observatories' own. Lick's APFCam page says images are copyright University of California Observatories / Lick Observatory, unauthorized use forbidden.",
        "attribution": "Lick Observatory / University of California Observatories; Palomar Observatory / Caltech",
        "home": "https://mthamilton.ucolick.org/hamcam/",
        "cameras": cams,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False); f.write("\n")
    print("wrote %d cameras, left out %d" % (len(cams), len(left)))
    for k, why in left:
        print("  left out %s: %s" % (k, why))

if __name__ == "__main__":
    main()
