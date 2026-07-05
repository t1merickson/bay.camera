# data model

`data/cameras.json` is the single source of truth. The page HTML and the map pins both render from it at build time. Edit the data, not the markup.

## vetting rules (a camera qualifies only if all hold)

1. **Free & public-domain-ish.** Already freely viewable — no paywall, no login, no scraping past a gate.
2. **Useful for our purpose.** Shows sky, fog, light, coast, or weather. Not a doorbell pointed at a porch.
3. **Attribution preserved.** The `attribution` field names the owner. If the source asks for credit, that's how we give it.
4. **Donation ask carried forward.** If the source requests donations, fill `donation` — it renders as a small footnote on the block.

When in doubt, `status: "unverified"` and leave it out of the live render until a human or a liveness check confirms it.

## schema

```jsonc
{
  "id": "kebab-case-slug",           // stable, unique; used for anchor links (#id) from map pins
  "name": "Ocean Beach, Kelly's Cove", // human label (renders as .location)
  "region": "san-francisco",         // one of the region slugs below; groups the page + colors the map
  "coords": {                        // for the map pin. null for region-wide feeds (satellite)
    "lat": 37.7750,
    "lng": -122.5130,
    "confidence": "known"            // "known" (landmark/verified) | "approx" (needs a real fix)
  },
  "type": "angelcam",                // vendor key from docs/vendors.md — drives the render wrapper
  "embed": {
    "kind": "image",                 // "image" (still JPEG) | "iframe" (player) | "link" (out only, no embed)
    "src": "https://.../current.jpg",// the asset; for "link" this is null
    "page": "https://source-page/"   // the human page to link the block/pin to
  },
  "attribution": "GJPC, Weather Underground",
  "sources": [                       // extra related links (.source footnotes): timelapse, live, tides
    { "label": "Last 24 hours timelapse", "url": "https://.../current.mp4" }
  ],
  "donation": null,                  // or { "text": "Support this camera", "url": "https://..." }
  "status": "live",                  // "live" | "dead" | "unverified"
  "flags": ["mixed-content"],        // resiliency flags from docs/vendors.md
  "notes": "free-text for humans/agents"
}
```

## regions

Match the old page's geography so nothing feels relocated:

`satellite` · `san-francisco` · `golden-gate` · `north-bay` · `east-bay` · `peninsula` · `south-bay` · `santa-cruz`

## status lifecycle

```
unverified ──(liveness check passes)──> live ──(check fails N times)──> dead
     ^                                                                    │
     └──────────────(re-check / URL updated)──────────────────────────────┘
```

- New crawler finds land as `unverified`.
- A liveness pass (fetch the `src`, expect an image / 200) promotes to `live` or demotes to `dead`.
- `dead` cams are **kept in the file**, not deleted — same instinct as the old commented-out HTML blocks. They're the research history and the re-check queue.
- Only `live` cams render on the page. `dead`/`unverified` stay in data.

## adding cameras (crawler output contract)

Agents return objects in the shape above with `status: "unverified"`. Before anything merges into `cameras.json`, a human/liveness pass confirms the `src` actually loads and isn't a dupe of an existing `id` or `embed.src`. Dedupe on `embed.src` and on `coords` proximity (same building = same cam).
