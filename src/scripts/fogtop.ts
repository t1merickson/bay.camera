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
 * Three cases per camera, calibrated against live 2026-07-05 imagery:
 *   - BELOW the deck (e.g. Pillar Point 0 m under 300 m stratus): gray sky
 *     overhead, but the horizon band is crisp — houses, hills, boats.
 *   - INSIDE the deck (San Bruno Mtn 387 m, Grizzly Peak 509 m): everything
 *     except the immediate foreground is washed out; the mid/horizon band is
 *     gray soup even while near-field trees keep some texture.
 *   - ABOVE the deck (Mt Diablo 1,059 m): saturated sky, sharp terrain.
 * Whole-frame statistics can't tell these apart (foreground texture rescues
 * an in-cloud frame), so we score washout per grid cell (3 rows × 2 cols,
 * vendor overlays cropped) and call a camera fog when the upper cells are
 * washed. The marine layer is then a BAND [base, top]: clear cams below the
 * base, fog cams inside, clear cams above — a two-threshold search.
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

export interface CellMetrics {
  brightness: number; // mean luminance 0-255
  contrast: number; // stddev of luminance
  saturation: number; // mean HSL-ish saturation 0-1
  edges: number; // mean absolute horizontal+vertical luminance gradient
}

export interface PeakReading extends CellMetrics {
  camId: string;
  status: PeakStatus;
  /** 3 rows × 2 cols (row-major, top-left first), vendor overlays cropped. */
  cells: CellMetrics[];
}

export interface FogTopEstimate {
  topM: number | null; // estimated fog-layer top in meters, null if indeterminate
  baseM: number | null; // estimated fog-layer base; null = deck reaches the ground/sea
  confidence: 'none' | 'low' | 'medium' | 'high';
  sockedBelow: number; // count of fog-status cams inside the band
  clearAbove: number; // count of clear-status cams above the band
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

// ALERTCalifornia frames carry vendor chrome that fakes texture: logo strip +
// sponsor badge across the top ~15%, timestamp bar in the bottom ~5%. Crop
// both before sampling so a pure-fog frame actually measures flat.
const CROP_TOP = 0.15;
const CROP_BOTTOM = 0.06;

// Cell grid over the cropped frame. Row 0 is sky (washes under any gray sky,
// in cloud or not), row 1 is the upper-mid / horizon field — THE discriminating
// band: below the deck it stays crisp (distant terrain, c≈20-45), inside the
// cloud it washes (c≈5-17). Rows 2-3 are near-field foreground that keeps
// texture even in cloud, so they never vote. Calibrated 2026-07-05 against
// Pillar Point & Skyline College (below deck), San Bruno Mtn & Vollmer Peak
// (in cloud), Mt Diablo (above deck, blue sky saves row 0 via saturation).
const GRID_ROWS = 4;
const GRID_COLS = 6;

// --- Classification thresholds (hand-tuned) --------------------------------

// Below this mean luminance the frame is treated as night/dark: fog-top is
// unreliable because the cams go near-IR / near-black after dusk.
const DARK_BRIGHTNESS = 35;

// A cell is "washed" (inside-cloud look) when it is flat, edgeless, colorless
// and daytime-bright, all at once. Blue sky fails on saturation; below-deck
// horizons fail on contrast/edges; night fails on brightness.
const WASH_CONTRAST_MAX = 18;
const WASH_EDGES_MAX = 6;
const WASH_SATURATION_MAX = 0.12;
const WASH_BRIGHTNESS_MIN = 95;

// A row counts as washed when at least this many of its cells wash; the
// camera is in-cloud when BOTH row 0 (sky) and row 1 (horizon field) wash.
const WASHED_CELLS_PER_ROW_MIN = 4;

// Extremely washed-out bright frames read as fog regardless of cell votes
// (blown-out whiteout, glare through cloud).
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

/** One cell shows the inside-cloud look: flat, edgeless, gray, bright. */
function isWashed(c: CellMetrics): boolean {
  return (
    c.contrast < WASH_CONTRAST_MAX &&
    c.edges < WASH_EDGES_MAX &&
    c.saturation < WASH_SATURATION_MAX &&
    c.brightness >= WASH_BRIGHTNESS_MIN
  );
}

/**
 * Classify a single reading. Below the deck only the sky row washes (the
 * horizon row keeps distant detail); inside the deck the sky AND horizon rows
 * wash, leaving texture only in the near foreground; above the deck the sky
 * keeps saturation and the terrain keeps edges.
 */
export function classifyReading(
  r: Omit<PeakReading, 'camId' | 'status'>,
): PeakStatus {
  // Night / too dark to trust — exclude from the fog fit.
  if (r.brightness < DARK_BRIGHTNESS) return 'dark';

  const rowWashed = (row: number): boolean => {
    const cells = r.cells.slice(row * GRID_COLS, (row + 1) * GRID_COLS);
    return cells.reduce((a, c) => a + (isWashed(c) ? 1 : 0), 0) >= WASHED_CELLS_PER_ROW_MIN;
  };

  // Blown-out whiteout: near-white and still fairly flat overall.
  const whiteout =
    r.brightness > FOG_WHITEOUT_BRIGHTNESS_MIN &&
    r.contrast < FOG_WHITEOUT_CONTRAST_MAX;

  if ((r.cells.length >= 2 * GRID_COLS && rowWashed(0) && rowWashed(1)) || whiteout) return 'fog';

  return 'clear';
}

/**
 * Compute the four metrics for one already-loaded image by drawing it into a
 * shared downscale canvas and reading back the pixels.
 */
function measureRegion(
  lum: Float32Array,
  data: Uint8ClampedArray,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): CellMetrics {
  let n = 0;
  let sumL = 0;
  let sumSat = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * SAMPLE_W + x;
      const o = idx * 4;
      sumL += lum[idx];
      const rr = data[o];
      const gg = data[o + 1];
      const bb = data[o + 2];
      const max = rr > gg ? (rr > bb ? rr : bb) : gg > bb ? gg : bb;
      const min = rr < gg ? (rr < bb ? rr : bb) : gg < bb ? gg : bb;
      sumSat += max === 0 ? 0 : (max - min) / max;
      n++;
    }
  }
  const mean = n === 0 ? 0 : sumL / n;

  let sumSq = 0;
  let sumGrad = 0;
  let gradCount = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = y * SAMPLE_W + x;
      const d = lum[idx] - mean;
      sumSq += d * d;
      let g = 0;
      if (x + 1 < x1) g += Math.abs(lum[idx + 1] - lum[idx]);
      if (y + 1 < y1) g += Math.abs(lum[idx + SAMPLE_W] - lum[idx]);
      sumGrad += g;
      gradCount++;
    }
  }

  return {
    brightness: mean,
    contrast: n === 0 ? 0 : Math.sqrt(sumSq / n),
    saturation: n === 0 ? 0 : sumSat / n,
    edges: gradCount === 0 ? 0 : sumGrad / gradCount,
  };
}

function measureImage(
  img: HTMLImageElement,
  ctx: CanvasRenderingContext2D,
): Omit<PeakReading, 'camId' | 'status'> {
  // Source-crop the vendor chrome (logo strip top, timestamp bar bottom) so
  // overlay text can't masquerade as scene texture.
  const sy = img.naturalHeight * CROP_TOP;
  const sh = img.naturalHeight * (1 - CROP_TOP - CROP_BOTTOM);
  ctx.clearRect(0, 0, SAMPLE_W, SAMPLE_H);
  ctx.drawImage(img, 0, sy, img.naturalWidth, sh, 0, 0, SAMPLE_W, SAMPLE_H);
  const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);

  const n = SAMPLE_W * SAMPLE_H;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
  }

  const whole = measureRegion(lum, data, 0, 0, SAMPLE_W, SAMPLE_H);

  const cells: CellMetrics[] = [];
  const cw = SAMPLE_W / GRID_COLS;
  const ch = SAMPLE_H / GRID_ROWS;
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      cells.push(
        measureRegion(
          lum,
          data,
          Math.floor(c * cw),
          Math.floor(r * ch),
          Math.floor((c + 1) * cw),
          Math.floor((r + 1) * ch),
        ),
      );
    }
  }

  return { ...whole, cells };
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
      cells: [],
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
        cells: [],
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
 * Estimate the fog band from a set of readings.
 *
 * Uses only 'fog' and 'clear' cams. The marine layer is a band [B, T]: cams
 * below B are clear under the deck, cams inside are socked in, cams above T
 * are in the sun. Search all candidate (B, T) pairs (midpoints between
 * consecutive distinct usable elevations, plus a sentinel below everything =
 * "deck reaches the ground") maximizing correctly-placed cams; ties break
 * toward the thinnest band. If there are enough usable cams but zero fog,
 * that's a confident "no marine layer".
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
      baseM: null,
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
      baseM: null,
      confidence: 'high',
      sockedBelow: 0,
      clearAbove: usableCount,
      sampled,
      readings,
    };
  }

  // Candidate boundaries: midpoints between consecutive distinct elevations,
  // plus a sentinel below everything ("the deck reaches the ground/sea").
  const distinct = Array.from(new Set(usable.map((u) => u.elev))).sort(
    (a, b) => a - b,
  );
  const SENTINEL = distinct[0] - 1;
  const candidates: number[] = [SENTINEL];
  for (let i = 0; i + 1 < distinct.length; i++) {
    candidates.push((distinct[i] + distinct[i + 1]) / 2);
  }
  candidates.push(distinct[distinct.length - 1] + 1);

  // Search all (B <= T) pairs maximizing (clear < B) + (fog in [B,T]) +
  // (clear > T). ~50 sampled cams → ~1.3k pairs × 50 cams: trivial.
  let bestB = SENTINEL;
  let bestT = candidates[candidates.length - 1];
  let bestScore = -1;
  let bestInBand = 0;
  let bestAbove = 0;

  for (let bi = 0; bi < candidates.length; bi++) {
    for (let ti = bi; ti < candidates.length; ti++) {
      const B = candidates[bi];
      const T = candidates[ti];
      let score = 0;
      let inBand = 0;
      let above = 0;
      for (const u of usable) {
        if (u.elev < B) {
          if (!u.fog) score++;
        } else if (u.elev <= T) {
          if (u.fog) {
            score++;
            inBand++;
          }
        } else if (!u.fog) {
          score++;
          above++;
        }
      }
      const better =
        score > bestScore ||
        (score === bestScore && T - B < bestT - bestB);
      if (better) {
        bestScore = score;
        bestB = B;
        bestT = T;
        bestInBand = inBand;
        bestAbove = above;
      }
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
    baseM: bestB <= distinct[0] ? null : bestB,
    confidence,
    sockedBelow: bestInBand,
    clearAbove: bestAbove,
    sampled,
    readings,
  };
}
