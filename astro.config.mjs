import { defineConfig } from 'astro/config';

// Fully static, zero client framework. Every page renders to plain HTML at
// build time; the only JS is the small inline script in index.astro (live
// toggle, refresh, filters, conditions). No React, no islands.
export default defineConfig({
  site: 'https://bay.camera',
  output: 'static',
  build: { format: 'file' },
});
