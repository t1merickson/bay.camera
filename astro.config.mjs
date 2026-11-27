import { defineConfig } from 'astro/config';
import { trimFeed } from './src/lib/alertca-feed.mjs';

// Fully static, zero client framework. Every page renders to plain HTML at
// build time; the only client JS is src/scripts/* (map, panels, fog, weather).
// No React, no islands.

// /api/alertca in development. Production is netlify/functions/alertca.mts;
// both run the same trimFeed, so the browser sees the same shape in both.
// ops.alertcalifornia.org blocks browser TLS fingerprints but serves Node's
// fetch, which is why this has to run server-side at all.
//
// Memoised for 60 s, matching production's CDN cache, so reloading the page in
// dev doesn't pull 7 MB from a public agency every time.
const ALERTCA_UPSTREAM = 'https://ops.alertcalifornia.org/api/getCameraDataByLoc';
let devFeed = { at: 0, body: '' };

function alertcaDevServer() {
  return {
    name: 'alertca-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/alertca', async (_req, res) => {
        try {
          if (Date.now() - devFeed.at > 60_000) {
            const up = await fetch(ALERTCA_UPSTREAM, { headers: { accept: 'application/json' } });
            if (!up.ok) throw new Error(`upstream ${up.status}`);
            devFeed = { at: Date.now(), body: JSON.stringify(trimFeed(await up.json())) };
          }
          res.setHeader('content-type', 'application/json');
          res.end(devFeed.body);
        } catch (err) {
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'upstream unavailable', detail: String(err) }));
        }
      });
    },
  };
}

export default defineConfig({
  // Deploy target. bay.camera itself is not ours right now, so canonical URLs
  // and the sitemap point at the Netlify subdomain. The product is still
  // called bay.camera everywhere it's user-facing.
  site: 'https://bay-camera.netlify.app',
  output: 'static',
  build: { format: 'file' },
  // There used to be a vite.preview.proxy here too. `astro preview` serves
  // static output with its own server and never consulted it, so it did
  // nothing. To exercise /api/alertca, use `astro dev`.
  vite: { plugins: [alertcaDevServer()] },
});
