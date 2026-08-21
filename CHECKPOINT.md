# CHECKPOINT — bay.camera

State that only ever existed in conversation. The repo, the diffs and RESUME.md
cover what the code does; this covers what it was like to be mid-problem.
Last written 12 Aug 2026, ~11pm, at commit 3d2eb9f.

## Now

Deployed and live at https://bay-camera.netlify.app/, auto-deploying on every
push to `master`. Build work is finished for the moment. What's blocking is
Tim's eyes on three design questions I can't answer for him. Clean tree, nothing
in flight.

## Plates

- **Night magenta intensity** — viewable *right now* (needs dark, and it's dark).
  Tim has never actually looked at it. Question: is the Night Microphysics
  magenta too loud over the dark basemap? Fix would be an opacity drop or
  desaturating through the fogtone pipeline. The only plate actionable tonight.
- **Amber end of the Weather Line palette** — unverified after two attempts.
  Needs an inland spot (Livermore, Walnut Creek) in *afternoon* daylight; after
  dark every icon is a moon regardless. Livermore read 78° at 10pm, so the data
  is flowing — just no sun.
- **Predictive fog card** — proposed (coast-inland temperature gradient plus
  coastal dew-point spread as "fog likely tonight"), awaiting a verdict. It
  changes the card from reporting what is to guessing what's next, which is why
  I didn't just build it.
- **Multi-region refactor** — I proposed it, Tim never said yes or no; he pivoted
  to hosting instead. Estimate and confidence in Live wires.
- **COMPACTED.md → RESUME.md** — offered to fold its error ledger into RESUME and
  delete the file. No answer. Now gitignored, so it's inert either way.
- **Domain** — Tim said "forget buying a domain," and separately that he's still
  considering asking gongruya for bay.camera back. Nothing to do until he decides.

## Terrain

- **`timeout` does not exist on macOS** (it's `gtimeout`, from coreutils). A loop
  using it fails silently every iteration and returns empty output that reads
  exactly like a network failure. Cost a full tool call tonight.
- **macOS `whois` is unreliable for newer TLDs.** For `.camera` it stops at IANA
  (that TLD's `refer:` field is empty) and returns the *registry* record — so
  every domain looks taken, with creation date 2013-10-31 and a blank registrar.
  Use `dig +short NS <domain>` instead, and always control-test against a domain
  you know is registered before trusting any result.
- **puppeteer-core scripts must live inside the repo**, not `/tmp` — Node module
  resolution fails with ERR_MODULE_NOT_FOUND otherwise. Write to
  `scripts/.something-tmp.mjs` and delete after.
- **Chrome MCP extension was not connected this session.** Fell back to
  puppeteer-core driving real Chrome; fine for state checks.
- **`astro preview` ignores `vite.preview.proxy`** for static output — it serves
  files with its own server. So `/api/alertca` 404s under preview while working
  in `astro dev` and on Netlify. Don't diagnose a proxy bug from a preview 404.
- **Netlify edge caching is per-location.** Repeat requests interleave `stored`
  and `hit` because they land on different edge nodes, each holding its own copy.
  That is normal, not broken caching.
- Deploy is roughly 50-60 seconds from push to live.
- **There is no `tsconfig.json` in this repo.** Any earlier claim that "tsc strict
  passed" used explicit CLI flags, not a project config.

## Decided

- **Netlify free tier at `bay-camera.netlify.app`.** The config already existed
  and was correct, and it's the only free host that proxies to an external origin
  without extra code. GitHub Pages was disqualified outright.
- **No new domain** (Tim's call, explicit). The product stays *named* bay.camera
  on every user-facing surface; only `astro.config.mjs`'s `site` points at the
  Netlify subdomain. The host is temporary, the name isn't.
- **Rewrote the 15 unpushed commits' author email** instead of pushing them. They
  carried `hey@timerickson.com` onto a public repo, which his rules forbid. Files
  verified byte-identical afterward; backup branch deleted once checked.
- **Edge function owns `/api/alertca`; the netlify.toml redirect stays as fallback**
  via `context.next()`. I deployed the function to a throwaway path first
  specifically because the upstream firewall might reject Deno's TLS fingerprint.
  It doesn't — that block only targets browsers.
- **`COMPACTED.md` gitignored, not committed.** It's a point-in-time dump;
  RESUME.md is the maintained doc.

## Discards

- **Buying any domain** — killed by Tim directly. Worth keeping because the
  research was real: `fog.camera` is genuinely *available* (control-tested, not
  guessed) and was my recommendation. Also free: `haar.camera`,
  `inversion.camera`, `stratus.camera`, `marine.camera`, `foglift.co`,
  `fogcast.co`. Why each lost, in case one deserves un-killing — `haar`: North
  Sea word for a Pacific product, and reads as "hair" in German and Dutch (still
  the best name on pure craft); `inversion`: truest to what we actually measure,
  but sounds like a photography technique; `stratus`: correct cloud genus, but
  cloud-computing branding owns the word. Before buying `fog.camera` someone must
  check price — short generic words on Binky Moon TLDs are often premium-tiered,
  so it could be $30 or $3,000. WHOIS won't tell you; a registrar will.
- **`marinelayer.*`** — Marine Layer is an SF clothing company. Trademark
  collision in our own city.
- **`karl.*`** — Bay-specific, so it contradicts multi-region, and it's an
  established identity that isn't ours.
- **GitHub Pages** — cannot proxy to an external origin at all. Kills camera
  thumbnails and fog analysis, and it is *not* fixable by baking URLs at build
  time: peak-cam image URLs expire in about two minutes.
- **`[[headers]]` in netlify.toml for cache control on the proxy** — died on live
  evidence. The proxy path reported `fwd=miss` on every request while static
  paths reported `stored`. Netlify does not apply header blocks to proxied
  responses.

## Live wires

- **Correcting myself:** I blamed an earlier blank Livermore screenshot on the
  `#wx/<slug>` deep link firing before the map was ready. Tested tonight against
  the live site — cold-loading `#wx/livermore` and `#wx/downtown-sf` both work:
  panel opens, hero temp renders (78° and 65°), chart draws 11 segments and 12
  icons. **There is no deep-link race.** Whatever blanked that screenshot was
  local or capture-side. Don't go hunting the bug I invented.
- **Unexplained and could recur:** why did 15 commits get authored as
  `hey@timerickson.com` when the global config is the noreply address and there
  was no local override? I fixed the symptom, not the cause. If it recurs, suspect
  an environment variable or a config changed mid-session.
- **The best idea from tonight got buried and never answered: tule fog.** Central
  Valley winter radiation fog runs Nov-Feb — a different season from the marine
  layer's May-Sep. As built, this site goes quiet every October. Tule fog would
  give it a year-round reason to exist, and it's a public-safety story (the I-5
  and 99 pileups), not only a pretty one. It needs its own classifier tune because
  that fog builds from the ground up rather than sitting under a cap. Tim never
  responded — it lost his attention to a list of domain names. I still think it's
  the strongest expansion available and I'd raise it again.
- **The multi-region estimate is a grep, not an attempt.** "Five constants and two
  data files, about 90 minutes" came from reading where the Bay Area is hardcoded,
  not from trying it. Medium confidence. One part I am sure of: the satellite
  product already in use (`G18-ABI-CONUS-night-microphysics`) covers the entire
  US West Coast, so LA, San Diego, Oregon and Seattle need no new data source.
- **Peak dot positions come from bundled `data/alertcalifornia-bay.json`, not the
  live API.** I claimed the opposite earlier tonight and corrected it. The
  consequence nobody has decided on: those 183 positions go stale silently.
  `scripts/fetch-alertcalifornia.py` regenerates them; no refresh cadence exists.
- **Nagging, can't justify yet:** nothing has tested what the app does when
  ALERTCalifornia is down or slow. `alertca.ts` has a 15s timeout and the edge
  function falls through to the redirect, so it *should* degrade to "no
  thumbnails" — but that path has never been exercised.
- **The site is public and crawlable** (`robots.txt` allows everything) with no
  analytics of any kind, so if anyone visits we will never know. That may be
  exactly what Tim wants; it deserves one question rather than an assumption.
- **`vite.preview.proxy` in astro.config.mjs is dead code** for static output.
  About 85% sure it never did anything. Removal candidate, harmless either way.
- **`og:image` is the 384px square app icon**, not a proper 1200x630 share card.
  Punted deliberately: that's a design decision, not a deploy one.
- Doc sprawl worth watching: README, STYLE, RESUME, COMPACTED (ignored) and now
  CHECKPOINT. RESUME and CHECKPOINT overlap on "what's next."
