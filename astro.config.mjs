import { defineConfig } from 'astro/config';

// Fully static, zero client framework. Every page renders to plain HTML at
// build time; the only client JS is src/scripts/* (map, panels, fog, weather).
// No React, no islands.
//
// The /api/alertca proxy exists because ops.alertcalifornia.org serves curl
// but blocks browser-fingerprinted TLS (AWS WAF) — so the camera-metadata
// fetch must be same-origin. Dev/preview proxy here; production equivalent
// lives in netlify.toml as a 200 rewrite.
const alertcaProxy = {
  '/api/alertca': {
    target: 'https://ops.alertcalifornia.org',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/api\/alertca/, '/api/getCameraDataByLoc'),
  },
};

export default defineConfig({
  // Deploy target. bay.camera itself is not ours right now, so canonical URLs
  // and the sitemap point at the Netlify subdomain. The product is still
  // called bay.camera everywhere it's user-facing.
  site: 'https://bay-camera.netlify.app',
  output: 'static',
  build: { format: 'file' },
  vite: {
    server: { proxy: alertcaProxy },
    preview: { proxy: alertcaProxy },
  },
});
