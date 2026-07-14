/**
 * Generates a deterministic synthetic impulse response for use with ConvolverNode.
 * All randomness is seeded, making the IR identical for the same parameters.
 */
export function generateImpulseResponse(
  ctx: BaseAudioContext,
  type: 'room' | 'hall' | 'plate' | 'shimmer',
  sizePct: number,
  decayPct: number,
  dampingPct: number,
  cache?: { params: string; buffer: AudioBuffer } // external cache (optional)
): AudioBuffer {
  // Build a parameter fingerprint to enable caching
  const paramsKey = `${type}_${sizePct}_${decayPct}_${dampingPct}`;
  if (cache && cache.params === paramsKey) return cache.buffer;

  const sampleRate = ctx.sampleRate;
  const sizeScale = 0.3 + (sizePct / 100) * 2.7;        // 0.3s .. 3.0s
  const decayScale = 0.5 + (decayPct / 100) * 3.5;       // exponent multiplier
  const damping = dampingPct / 100;

  let durationSec: number;
  let densityBase: number; // density of the diffuse tail (reflections per sec)
  switch (type) {
    case 'room':
      durationSec = sizeScale * 0.6;
      densityBase = 800;
      break;
    case 'hall':
      durationSec = sizeScale * 1.4;
      densityBase = 400;
      break;
    case 'plate':
      durationSec = sizeScale * 1.0;
      densityBase = 1600;
      break;
    case 'shimmer':
      durationSec = sizeScale * 1.8;
      densityBase = 400;
      break;
  }

  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, sampleRate);

  // Seeded PRNG (xorshift) – ensures determinism
  const createRng = (seed: number) => {
    let state = seed;
    return () => {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      state >>>= 0;
      return (state / 0xffffffff) * 2 - 1;
    };
  };

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rng = createRng(12345 + ch * 999 + Math.round(sizePct * 1000 + decayPct * 100 + dampingPct * 10)); // incorporate all parameters

    // --- 1. Early reflections – structured tap pattern (no rand for timing)
    const earlyCount = type === 'plate' ? 25 : 14;
    const earlyEnd = Math.floor(length * 0.15);
    for (let r = 0; r < earlyCount; r++) {
      // Place taps at regular intervals, slightly jittered by rng (but deterministic)
      const basePos = (r / earlyCount) * earlyEnd;
      const jitter = Math.floor(rng() * (earlyEnd / earlyCount) * 0.8);
      const t = Math.min(length - 1, Math.max(0, Math.floor(basePos + jitter)));
      const amp = 0.6 * (1 - r / earlyCount);
      data[t] += amp * (rng() > 0 ? 1 : -1);
    }

    // --- 2. Diffuse reverberant tail – exponentially decaying noise
    for (let i = 0; i < length; i++) {
      const tSec = i / sampleRate;
      // Envelope
      let envelope = Math.exp(-tSec * (decayScale / durationSec) * 3.5);
      // Damping: attenuate high frequencies by applying a one‑pole lowpass inline
      // (simple implementation: reduce high‑freq energy via smoothing of the noise)
      const rawNoise = rng();
      // Damping factor: progressively darker when damping > 0
      const dampFactor = Math.exp(-tSec * damping * 8);
      const noise = rawNoise * (1 - damping * 0.6) + dampFactor * damping * 0.6 * (rng()); // mix raw with damped
      data[i] += noise * envelope * 0.4;

      // Density control: smooth blending of nearby samples to simulate increasing diffuseness
      if (densityBase < 1600) {
        const blend = Math.min(1, densityBase / 1600);
        if (i > 1) {
          data[i] = data[i] * (1 - blend * 0.5) + (data[i-1] + data[i+1] || 0) * 0.25 * blend;
        }
      }
    }

    // --- 3. Shimmer: octave-up feedback layer
    if (type === 'shimmer') {
      const shimmerStart = Math.floor(length * 0.08);
      const shimmerData = new Float32Array(length);
      for (let i = shimmerStart; i < length; i++) {
        const srcIdx = shimmerStart + (i - shimmerStart) * 2;
        if (srcIdx < length) shimmerData[i] = data[srcIdx];
      }
      // Blend only in the region after the early reflections
      for (let i = shimmerStart; i < length; i++) {
        data[i] = data[i] * 0.7 + shimmerData[i] * 0.35;
      }
    }
  }

  // Normalize to avoid clipping
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let peak = 0;
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) {
      const norm = 0.9 / peak;
      for (let i = 0; i < data.length; i++) data[i] *= norm;
    }
  }

  if (cache) {
    cache.params = paramsKey;
    cache.buffer = buffer;
  }

  return buffer;
}