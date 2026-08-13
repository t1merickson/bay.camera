/**
 * Cached proxy for the ALERTCalifornia camera API.
 *
 * Why this exists instead of the plain netlify.toml redirect: a proxy rewrite
 * passes the upstream's headers straight through, and that upstream sends no
 * cache directive at all — so every single visitor caused a fresh 6.65 MB
 * fetch from a public agency's API. A netlify.toml [[headers]] block does not
 * apply to proxied responses (verified against the live site: static paths
 * report "stored", the proxy path always reported "fwd=miss"). Setting a cache
 * header on that response requires running real code, which is this file.
 *
 * With s-maxage=60 the edge holds one copy for a minute, so ALERTCalifornia
 * sees at most one request per minute no matter how many people have the map
 * open. That matches the 60s cache alertca.ts already keeps in the browser.
 *
 * If the upstream fetch fails for any reason, this hands the request back to
 * the normal pipeline so the netlify.toml redirect proxy still answers it.
 * Cameras keep working; we just lose the caching.
 *
 * Currently mounted on a test path. Once verified live it moves to
 * /api/alertca and the netlify.toml redirect becomes the fallback.
 */

import type { Config, Context } from '@netlify/edge-functions';

const UPSTREAM = 'https://ops.alertcalifornia.org/api/getCameraDataByLoc';

export default async (_request: Request, context: Context) => {
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, { headers: { accept: 'application/json' } });
  } catch {
    return context.next();
  }

  if (!upstream.ok) return context.next();

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'netlify-cdn-cache-control': 'public, s-maxage=60, stale-while-revalidate=120',
      'cache-control': 'public, max-age=0, must-revalidate',
    },
  });
};

export const config: Config = { path: '/api/alertca-edge' };
