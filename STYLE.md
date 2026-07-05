# style guide

Conventions for the current codebase (Astro + MapLibre, data-driven). For the
big picture see [README.md](README.md); for session state see [RESUME.md](RESUME.md).

## what this is

A single static Astro page (`src/pages/index.astro`) rendering a full-screen
MapLibre map of Bay Area webcams + weather. No server, no React, no Tailwind.
The whole app is that one page plus its inline `<script>` and one stylesheet.

## principles

- **Public-domain only.** Only embed cams that are already freely public — no
  paywalls, no logins. If a source asks for donations, carry that forward in the
  camera's `donation` field (it renders in the preview card).
- **Data, not markup.** Cameras live in `data/cameras.json` (the single source
  of truth), never hard-coded in the page. Add/edit cameras there. Schema:
  [docs/data-model.md](docs/data-model.md); vendor types: [docs/vendors.md](docs/vendors.md).
- **Don't delete dead cams — mark them.** Set `status: "dead"` with a dated note
  in `notes` (they stay in the file as history + a re-check queue; they don't
  render). Same instinct as the old site's commented-out blocks.
- **Keep it light.** No framework JS beyond MapLibre. No API keys. No web fonts
  (system font stack). Prefer a still JPEG over a heavy video player; load video
  iframes only on demand (the play button), never all at once.

## code conventions

- **CSS:** hand-rolled design system in `public/styles/main.css`. HSL design
  tokens in the shadcn spirit (`--background`, `--foreground`, `--muted`,
  `--border`, `--accent`, `--radius`), light/dark via `prefers-color-scheme`.
  Colors are `hsl(var(--token))`. Restrained: subtle borders, minimal shadow,
  **no gradients, no glow, no monospace body text** (Tim's explicit anti-list).
- **Unique class names.** A `.hide-broken` collision (a label + a body class
  sharing a name) once turned `<body>` into a flex container and broke the whole
  layout. Namespace things; don't reuse a class for two concepts.
- **`[hidden]` needs help.** Any element you give an explicit `display:` also
  needs `.thing[hidden]{display:none}`, or it ignores the `hidden` attribute.
- **Escape remote text** before putting it in `innerHTML` (e.g. NWS
  `textDescription`). There's an `esc()` helper in the page script.
- **No emoji in UI chrome.** Use plain Unicode or small inline SVG icons
  (lucide-style). Emoji are fine in prose/commits, not in the interface.
- **Two spaces**, semicolons, single quotes in the inline script; match the
  surrounding code.

## commits

Lowercase, terse, present-tense, one line. No body unless something genuinely
needs explaining. This is a webcam map — don't wax poetic.

```
swap svg map for maplibre
mark dead wunderground cams
add clouds overlay toggle
fix hidden-panel display bug
```

Verbs that fit: `add`, `swap`, `fix`, `remove`, `mark`, `wire`, `tweak`,
`update`. Attribute commits/changelogs to `t1merickson` (Tim).
