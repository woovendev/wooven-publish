/**
 * Client-side census of a colour layer on a masked map.
 * Visible ground excludes the black mask and any painted mask.
 * Share = tracked / visible.
 *
 * Beton (sealed surface) is visible ground that is neither the
 * vegetation hue family nor saturated water blue. Cool gray pavement
 * stays in the sealed count — it is not the river.
 */

export const BLACK_CUTOFF = 12;

export const GREEN_BAND = { hue: 145, window: 20, minSat: 0.15, l0: 0.16, l1: 0.94 };
export const WATER_BAND = { hue: 214, window: 16, minSat: 0.2, l0: 0.32, l1: 0.9 };

export function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function writeHsl(r, g, b, out) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const mx = rf > gf ? (rf > bf ? rf : bf) : gf > bf ? gf : bf;
  const mn = rf < gf ? (rf < bf ? rf : bf) : gf < bf ? gf : bf;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  out.l = l;
  if (d === 0) {
    out.h = 0;
    out.s = 0;
    return;
  }
  out.s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0);
  else if (mx === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  out.h = h * 60;
}

export function rgbToHsl(r, g, b) {
  const out = { h: 0, s: 0, l: 0 };
  writeHsl(r, g, b, out);
  return out;
}

export function inBand(h, s, l, band) {
  if (s < band.minSat || l < band.l0 || l > band.l1) return false;
  return hueDist(h, band.hue) <= band.window;
}

function matchSample(h, s, l, samples, hueWindow, minSat, lightWindow) {
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    // Near-grey pavement has no stable hue — match lightness instead.
    if (sample.s < 0.18) {
      if (s < 0.18 && Math.abs(l - sample.l) <= 0.1) return true;
    } else if (
      s >= minSat &&
      Math.abs(l - sample.l) <= lightWindow &&
      hueDist(h, sample.h) <= hueWindow
    ) {
      return true;
    }
  }
  return false;
}

function isTracked(type, h, s, l, samples, hueWindow, minSat, lightWindow) {
  if (type === "green") return inBand(h, s, l, GREEN_BAND);
  if (type === "paved") return !inBand(h, s, l, GREEN_BAND) && !inBand(h, s, l, WATER_BAND);
  if (type === "samples") return matchSample(h, s, l, samples, hueWindow, minSat, lightWindow);
  return false;
}

export function visibleBounds(pixels, width, height, cutoff = BLACK_CUTOFF) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let black = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = (row + x) << 2;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      if (a < 16 || (r <= cutoff && g <= cutoff && b <= cutoff)) {
        black++;
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height, black, empty: true };
  const pad = 2;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width - 1, maxX + pad);
  const y1 = Math.min(height - 1, maxY + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, black, empty: false };
}

/**
 * @param {Uint8ClampedArray} pixels RGBA
 * @param {Uint8Array | null} mask 1 = painted out
 * @param {{
 *   rule: { type: 'paved' | 'green' | 'samples', samples?: {h:number,s:number,l:number}[], hueWindow?: number, minSat?: number, lightWindow?: number },
 *   excludeBlack?: boolean,
 *   blackCutoff?: number,
 *   showLayer?: boolean,
 *   view?: { x:number, y:number, w:number, h:number } | null,
 *   out?: Uint8ClampedArray | null
 * }} opt
 */
export function survey(pixels, width, height, mask, opt) {
  const cut = opt.blackCutoff ?? BLACK_CUTOFF;
  const excludeBlack = opt.excludeBlack !== false;
  const rule = opt.rule;
  const type = rule.type;
  const samples = rule.samples || [];
  const hueWindow = rule.hueWindow ?? 22;
  const minSat = rule.minSat ?? 0.12;
  const lightWindow = rule.lightWindow ?? 0.5;
  const showLayer = !!opt.showLayer;
  const view = opt.view;
  const out = opt.out;
  const write = !!(view && out);
  const vx = write ? view.x : 0;
  const vy = write ? view.y : 0;
  const vw = write ? view.w : 0;
  const vh = write ? view.h : 0;
  const countOnly = type === "samples" && samples.length === 0;

  let visible = 0;
  let tracked = 0;
  let excludedBlack = 0;
  let excludedPaint = 0;
  let blackPixels = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const hatchStep = opt.hatchStep || 32;
  // Reused so the census does not allocate a colour object per pixel.
  const hsl = { h: 0, s: 0, l: 0 };

  for (let y = 0; y < height; y++) {
    const row = y * width;
    const inY = write && y >= vy && y < vy + vh;
    for (let x = 0; x < width; x++) {
      const p = row + x;
      const i = p << 2;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const a = pixels[i + 3];
      const painted = mask ? mask[p] === 1 : false;
      const isBlack = r <= cut && g <= cut && b <= cut;
      const dropped = a < 16 || painted || (excludeBlack && isBlack);
      if (isBlack) blackPixels++;
      let match = false;
      if (!dropped) {
        visible++;
        if (!countOnly) {
          writeHsl(r, g, b, hsl);
          match = isTracked(type, hsl.h, hsl.s, hsl.l, samples, hueWindow, minSat, lightWindow);
          if (match) {
            tracked++;
            sumR += r;
            sumG += g;
            sumB += b;
          }
        }
      } else if (painted) {
        excludedPaint++;
      } else {
        excludedBlack++;
      }
      if (inY && x >= vx && x < vx + vw) {
        const oi = ((y - vy) * vw + (x - vx)) << 2;
        if (painted) {
          const on = (Math.floor(x / hatchStep) + Math.floor(y / hatchStep)) % 2 === 0;
          const v = on ? 255 : 0;
          out[oi] = v;
          out[oi + 1] = v;
          out[oi + 2] = v;
          out[oi + 3] = 255;
        } else if (dropped) {
          out[oi] = 0;
          out[oi + 1] = 0;
          out[oi + 2] = 0;
          out[oi + 3] = 255;
        } else if (showLayer && !match) {
          out[oi] = (r * 0.18) | 0;
          out[oi + 1] = (g * 0.18) | 0;
          out[oi + 2] = (b * 0.18) | 0;
          out[oi + 3] = 255;
        } else {
          out[oi] = r;
          out[oi + 1] = g;
          out[oi + 2] = b;
          out[oi + 3] = 255;
        }
      }
    }
  }

  const pct = !countOnly && visible > 0 ? (tracked / visible) * 100 : null;
  return {
    visible,
    tracked,
    excluded: excludedBlack + excludedPaint,
    excludedBlack,
    excludedPaint,
    blackPixels,
    total: width * height,
    pct,
    mean: tracked
      ? [(sumR / tracked) | 0, (sumG / tracked) | 0, (sumB / tracked) | 0]
      : null,
  };
}
