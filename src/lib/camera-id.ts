/**
 * Public camera IDs: the strings that appear in `#cam/<id>` links and, later,
 * in shared list URLs. Anything already shared depends on these, so treat the
 * format as permanent. Add a new prefix; never reuse or reshape an old one.
 *
 *   ocean-beach-kellys-cove   curated camera from data/cameras.json. Always a
 *                             lowercase slug with dashes, never a bare
 *                             letter-and-digits shape.
 *   a2429                     ALERTCalifornia feed camera 2429. Covers every
 *                             provider in that feed: Caltrans, UC San Diego,
 *                             HPWREN, FAA, UNR, ALERTWest. The number is
 *                             ALERTCalifornia's own camId, which is stable.
 *
 * Reserved for sources not yet ingested, so nobody invents a clashing shape:
 *   b<station>  NOAA buoy camera, e.g. b46013
 *   p<site>     PhenoCam site
 */

const FEED_ID = /^a(\d+)$/;

/** Public ID for an ALERTCalifornia feed camera. */
export const feedCamId = (camId: string): string => `a${camId}`;

/** The ALERTCalifornia camId inside a public ID, or null if it isn't a feed camera. */
export const feedCamIdFrom = (publicId: string): string | null => FEED_ID.exec(publicId)?.[1] ?? null;
