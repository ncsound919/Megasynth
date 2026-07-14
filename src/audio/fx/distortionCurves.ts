import { DistortionStyle } from '../../types';

/**
 * Builds transfer curves modeled after iconic hardware stages.
 * Each style (A, E, N, T, P) creates a unique harmonic profile.
 */
export function buildDistortionCurve(style: DistortionStyle, driveAmt: number, punish: boolean, samples = 2048): Float32Array {
  const out = new Float32Array(samples);
  // Punish adds a massive gain boost (approx 20dB)
  const baseK = 1 + driveAmt * 12;
  const k = punish ? baseK * 10 : baseK;

  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    let y: number;

    switch (style) {
      case 'A': { // Ampex (Tape) - Symmetric soft clipping with smooth saturation
        y = (2 / Math.PI) * Math.atan(x * k * 0.8);
        break;
      }
      case 'E': { // EMI (Tube) - Slight asymmetry, warm even harmonics
        const asym = 0.05 * driveAmt;
        const x_mod = x + asym;
        y = Math.tanh(x_mod * k * 0.9) - Math.tanh(asym * k * 0.9);
        break;
      }
      case 'N': { // Neve (Console) - Heavy low-mid density, transformer saturation
        // Use a modified sigmoid that compresses more on one side
        const g = x * k;
        y = g / (1 + Math.abs(g));
        // Add a second-order component for transformer weight
        y = y * 0.9 + (y * y * Math.sign(y)) * 0.1;
        break;
      }
      case 'T': { // Thermionic (Tube) - Pentode-style symmetric aggression
        const sign = Math.sign(x);
        const absX = Math.abs(x);
        y = sign * (1 - Math.exp(-absX * k));
        break;
      }
      case 'P': { // Pentode (Aggressive Tube) - Heavy asymmetry and hard-clipped character
        // BUG FIX: previous version added a static `asym` offset directly into x_mod
        // BEFORE hard-clipping/tanh, which produced a DC bias of ~0.1 at x=0
        // (verified empirically: y(x=0) = 0.0965 instead of ~0). This biased the
        // waveform away from silence-preserving behavior. Fix: apply the asymmetry
        // as a post-shaping bias subtracted back out at x=0, matching the
        // DC-correction pattern already used correctly in style 'E'.
        const asym = 0.2 * driveAmt;
        const x_mod = x * k + asym;
        const zeroRef = (Math.max(-1, Math.min(1, asym)) * 0.8) + (Math.tanh(asym) * 0.2);
        y = ((Math.max(-1, Math.min(1, x_mod)) * 0.8) + (Math.tanh(x_mod) * 0.2)) - zeroRef;
        break;
      }
      default:
        y = Math.tanh(x * k);
    }

    out[i] = y;
  }

  // Normalize the entire curve so it reaches exactly 1.0 at full input
  let max = 0;
  for (let i = 0; i < samples; i++) max = Math.max(max, Math.abs(out[i]));
  if (max > 0) {
    for (let i = 0; i < samples; i++) out[i] /= max;
  }

  return out;
}

/**
 * Pre-emphasis / Tone shaping logic.
 * tone: -100 (dark) .. +100 (bright)
 *
 * BUG FIX: previous version used different frequency formulas for the
 * bright branch (tone >= 0) and dark branch (tone < 0), causing the shelf
 * frequency to jump discontinuously at tone=0 (verified empirically:
 * 3000 Hz on one side of center vs. ~5000 Hz on the other). This produced
 * an audible snap/zipper right at the control's center detent. Fixed by
 * using a single continuous piecewise-linear frequency curve that equals
 * the same value from both directions at tone=0.
 */
export function toneToFilterParams(tone: number): { type: BiquadFilterType; freq: number; gain: number } {
  const gain = (tone / 100) * 12;
  let freq: number;
  if (tone >= 0) {
    // Bright: shelf frequency descends from 3000 Hz (center) to 1500 Hz (full bright)
    freq = 3000 - (tone / 100) * 1500;
  } else {
    // Dark: shelf frequency ascends from 3000 Hz (center) to 8000 Hz (full dark)
    freq = 3000 - (tone / 100) * 5000;
  }
  return { type: 'highshelf', freq, gain };
}
