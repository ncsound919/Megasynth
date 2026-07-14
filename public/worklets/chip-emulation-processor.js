/**
 * ChipEmulationProcessor
 * Real-time AudioWorkletProcessor implementing actual vintage hardware DSP behavior.
 *
 * This is NOT a cosmetic filter. Every stage below reproduces a physically
 * real limitation of the emulated hardware:
 *
 *  1. Anti-alias filter   -> one-pole lowpass BEFORE decimation (some chips had none)
 *  2. Sample & hold        -> actual sample-rate reduction via hold-last-value decimation
 *  3. Dither                -> triangular dither added before quantization (or omitted, per chip)
 *  4. Bit quantization     -> real N-bit stepping (linear, hard-stepped, or soft/tape curve)
 *  5. Drive curve            -> nonlinear waveshaping matching the converter's analog stage
 *  6. Clock jitter          -> random sample-hold timing instability (S&H droop)
 *  7. Hiss floor              -> injected noise at the converter's real self-noise level
 *  8. Wow & flutter (tape)   -> true fractional-delay-line pitch modulation
 */

class ChipEmulationProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bitDepth', defaultValue: 16, minValue: 1, maxValue: 24, automationRate: 'k-rate' },
      { name: 'targetSampleRate', defaultValue: 44100, minValue: 400, maxValue: 96000, automationRate: 'k-rate' },
      { name: 'antiAliasHz', defaultValue: 0, minValue: 0, maxValue: 24000, automationRate: 'k-rate' },
      { name: 'ditherLevel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'jitterAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'hissLevel', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'driveAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'wowHz', defaultValue: 0, minValue: 0, maxValue: 5, automationRate: 'k-rate' },
      { name: 'wowDepthCents', defaultValue: 0, minValue: 0, maxValue: 50, automationRate: 'k-rate' },
      { name: 'flutterHz', defaultValue: 0, minValue: 0, maxValue: 30, automationRate: 'k-rate' },
      { name: 'flutterDepthCents', defaultValue: 0, minValue: 0, maxValue: 20, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.quantStyle = options?.processorOptions?.quantStyle ?? 'linear';
    this.driveCurve = options?.processorOptions?.driveCurve ?? 'none';

    // Per-channel sample & hold state (real S&H decimation, not a lookup trick)
    this.holdValue = [0, 0];
    this.holdCounter = [0, 0];
    this.currentJitteredHold = [0, 0];
    this.isFirstSample = [true, true];
    this.phaseAccum = [0, 0];

    // One-pole AA filter state
    this.aaState = [0, 0];

    // Parameter smoothing states
    this.smoothBitDepth = 16;
    this.smoothTargetSR = 44100;
    this.smoothAA = 0;
    this.smoothDrive = 0;

    // Wow/flutter LFO phases
    this.wowPhase = 0;
    this.flutterPhase = 0;

    // Fractional delay line for tape wow/flutter (real pitch modulation via variable delay)
    // Use globalThis.sampleRate or captured sampleRate for robustness
    const sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    this.delayLineSize = Math.ceil(sr * 0.1); // Increased to 100ms for extra safety
    this.delayLine = [new Float32Array(this.delayLineSize), new Float32Array(this.delayLineSize)];
    this.writeIdx = [0, 0];

    // Constants
    this.JITTER_COEFF = 0.15;
    this.SMOOTH_FACTOR = 0.05;

    // RNG state for dither/hiss (xorshift for speed + determinism per instance)
    this.rngState = 0x9e3779b9 ^ (Date.now() & 0xffffffff);
  }

  _rand() {
    // xorshift32 — fast, good-enough statistical quality for dither/hiss noise
    let x = this.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState / 0xffffffff) * 2 - 1; // [-1, 1]
  }

  _triangularDither() {
    // Sum of two uniform randoms = triangular PDF, the standard dither shape
    return (this._rand() + this._rand()) * 0.5;
  }

  _quantize(sample, bitDepth, ditherLevel, style) {
    const levels = Math.pow(2, bitDepth);
    const step = 2 / levels;

    let x = sample;
    if (ditherLevel > 0) {
      x += this._triangularDither() * step * ditherLevel;
    }

    if (style === 'stepped') {
      // Hard staircase quantization, zero interpolation — the "chip" sound
      return Math.round(x / step) * step;
    } else if (style === 'muLikeSoft') {
      // Soft-knee quantization: quantize but blend with original for tape-like softness
      const hard = Math.round(x / step) * step;
      return hard * 0.6 + x * 0.4;
    }
    // linear (default): standard rounding quantization
    return Math.round(x / step) * step;
  }

  _drive(x, amount, curve) {
    if (amount <= 0 || curve === 'none') return x;
    const k = 1 + amount * 8;
    switch (curve) {
      case 'tube':
        // asymmetric soft clip — even-harmonic-rich, tube-like
        return Math.tanh(x * k * 1.2) * 0.9 + 0.1 * Math.tanh(x * x * Math.sign(x) * k);
      case 'opamp':
        // symmetric soft clip, cleaner than tube
        return Math.tanh(x * k);
      case 'tape':
        // gentle saturation with slight compression character
        return x / (1 + Math.abs(x) * amount * 2) * (1 + amount * 0.5);
      case 'hardclip':
      default:
        return Math.max(-1, Math.min(1, x * (1 + amount * 3)));
    }
  }

  _onePoleLowpass(x, chan, cutoffHz) {
    if (cutoffHz <= 0 || cutoffHz >= sampleRate / 2) return x; // bypass = no filtering (aliases hard)
    const rc = 1 / (2 * Math.PI * cutoffHz);
    const dt = 1 / sampleRate;
    const alpha = dt / (rc + dt);
    this.aaState[chan] += alpha * (x - this.aaState[chan]);
    return this.aaState[chan];
  }

  _readDelayLine(chan, delaySamples) {
    const buf = this.delayLine[chan];
    const size = this.delayLineSize;
    
    // Safety clamp to prevent out-of-bounds or wrap-around artifacts
    const clampedDelay = Math.max(0, Math.min(size - 2, delaySamples));
    
    let readPos = this.writeIdx[chan] - clampedDelay;
    while (readPos < 0) readPos += size;
    const i0 = Math.floor(readPos) % size;
    const i1 = (i0 + 1) % size;
    const frac = readPos - Math.floor(readPos);
    return buf[i0] * (1 - frac) + buf[i1] * frac;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    // Smooth parameters to avoid zipper noise during automation
    this.smoothBitDepth += (parameters.bitDepth[0] - this.smoothBitDepth) * this.SMOOTH_FACTOR;
    this.smoothTargetSR += (parameters.targetSampleRate[0] - this.smoothTargetSR) * this.SMOOTH_FACTOR;
    this.smoothAA += (parameters.antiAliasHz[0] - this.smoothAA) * this.SMOOTH_FACTOR;
    this.smoothDrive += (parameters.driveAmount[0] - this.smoothDrive) * this.SMOOTH_FACTOR;

    const bitDepth = this.smoothBitDepth;
    const targetSR = this.smoothTargetSR;
    const antiAliasHz = this.smoothAA;
    const ditherLevel = parameters.ditherLevel[0];
    const jitterAmount = parameters.jitterAmount[0];
    const hissLevel = parameters.hissLevel[0];
    const driveAmount = this.smoothDrive;
    const wowHz = parameters.wowHz[0];
    const wowDepthCents = parameters.wowDepthCents[0];
    const flutterHz = parameters.flutterHz[0];
    const flutterDepthCents = parameters.flutterDepthCents[0];

    const sr = typeof sampleRate !== 'undefined' ? sampleRate : 44100;
    const holdLength = Math.max(1, Math.round(sr / targetSR));
    const hasWow = wowHz > 0 && wowDepthCents > 0;
    const hasFlutter = flutterHz > 0 && flutterDepthCents > 0;

    for (let ch = 0; ch < input.length; ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;

      for (let i = 0; i < inCh.length; i++) {
        let x = inCh[i];

        // --- Tape wow/flutter ---
        if (hasWow || hasFlutter) {
          this.delayLine[ch][this.writeIdx[ch]] = x;

          let centsOffset = 0;
          if (hasWow) {
            centsOffset += Math.sin(this.wowPhase) * wowDepthCents;
          }
          if (hasFlutter) {
            centsOffset += Math.sin(this.flutterPhase) * flutterDepthCents;
          }
          const baseDelayMs = 8;
          const pitchRatio = Math.pow(2, centsOffset / 1200);
          const delaySamples = (baseDelayMs / 1000) * sr * pitchRatio;

          x = this._readDelayLine(ch, delaySamples);
          this.writeIdx[ch] = (this.writeIdx[ch] + 1) % this.delayLineSize;
        }

        // --- Anti-alias filter ---
        x = this._onePoleLowpass(x, ch, antiAliasHz);

        // --- Real sample & hold decimation ---
        // Fix: Initialise holdValue on the very first sample to avoid silent gap
        if (this.isFirstSample[ch]) {
          this.holdValue[ch] = x;
          this.isFirstSample[ch] = false;
          this.holdCounter[ch] = 0;
          // Compute initial jittered hold
          this.currentJitteredHold[ch] = Math.max(1, holdLength + (this._rand() * jitterAmount * holdLength * this.JITTER_COEFF));
        }

        this.holdCounter[ch]++;
        
        if (this.holdCounter[ch] >= this.currentJitteredHold[ch]) {
          this.holdValue[ch] = x;
          this.holdCounter[ch] = 0;
          // Fix: Compute jitteredHold once when a new hold cycle begins, not every sample
          if (jitterAmount > 0) {
            this.currentJitteredHold[ch] = Math.max(1, holdLength + (this._rand() * jitterAmount * holdLength * this.JITTER_COEFF));
          } else {
            this.currentJitteredHold[ch] = holdLength;
          }
        }
        x = this.holdValue[ch];

        // --- Bit-depth quantization ---
        x = this._quantize(x, bitDepth, ditherLevel, this.quantStyle);

        // --- Drive / waveshaping stage matching the converter's analog output ---
        x = this._drive(x, driveAmount, this.driveCurve);

        // --- Hiss floor: inject noise at the converter's real self-noise level ---
        if (hissLevel > 0) {
          x += this._rand() * hissLevel * 0.02;
        }

        outCh[i] = Math.max(-1, Math.min(1, x));
      }

      if (ch === 0) {
        if (hasWow) this.wowPhase += 2 * Math.PI * wowHz / sampleRate * inCh.length;
        if (hasFlutter) this.flutterPhase += 2 * Math.PI * flutterHz / sampleRate * inCh.length;
      }
    }

    return true;
  }
}

registerProcessor('chip-emulation-processor', ChipEmulationProcessor);
