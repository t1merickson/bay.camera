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
 *   b.46013                   any other source: `<source letter>.<that source's
 *                             own key>`. Curated slugs never contain a dot, so
 *                             the two can't collide. Letters in use (each
 *                             source's script in scripts/sources/ owns one):
 *                               b  NOAA NDBC buoy cameras (key: station id)
 *                               p  PhenoCam network (key: site name)
 *                               u  USGS CoastCam (key: station + camera)
 *                               s  California State Parks streams
 *                               n  National Park Service stills
 *                               o  observatories (Lick, Palomar)
 *                               c  Caltrans district feeds, for cameras the
 *                                  ALERTCalifornia feed lacks
 *                               g  Great Basin air district cameras
 *                               h  hand-found cameras from the camera hunt
 *
 * `a<digits>` is the one undotted short form, kept because it was already in
 * shipped links before the dotted scheme existed.
 */

const FEED_ID = /^a(\d+)$/;

/** Public ID for an ALERTCalifornia feed camera. */
export const feedCamId = (camId: string): string => `a${camId}`;

/** True if this public ID belongs to a source file in data/sources/. */
export const isSourceCamId = (publicId: string): boolean => /^[a-z]\.[^\s]+$/.test(publicId);

/** The ALERTCalifornia camId inside a public ID, or null if it isn't a feed camera. */
export const feedCamIdFrom = (publicId: string): string | null => FEED_ID.exec(publicId)?.[1] ?? null;
