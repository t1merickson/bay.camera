/**
 * fogtop.ts — estimate the marine-layer (fog) top altitude from mountain-top webcams.
 *
 * Physical idea
 * -------------
 * The SF Bay marine layer is a shallow stratus deck that hugs the ground/ocean and
 * has a fairly well-defined top. A peak camera sitting *inside* that cloud sees a
 * flat, washed-out, desaturated, low-contrast frame (you're staring into gray soup).
 * A camera *above* the deck sees a crisp scene: the fog blanket below, a sharp
 * horizon, blue-ish sky, real edges and color. So if we sort every camera by its
 * ground elevation and find the elevation at which cameras flip from "socked in"
 * to "clear", that boundary elevation IS the fog top.
 *
 * We turn each live image into four cheap statistics (brightness, contrast,
 * saturation, edge energy), classify each camera as fog / clear / dark / error,
 * then find the elevation threshold that best separates fog (below) from clear
 * (above). Fog hugs the ground, so on ties we bias toward the lowest threshold.
 *
 * Night limitation
 * ----------------
 * At night these ALERTCalifornia cams switch to a near-IR-ish mode and many frames
 * go very dark and/or noisy. Brightness and color no longer track the marine layer,
 * so we classify dark frames as 'dark' and exclude them — a fog-top estimate is
 * simply unreliable after dusk.
 *
 * Tuning
 * ------
 * All classification thresholds below were hand-tuned against ALERTCalifornia peak
 * imagery and are exposed as named constants so they stay easy to retune.
 */

export interface PeakInput {
  camId: string;
  name: string;
  elevM: number;
  url: string;
}

export type PeakStatus = 'clear' | 'fog' | 'dark' | 'error';

export interface PeakReading {
  camId: string;
  status: PeakStatus;
  brightness: number; // mean luminance 0-255
  contrast: number; // stddev of luminance
  saturation: number; // mean HSL-ish saturation 0-1
  edges: number; // mean absolute horizontal+vertical luminance gradient
}

export interface FogTopEstimate {
  topM: number | null; // estimated fog top in meters, null if indeterminate
  confidence: 'none' | 'low' | 'medium' | 'high';
  sockedBelow: number; // count of fog-status cams below the boundary
  clearAbove: number; // count of clear-status cams above the boundary
  sampled: number; // cams successfully analyzed (not error/dark)
  readings: Map<string, PeakReading>;
}

// --- Analysis tuning -------------------------------------------------------

// Downscale target. Small enough to be cheap over ~183 cams, large enough to
// keep meaningful edge/contrast structure. Aspect ~4:3 to match typical cams.
const SAMPLE_W = 64;
const SAMPLE_H = 48;

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 8000;

// --- Classification thresholds (hand-tuned) --------------------------------

// Below this mean luminance the frame is treated as night/dark: fog-top is
// unreliable because the cams go near-IR / near-black after dusk.
const DARK_BRIGHTNESS = 35;

// "In-cloud" signature: the frame is flat gray soup. All four must hold.
const FOG_CONTRAST_MAX = 14; // luminance stddev — cloud interiors are very flat
const FOG_EDGES_MAX = 5; // almost no gradient structure inside cloud
const FOG_SATURATION_MAX = 0.12; // gray, nearly colorless
const FOG_BRIGHTNESS_MIN = 90; // bright enough to be daytime cloud, not shadow

// Extremely washed-out bright frames also read as fog even if contrast is a
// touch higher than FOG_CONTRAST_MAX (blown-out whiteout, glare through cloud).
const FOG_WHITEOUT_BRIGHTNESS_MIN = 200;
const FOG_WHITEOUT_CONTRAST_MAX = 22;

// --- Estimation tuning -----------------------------------------------------

// Need at least this many usable (fog|clear) cams to say anything at all.
const MIN_USABLE = 4;

// Confidence tiers: (min separation accuracy, min usable cam count).
const HIGH_ACC = 0.85;
const HIGH_N = 10;
const MED_ACC = 0.7;
const MED_N = 6;

/**
 * Classify a single reading from its four metrics. See threshold constants above
 * for the rationale behind each cutoff.
 */
export function classifyReading(
  r: Omit<PeakReading, 'camId' | 'status'>,
): PeakStatus {
  // Night / too dark to trust — exclude from the fog-top fit.
  if (r.brightness < DARK_BRIGHTNESS) return 'dark';

  // Flat, colorless, edgeless, daytime-bright => camera is inside the cloud.
  const inCloud =
    r.contrast < FOG_CONTRAST_MAX &&
    r.edges < FOG_EDGES_MAX &&
    r.saturation < FOG_SATURATION_MAX &&
    r.brightness >= FOG_BRIGHTNESS_MIN;

  // Blown-out whiteout: near-white and still fairly flat.
  const whiteout =
    r.brightness > FOG_WHITEOUT_BRIGHTNESS_MIN &&
    r.contrast < FOG_WHITEOUT_CONTRAST_MAX;

  if (inCloud || whiteout) return 'fog';

  return 'clear';
}

/**
 * Compute the four metrics for one already-loaded image by drawing it into a
 * shared downscale canvas and reading back the pixels.
 */
function measureImage(
  img: HTMLImageElement,
  ctx: CanvasRenderingContext2D,
): Omit<PeakReading, 'camId' | 'status'> {
  ctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
  ctx.drawImage(img, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);

  const n = SAMPLE_W * SAMPLE_H;

  // Per-pixel luminance buffer (reused for the gradient pass).
  const lum = new Float32Array(n);
  let sumL = 0;
  let sumSat = 0;

  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const rr = data[o];
    const gg = data[o + 1];
    const bb = data[o + 2];

    const L = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    lum[i] = L;
    sumL += L;

    const max = rr > gg ? (rr > bb ? rr : bb) : gg > bb ? gg : bb;
    const min = rr < gg ? (rr < bb ? rr : bb) : gg < bb ? gg : bb;
    sumSat += max === 0 ? 0 : (max - min) / max;
  }

  const mean = sumL / n;

  // Stddev of luminance = contrast.
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = lum[i] - mean;
    sumSq += d * d;
  }
  const contrast = Math.sqrt(sumSq / n);

  // Mean gradient magnitude (horizontal + vertical) over the interior cells.
  let sumGrad = 0;
  let gradCount = 0;
  for (let y = 0; y < SAMPLE_H; y++) {
    for (let x = 0; x < SAMPLE_W; x++) {
      const idx = y * SAMPLE_W + x;
      let g = 0;
      if (x + 1 < SAMPLE_W) g += Math.abs(lum[idx + 1] - lum[idx]);
      if (y + 1 < SAMPLE_H) g += Math.abs(lum[idx + SAMPLE_W] - lum[idx]);
      sumGrad += g;
      gradCount++;
    }
  }
  const edges = gradCount === 0 ? 0 : sumGrad / gradCount;

  return {
    brightness: mean,
    contrast,
    saturation: sumSat / n,
    edges,
  };
}

/**
 * Load one image (CORS anonymous) with a timeout, measure it, and classify.
 * Any failure (network, decode, timeout, canvas taint) yields status 'error'.
 */
function analyzeOne(
  cam: PeakInput,
  ctx: CanvasRenderingContext2D,
  timeoutMs: number,
): Promise<PeakReading> {
  return new Promise<PeakReading>((resolve) => {
    const errReading: PeakReading = {
      camId: cam.camId,
      status: 'error',
      brightness: 0,
      contrast: 0,
      saturation: 0,
      edges: 0,
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (timer !== null) clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };

    const finish = (reading: PeakReading): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(reading);
    };

    timer = setTimeout(() => {
      // Stop the in-flight load from doing anything further.
      img.src = '';
      finish(errReading);
    }, timeoutMs);

    img.onload = () => {
      try {
        const metrics = measureImage(img, ctx);
        finish({
          camId: cam.camId,
          status: classifyReading(metrics),
          ...metrics,
        });
      } catch {
        finish(errReading);
      }
    };

    img.onerror = () => {
      finish(errReading);
    };

    try {
      img.src = cam.url;
    } catch {
      finish(errReading);
    }
  });
}

/**
 * Analyze every camera image with a bounded-concurrency worker pool.
 * Returns a map camId -> reading for every input cam.
 */
export async function analyzePeaks(
  cams: PeakInput[],
  opts?: {
    concurrency?: number;
    timeoutMs?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<Map<string, PeakReading>> {
  const concurrency = Math.max(1, opts?.concurrency ?? DEFAULT_CONCURRENCY);
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const onProgress = opts?.onProgress;

  const results = new Map<string, PeakReading>();
  const total = cams.length;

  if (total === 0) return results;

  // One reusable offscreen canvas + 2d context, shared by all workers. Workers
  // are cooperatively scheduled (single-threaded JS) and each measurement runs
  // synchronously start-to-finish inside onload, so sharing the canvas is safe.
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    for (const cam of cams) {
      results.set(cam.camId, {
        camId: cam.camId,
        status: 'error',
        brightness: 0,
        contrast: 0,
        saturation: 0,
        edges: 0,
      });
    }
    onProgress?.(total, total);
    return results;
  }

  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= total) break;
      const cam = cams[i];
      const reading = await analyzeOne(cam, ctx, timeoutMs);
      results.set(cam.camId, reading);
      done++;
      onProgress?.(done, total);
    }
  };

  const pool: Promise<void>[] = [];
  for (let w = 0; w < Math.min(concurrency, total); w++) {
    pool.push(worker());
  }
  await Promise.all(pool);

  return results;
}

/**
 * Estimate the fog top from a set of readings.
 *
 * Uses only 'fog' and 'clear' cams. Finds the elevation threshold T (a midpoint
 * between consecutive distinct usable elevations) that maximizes correctly-placed
 * cams: fog below T + clear above T. Ties break toward the lowest T (fog hugs the
 * ground). If there are enough usable cams but zero fog, that's a confident
 * "no marine layer".
 */
export function estimateFogTop(
  cams: PeakInput[],
  readings: Map<string, PeakReading>,
): FogTopEstimate {
  const elevById = new Map<string, number>();
  for (const cam of cams) elevById.set(cam.camId, cam.elevM);

  // Collect usable (fog|clear) cams with their elevation.
  const usable: { elev: number; fog: boolean }[] = [];
  let sampled = 0;
  for (const r of readings.values()) {
    if (r.status === 'error' || r.status === 'dark') continue;
    sampled++;
    const elev = elevById.get(r.camId);
    if (elev === undefined) continue;
    if (r.status === 'fog' || r.status === 'clear') {
      usable.push({ elev, fog: r.status === 'fog' });
    }
  }

  const usableCount = usable.length;
  const fogCount = usable.reduce((a, u) => a + (u.fog ? 1 : 0), 0);

  // Too few usable cams to say anything.
  if (usableCount < MIN_USABLE) {
    return {
      topM: null,
      confidence: 'none',
      sockedBelow: 0,
      clearAbove: 0,
      sampled,
      readings,
    };
  }

  // Enough data, but no fog anywhere => confident "no marine layer detected".
  if (fogCount === 0) {
    return {
      topM: null,
      confidence: 'high',
      sockedBelow: 0,
      clearAbove: usableCount,
      sampled,
      readings,
    };
  }

  // Candidate thresholds: midpoints between consecutive distinct elevations.
  const distinct = Array.from(new Set(usable.map((u) => u.elev))).sort(
    (a, b) => a - b,
  );
  const candidates: number[] = [];
  for (let i = 0; i + 1 < distinct.length; i++) {
    candidates.push((distinct[i] + distinct[i + 1]) / 2);
  }

  // Degenerate: every usable cam at the same elevation — can't separate.
  if (candidates.length === 0) {
    return {
      topM: null,
      confidence: 'low',
      sockedBelow: fogCount,
      clearAbove: usableCount - fogCount,
      sampled,
      readings,
    };
  }

  // Pick the threshold maximizing (fog below T) + (clear above T). Candidates are
  // ascending, so keeping strict '>' on improvement biases ties to the lowest T.
  let bestT = candidates[0];
  let bestScore = -1;
  let bestBelow = 0;
  let bestAbove = 0;

  for (const T of candidates) {
    let fogBelow = 0;
    let clearAbove = 0;
    for (const u of usable) {
      if (u.elev < T) {
        if (u.fog) fogBelow++;
      } else {
        if (!u.fog) clearAbove++;
      }
    }
    const score = fogBelow + clearAbove;
    if (score > bestScore) {
      bestScore = score;
      bestT = T;
      bestBelow = fogBelow;
      bestAbove = clearAbove;
    }
  }

  const accuracy = bestScore / usableCount;

  let confidence: FogTopEstimate['confidence'];
  if (accuracy >= HIGH_ACC && usableCount >= HIGH_N) {
    confidence = 'high';
  } else if (accuracy >= MED_ACC && usableCount >= MED_N) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    topM: bestT,
    confidence,
    sockedBelow: bestBelow,
    clearAbove: bestAbove,
    sampled,
    readings,
  };
}
