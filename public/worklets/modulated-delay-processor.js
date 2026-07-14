/**
 * ModulatedDelayProcessor
 * Runs N real modulated delay-line taps with LFO-driven fractional delay,
 * used for both Chorus and Flanger. This is the actual physical mechanism
 * behind both effects — the only real difference between them is depth,
 * rate range, and whether feedback is used (flanger) or not (chorus).
 */
class ModulatedDelayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rateHz', defaultValue: 0.8, minValue: 0.01, maxValue: 10, automationRate: 'k-rate' },
      { name: 'depthMs', defaultValue: 4, minValue: 0, maxValue: 20, automationRate: 'k-rate' },
      { name: 'baseDelayMs', defaultValue: 5, minValue: 0, maxValue: 30, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0, minValue: 0, maxValue: 0.95, automationRate: 'k-rate' },
      { name: 'voices', defaultValue: 1, minValue: 1, maxValue: 4, automationRate: 'k-rate' },
      { name: 'stereoSpread', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.maxDelaySamples = Math.ceil(sampleRate * 0.05); // 50ms max buffer
    this.buffers = [
      new Float32Array(this.maxDelaySamples), // L
      new Float32Array(this.maxDelaySamples), // R
    ];
    this.writeIdx = [0, 0];
    this.phase = [0, 0, 0, 0]; // up to 4 voice phases
  }

  _read(buf, writeIdx, delaySamples) {
    const size = buf.length;
    let readPos = writeIdx - delaySamples;
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

    const rateHz = parameters.rateHz[0];
    const depthMs = parameters.depthMs[0];
    const baseDelayMs = parameters.baseDelayMs[0];
    const feedback = parameters.feedback[0];
    const voices = Math.round(parameters.voices[0]);
    const stereoSpread = parameters.stereoSpread[0];

    for (let ch = 0; ch < Math.min(2, input.length); ch++) {
      const inCh = input[ch];
      const outCh = output[ch];
      if (!inCh || !outCh) continue;
      const buf = this.buffers[ch];

      for (let i = 0; i < inCh.length; i++) {
        let wetSum = 0;
        for (let v = 0; v < voices; v++) {
          // Each voice gets a phase offset for stereo width / chorus richness
          const phaseOffset = (v / voices) * 2 * Math.PI + (ch === 1 ? stereoSpread * Math.PI : 0);
          const lfo = Math.sin(this.phase[v] + phaseOffset);
          const modDelayMs = baseDelayMs + (lfo * 0.5 + 0.5) * depthMs;
          const delaySamples = (modDelayMs / 1000) * sampleRate;
          wetSum += this._read(buf, this.writeIdx[ch], delaySamples);
        }
        wetSum /= voices;

        const inputSample = inCh[i] + wetSum * feedback;
        buf[this.writeIdx[ch]] = inputSample;
        this.writeIdx[ch] = (this.writeIdx[ch] + 1) % buf.length;

        outCh[i] = wetSum;
      }
    }

    // Advance LFO phases once per block (per-voice, shared across channels)
    for (let v = 0; v < 4; v++) {
      this.phase[v] += 2 * Math.PI * rateHz * (input[0] ? input[0].length : 128) / sampleRate;
    }

    return true;
  }
}

registerProcessor('modulated-delay-processor', ModulatedDelayProcessor);
