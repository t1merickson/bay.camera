Task: bay-camera · Written: 2026-09-09 10:40 · Scope: build bay.camera — the whole project desk, currently in a UI/material phase

Adopted from the root `CHECKPOINT.md` written 12 Aug 2026 (commit 780044d). That
file was pure task state with no inbound references, so it moved here whole
rather than being split; `RESUME.md` stays where it is as durable architecture
documentation. Restore the previous layout with
`git show 780044d:CHECKPOINT.md > CHECKPOINT.md`.

Only material that never made it into the repo lives here. Anything explained by
a code comment, a commit message, or RESUME.md was deliberately left out.

## Now

Seven commits unpushed, so **the live site is seven behind and shows none of
this work**. Everything is verified locally at http://localhost:4321/ (dev
server may still be running). The phase is Tim reviewing the glass/material
pass by eye. Next concrete action: he answers the four open questions in Plates,
or says push.

## Plates

- **Four questions asked and unanswered, all mine to wait on, cheapest first:**
  - `--radius` (14px) is now an orphan token — zero uses since every control
    became a capsule. Delete it, or is 14px still wanted for something?
  - The peak-status key survived the legend cull. I kept it because nothing else
    explains green vs pale vs dim dots, and stripped its glass so it sits on the
    map. Kill it too, or keep?
  - `feDisplacementMap` refraction — the Aave article's actual headline, not
    built. See Discards for why, and what it would cost.
  - **Night magenta intensity.** Longest-outstanding item in the project — asked
    12 Aug, still unanswered. Now finally *visible*: the 2 Sep screenshots show
    the Night Microphysics layer washing the whole map magenta, and dark-mode
    place labels dying underneath it. My read: too loud. Apple's own remedy for
    bright content under chrome is a 35%-opacity dim layer, which is in the CSS
    comments as the tool for this when he decides.
- **Amber end of the Weather Line palette** — still unverified after two
  attempts, carried from 12 Aug. Needs an *inland* spot (Livermore, Walnut
  Creek) in *afternoon* daylight; after dark every icon is a moon regardless.
  Livermore read 78° at 10pm, so data flows — there is just no sun in it.
- **Predictive fog card** — proposed 12 Aug (coast-inland temp gradient plus
  coastal dew-point spread as "fog likely tonight"), never answered. Deliberately
  not built: it changes the card from reporting what is to guessing what's next.
- **Multi-region refactor** — proposed, never answered; he pivoted to hosting.
  Estimate and its confidence in Live wires.
- **Tule fog** — still the strongest expansion available and still unanswered.
  See Live wires; I would raise it again.
- **COMPACTED.md** — gitignored, inert, still on disk. Offer to fold its error
  ledger into RESUME.md and delete it was never answered.
- **Domain** — "forget buying a domain" stands; he was separately still
  considering asking gongruya for bay.camera back. Nothing to do.

## Terrain

- **Apple's HIG pages are JS-rendered — WebFetch gets an empty shell.** Read them
  as JSON instead:
  `developer.apple.com/tutorials/data/design/human-interface-guidelines/<page>.json`
  and `.../tutorials/data/documentation/<path>.json`. Walk
  `primaryContentSections` for `type: text|heading|paragraph|aside|codeVoice`.
  This is how the Liquid Glass and concentricity rules were actually obtained.
- **puppeteer-core's `emulateMediaFeatures` rejects `prefers-reduced-transparency`**
  ("Unsupported media feature"). Drive it over raw CDP instead:
  `(await page.createCDPSession()).send('Emulation.setEmulatedMedia', {media:'', features:[...]})`.
  Without this you cannot test that fallback at all.
- **`codex exec` with Sol at high effort exceeds a 2-minute tool timeout.** Run it
  backgrounded with a long window, or it dies at 120s having done the work.
- **A `cd /tmp` inside a Bash call broke `PATH` in this environment** — `curl`,
  `ls`, `awk`, `tr` all became "command not found" and the shell cwd reset. Use
  absolute paths (`/usr/bin/curl`) and avoid `cd` in compound commands.
- **`timeout` does not exist on macOS** (it is `gtimeout` from coreutils). A loop
  using it fails silently and returns empty output that reads exactly like a
  network failure.
- **macOS `whois` is unreliable for newer TLDs.** For `.camera` it stops at IANA
  and returns the registry record, so every domain looks taken with creation date
  2013-10-31. Use `dig +short NS <domain>`, and control-test against a domain you
  know is registered before trusting a result.
- **puppeteer-core scripts must live inside the repo**, not `/tmp` —
  ERR_MODULE_NOT_FOUND otherwise. Write `scripts/.name.mjs`, delete after.
- **`astro preview` ignores `vite.preview.proxy`** for static output, so
  `/api/alertca` 404s under preview while working in `astro dev` and on Netlify.
  Do not diagnose a proxy bug from a preview 404.
- **Netlify edge caching is per-location** — repeat requests interleave `stored`
  and `hit` because they land on different edge nodes. Normal, not broken.
- Deploy is roughly 50-60 seconds from push to live.
- **There is no `tsconfig.json` in this repo.** Any claim that "tsc strict passed"
  used explicit CLI flags, not a project config.

## Decided

*Carried forward from 12 Aug, still standing:*

- **Netlify free tier at `bay-camera.netlify.app`** — the only free host that
  proxies to an external origin without extra code. GitHub Pages disqualified.
- **No new domain** (Tim, explicit). The product stays *named* bay.camera on
  every user-facing surface; only `astro.config.mjs`'s `site` points at the
  Netlify subdomain. The host is temporary, the name is not.
- **Rewrote 15 commits' author email rather than pushing them** — they carried
  `hey@timerickson.com` onto a public repo. Files verified byte-identical after.
- **Edge function owns `/api/alertca`, netlify.toml redirect stays as fallback**
  via `context.next()`. Deployed to a throwaway path first in case the upstream
  firewall rejected Deno's TLS fingerprint; it does not, that block only targets
  browsers.
- **`COMPACTED.md` gitignored, not committed** — point-in-time dump; RESUME.md is
  the maintained doc.

*Added this phase:*

- **Glass is chrome-only, and applied sparingly.** The HIG says outright "don't
  use Liquid Glass in the content layer" and "limit these effects to the most
  important functional elements." An earlier pass had it on fifteen element
  types including all 41 temperature pills, which are data drawn on the map.
  Now three sites: surfaces, the zoom control, attribution.
- **Regular variant everywhere, no clear variant defined.** Every surface here
  holds text over a busy map, which is exactly the HIG's test for regular.
  Defining an unused clear variant would be dead tokens. The note about when
  that changes lives in the CSS.
- **Layer toggles are neutral, not accent-tinted.** Two independent reasons, both
  measured: accent-on-accent-tint was 3.33:1 in light mode against 4.5 needed,
  and `--accent` is hue 217, the *same hue* as `--r-san-francisco` — so the
  primary control was wearing one of the map's data colours. Neutral is 14.5:1.
  Blue now means focus and interaction only.
- **Corner radii are derived, not chosen.** Apple's concentricity rule: a nested
  corner shares a centre with its container's, so `inner = outer − inset`. 22px
  outer stays (Tim asked for more rounding, and Apple increased radii in this
  design language); the close button is 8px and list rows 12px because that is
  what the insets dictate.
- **Region legend deleted** (Tim, explicit). The Cameras panel already lists every
  region with its swatch and doubles as the filter, so it explained the same
  thing twice, permanently.
- **Camera panel reuses the weather renderer rather than getting its own.**
  `renderWeather` split into `weatherHeroHtml` + `weatherDetailHtml`.

## Discards

*Carried forward from 12 Aug:*

- **Buying any domain** — killed by Tim. The research was real and is worth
  keeping: `fog.camera` is genuinely available (control-tested, not guessed) and
  was the recommendation. Also free: `haar.camera`, `inversion.camera`,
  `stratus.camera`, `marine.camera`, `foglift.co`, `fogcast.co`. Why each lost —
  `haar`: a North Sea word for a Pacific product, and reads as "hair" in German
  and Dutch (still the best name on pure craft); `inversion`: truest to what we
  measure but sounds like a photography technique; `stratus`: correct cloud genus,
  but cloud-computing branding owns the word. Before buying `fog.camera` someone
  must check price — short generics on Binky Moon TLDs are often premium-tiered,
  so $30 or $3,000. WHOIS will not tell you; a registrar will.
- **`marinelayer.*`** — Marine Layer is an SF clothing company. Trademark
  collision in our own city.
- **`karl.*`** — Bay-specific so it contradicts multi-region, and it is an
  established identity that is not ours.
- **GitHub Pages** — cannot proxy to an external origin, and not fixable by
  baking URLs at build time: peak-cam image URLs expire in about two minutes.
- **`[[headers]]` in netlify.toml for cache control on the proxy** — died on live
  evidence: the proxy path reported `fwd=miss` every request while static paths
  reported `stored`. Netlify does not apply header blocks to proxied responses.

*Added this phase:*

- **`feDisplacementMap` refraction** — the Aave article's actual technique, and
  the one thing from it not built. Two blockers: it needs a displacement map
  generated per element and regenerated on resize, and `backdrop-filter: url()`
  is Chromium-only, so Safari silently gets flat glass. Roughly one to two hours
  including a clean fallback. Not dead on merit — Tim has simply not answered.
- **Painted-on specular sheen** (a 147° `::before` gradient). Killed by Sol's
  argument, which I accepted: a fixed-percentage diagonal describes a different
  light source on every element it touches, so the same wash implied two
  different slabs across a 52px bar and a full-height panel. The one bright top
  edge in `--glass-rim` is the size-independent equivalent.
- **Chromatic edge fringe.** Killed for spending hue on decoration in a UI that
  reserves hue for eight region colours and four peak states. Also had shipped at
  `.30/.26` while its own comment claimed `.10`.
- **`saturate(180%)` on the glass.** Apple's regular variant adjusts *luminosity*,
  not saturation; 180% pulled the map's colour up into the chrome and competed
  with the region hues.
- **Sol's proposal to drop radii to 18/16/12.** Rejected on primary-source
  grounds: Tim asked for *more* rounding and Apple increased radii in this design
  language. Sol's underlying observation was sound (three concentric rounding
  systems inside 52px of HUD) but the fix is derived radii, not smaller ones.
- **One glass tint value for every surface** (Sol wanted a flat `.46`). Replaced
  by the variant idea — the material's job differs by surface, so one number was
  the wrong shape of answer.

## Live wires

- **Unverified, and I chose the number:** glass tint shipped at `.48` light /
  `.52` dark. Sol argued `.46`, and its opacity maths was right (`.58` tint plus
  a `.20` sheen composited to `.664` effective white, which is why light mode
  read as a solid panel). I never put `.46` and `.48` side by side on a busy map
  with the camera list over it. Low stakes, but it is a taste call I made without
  looking.
- **How to read Sol's reviews:** it stated plainly that it could not render the
  build, so every visual claim in that review was inferred from CSS and
  compositing maths, not seen. Its inferences were *correct* — light mode really
  did read as a solid panel — but its three highest-value findings were the
  arithmetic ones (contrast ratio, hue collision, a comment contradicting its own
  values), all of which I verified independently. Trust it on maths, discount it
  on appearance, and always re-derive before acting.
- **Correcting myself, do not re-hunt:** I once blamed a blank Livermore
  screenshot on the `#wx/<slug>` deep link firing before the map was ready.
  Tested against the live site: cold-loading `#wx/livermore` and `#wx/downtown-sf`
  both work — panel opens, hero temp renders, chart draws. **There is no
  deep-link race.** Whatever blanked that screenshot was local or capture-side.
- **Unexplained and could recur:** why did 15 commits get authored as
  `hey@timerickson.com` when the global config is the noreply address and there
  was no local override? Symptom fixed, cause never found. If it recurs, suspect
  an environment variable or a config changed mid-session.
- **The best idea in this project is still unanswered: tule fog.** Central Valley
  winter radiation fog runs Nov–Feb, the opposite season to the marine layer's
  May–Sep. As built, this site goes quiet every October. Tule fog would give it a
  year-round reason to exist, and it is a public-safety story (the I-5 and 99
  pileups), not only a pretty one. It needs its own classifier tune because that
  fog builds from the ground up rather than sitting under a cap. It lost Tim's
  attention to a list of domain names and has never recovered it.
- **The multi-region estimate is a grep, not an attempt.** "Five constants and two
  data files, about 90 minutes" came from reading where the Bay Area is
  hardcoded, not from trying it. Medium confidence. The part I am sure of: the
  satellite product already in use (`G18-ABI-CONUS-night-microphysics`) covers the
  entire US West Coast, so LA, San Diego, Oregon and Seattle need no new source.
- **Nagging, cannot justify yet:** the new camera-panel conditions block fires an
  Open-Meteo request per camera opened. A 10-minute cache keyed on ~100m-rounded
  coordinates blunts it (verified: 1 request per new camera, 0 on return), but a
  user clicking through 50 cameras still generates 50 requests to a free API with
  no rate-limit thinking anywhere in this project. Nothing has broken. It is the
  shape of a problem rather than a problem.
- **Frame timing has not been re-measured since the material changed.** The
  8.3ms median / 9.4ms worst figures were taken when glass was on 15 element
  types including 41 pills. Pills losing `backdrop-filter` should only make it
  faster, so this is almost certainly fine — but the number quoted in commit
  a5d8689 describes a configuration that no longer exists.
- **Nothing has tested what the app does when ALERTCalifornia is down or slow.**
  `alertca.ts` has a 15s timeout and the edge function falls through to the
  redirect, so it *should* degrade to "no thumbnails" — that path has never been
  exercised.
- **Peak dot positions come from bundled `data/alertcalifornia-bay.json`, not the
  live API.** I claimed the opposite once and corrected it. The undecided
  consequence: those 183 positions go stale silently.
  `scripts/fetch-alertcalifornia.py` regenerates them; no refresh cadence exists.
- **The site is public and crawlable** (`robots.txt` allows everything) with no
  analytics of any kind, so if anyone visits we will never know. That may be
  exactly what Tim wants; it deserves one question rather than an assumption.
- **`vite.preview.proxy` in astro.config.mjs is dead code** for static output.
  About 85% sure it never did anything. Removal candidate, harmless either way.
- **`og:image` is the 384px square app icon**, not a 1200x630 share card. Punted
  deliberately as a design decision rather than a deploy one.
- **Doc sprawl, partly addressed:** README, STYLE, RESUME, COMPACTED (ignored),
  and now this. Moving task state out of the root removed one authority conflict
  — RESUME.md and CHECKPOINT.md used to both answer "what's next." RESUME.md
  still carries a "Next moves" section that overlaps this file's Plates.
