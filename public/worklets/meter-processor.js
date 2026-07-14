/**
 * MeterProcessor
 * Computes REAL peak and RMS levels from the actual audio signal passing
 * through this node, and posts them to the main thread ~30x/sec.
 *
 * This replaces UI code that received `peakLevels` as an arbitrary prop
 * with no real signal source — here the numbers are measured, not invented.
 */
class MeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.peakHold = 0;
    this.peakHoldFrames = 0;
    this.peakHoldDuration = Math.round(sampleRate * 1.5 / 128); // ~1.5s hold in 128-sample blocks
    this.rms = 0;
    this.frameCount = 0;
    this.reportEveryNBlocks = 4; // ~344 blocks/sec / 4 = ~86 reports/sec at 44.1k, throttled below
    this._sinceReport = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    let peak = 0;
    let sumSquares = 0;
    let count = 0;

    for (let ch = 0; ch < input.length; ch++) {
      const data = input[ch];
      if (!data) continue;
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        const av = Math.abs(v);
        if (av > peak) peak = av;
        sumSquares += v * v;
        count++;
      }
    }

    const blockRms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    // Simple exponential smoothing for RMS (real ballistic response, ~300ms-ish)
    this.rms = this.rms * 0.92 + blockRms * 0.08;

    // True peak hold with decay
    if (peak >= this.peakHold) {
      this.peakHold = peak;
      this.peakHoldFrames = 0;
    } else {
      this.peakHoldFrames++;
      if (this.peakHoldFrames > this.peakHoldDuration) {
        this.peakHold *= 0.95; // gradual decay after hold time
      }
    }

    this._sinceReport++;
    if (this._sinceReport >= this.reportEveryNBlocks) {
      this._sinceReport = 0;
      this.port.postMessage({
        rms: this.rms,
        peak: peak,
        peakHold: this.peakHold,
        clipping: peak >= 0.999,
      });
    }

    return true;
  }
}

registerProcessor('meter-processor', MeterProcessor);
