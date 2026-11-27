/**
 * Same-origin, cached, trimmed copy of the ALERTCalifornia camera feed.
 *
 * Why this exists at all: ops.alertcalifornia.org rejects browser TLS
 * fingerprints (an AWS WAF), so a browser can't fetch it directly. A server
 * can, so the browser asks us and we ask them.
 *
 * Why a regular Function rather than an Edge Function: the trim parses 7 MB of
 * JSON and walks 14,000 rows, which takes 16-22 ms of CPU on a fast laptop.
 * Netlify caps Edge Functions at 50 ms of CPU per request and their machines
 * are slower, so that margin was too thin. Regular Functions get 60 seconds.
 *
 * Caching: `durable` puts the response in Netlify's shared cache, so the
 * upstream sees at most one request a minute no matter how many people have
 * the map open. Functions are not cached at all without this header.
 */

import { trimFeed } from '../../src/lib/alertca-feed.mjs';

const UPSTREAM = 'https://ops.alertcalifornia.org/api/getCameraDataByLoc';

export default async () => {
  let raw: unknown;
  try {
    const res = await fetch(UPSTREAM, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    raw = await res.json();
  } catch (err) {
    return Response.json(
      { error: 'upstream unavailable', detail: String(err) },
      // Short cache on failure so a dead upstream isn't hammered, but recovery
      // shows up quickly.
      { status: 502, headers: { 'netlify-cdn-cache-control': 'public, max-age=15' } },
    );
  }

  try {
    return Response.json(trimFeed(raw, { state: 'CA' }), {
      headers: {
        'netlify-cdn-cache-control': 'public, durable, max-age=60, stale-while-revalidate=120',
        'cache-control': 'public, max-age=0, must-revalidate',
      },
    });
  } catch (err) {
    return Response.json({ error: 'feed format changed', detail: String(err) }, { status: 502 });
  }
};

export const config = { path: '/api/alertca' };
