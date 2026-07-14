/**
 * SidechainCompressorProcessor
 * A real feed-forward compressor with an independent sidechain input.
 * Input 0: main audio signal (what gets compressed)
 * Input 1: sidechain trigger signal (what drives the gain reduction)
 *
 * Parameters are sent via port.postMessage({ type: 'params', ... })
 * Gain reduction is reported back via port.postMessage({ type: 'gainReduction', grDb })
 */
class SidechainCompressorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Compressor state
    this._enabled = true;
    this._threshold = -18;   // dBFS
    this._ratio = 4;         // n:1
    this._attack = 0.01;     // seconds
    this._release = 0.1;     // seconds
    this._makeupGain = 0;    // dB

    // Envelope follower state (one per channel)
    this._envelope = 0;

    // GR reporting throttle: report every 128 samples
    this._grReportCounter = 0;
    this._lastGrDb = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === 'params') {
        this._enabled   = e.data.enabled   ?? this._enabled;
        this._threshold = e.data.threshold ?? this._threshold;
        this._ratio     = e.data.ratio     ?? this._ratio;
        this._attack    = e.data.attack    ?? this._attack;
        this._release   = e.data.release   ?? this._release;
        this._makeupGain = e.data.makeupGain ?? this._makeupGain;
      }
    };
  }

  /**
   * Convert linear amplitude to dBFS.
   * Clamped to -120 dBFS floor to avoid -Infinity.
   */
  _linToDb(lin) {
    return 20 * Math.log10(Math.max(lin, 1e-6));
  }

  /**
   * Convert dBFS to linear amplitude.
   */
  _dbToLin(db) {
    return Math.pow(10, db / 20);
  }

  process(inputs, outputs) {
    const mainIn  = inputs[0];   // main signal
    const scIn    = inputs[1];   // sidechain trigger
    const mainOut = outputs[0];

    // If no main input, pass silence
    if (!mainIn || mainIn.length === 0) return true;

    const numChannels = Math.min(mainIn.length, mainOut.length);
    const blockSize   = mainIn[0] ? mainIn[0].length : 128;

    // Pre-compute per-sample attack/release coefficients from time constants.
    // Coefficient formula: c = exp(-1 / (time_sec * sampleRate))
    // At c=0 the envelope tracks instantly; approaching 1 it tracks very slowly.
    const attackCoef  = Math.exp(-1 / (Math.max(0.0001, this._attack)  * sampleRate));
    const releaseCoef = Math.exp(-1 / (Math.max(0.0001, this._release) * sampleRate));

    const threshLin   = this._dbToLin(this._threshold);
    const makeupLin   = this._dbToLin(this._makeupGain);
    const slope       = 1 - 1 / Math.max(1, this._ratio);  // 0 = no compression, 1 = limiting

    let peakGrDb = 0; // track worst-case GR this block for reporting

    for (let i = 0; i < blockSize; i++) {
      // --- 1. Detect sidechain level (peak across all sidechain channels) ---
      let scPeak = 0;
      if (scIn && scIn.length > 0) {
        for (let ch = 0; ch < scIn.length; ch++) {
          if (scIn[ch]) {
            const abs = Math.abs(scIn[ch][i] || 0);
            if (abs > scPeak) scPeak = abs;
          }
        }
      } else {
        // No sidechain connected: use the main input as the detector (standard compressor)
        for (let ch = 0; ch < mainIn.length; ch++) {
          if (mainIn[ch]) {
            const abs = Math.abs(mainIn[ch][i] || 0);
            if (abs > scPeak) scPeak = abs;
          }
        }
      }

      // --- 2. Envelope follower (peak-tracking, asymmetric attack/release) ---
      if (scPeak > this._envelope) {
        this._envelope = attackCoef  * this._envelope + (1 - attackCoef)  * scPeak;
      } else {
        this._envelope = releaseCoef * this._envelope + (1 - releaseCoef) * scPeak;
      }

      // --- 3. Gain computer (feed-forward, hard-knee) ---
      let gainLin = 1;
      if (this._enabled && this._envelope > threshLin) {
        // Overshoot above threshold in dB
        const overDb = this._linToDb(this._envelope) - this._threshold;
        // Apply ratio to compute gain reduction
        const grDb = slope * overDb;
        gainLin = this._dbToLin(-grDb) * makeupLin;
        if (grDb > peakGrDb) peakGrDb = grDb;
      } else {
        gainLin = makeupLin;
      }

      // --- 4. Apply gain to all main channels ---
      for (let ch = 0; ch < numChannels; ch++) {
        mainOut[ch][i] = (mainIn[ch] ? mainIn[ch][i] : 0) * gainLin;
      }
    }

    // --- 5. Report gain reduction back to the main thread (throttled) ---
    this._grReportCounter += blockSize;
    if (this._grReportCounter >= 128) {
      this._grReportCounter = 0;
      if (Math.abs(peakGrDb - this._lastGrDb) > 0.1) {
        this.port.postMessage({ type: 'gainReduction', grDb: peakGrDb });
        this._lastGrDb = peakGrDb;
      }
    }

    return true;
  }
}

registerProcessor('sidechain-compressor', SidechainCompressorProcessor);
