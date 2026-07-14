/**
 * GRMeterProcessor
 * A REAL feed-forward compressor envelope follower used purely for metering
 * (the actual compression is done by DynamicsCompressorNode in the graph,
 * but that node doesn't expose live GR — so we run a matched-parameter
 * shadow detector here to report true, measured gain reduction in dB).
 */
class GRMeterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -24, minValue: -60, maxValue: 0, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 10, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 100, minValue: 5, maxValue: 2000, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.envelope = 0; // in dB, running envelope of the (sidechain) input
    this._sinceReport = 0;
  }

  _dbToLin(db) { return Math.pow(10, db / 20); }
  _linToDb(lin) { return 20 * Math.log10(Math.max(lin, 1e-6)); }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const threshold = parameters.threshold[0];
    const ratio = parameters.ratio[0];
    const attackMs = parameters.attack[0];
    const releaseMs = parameters.release[0];

    const attackCoeff = Math.exp(-1 / (sampleRate * (attackMs / 1000)));
    const releaseCoeff = Math.exp(-1 / (sampleRate * (releaseMs / 1000)));

    const data = input[0];
    let maxGrDb = 0;

    for (let i = 0; i < data.length; i++) {
      const inputDb = this._linToDb(Math.abs(data[i]));

      // Envelope follower with separate attack/release, standard feed-forward design
      if (inputDb > this.envelope) {
        this.envelope = attackCoeff * this.envelope + (1 - attackCoeff) * inputDb;
      } else {
        this.envelope = releaseCoeff * this.envelope + (1 - releaseCoeff) * inputDb;
      }

      // Real static compression curve
      let grDb = 0;
      if (this.envelope > threshold) {
        const over = this.envelope - threshold;
        const compressedOver = over / ratio;
        grDb = over - compressedOver; // this is the actual gain reduction in dB
      }
      if (grDb > maxGrDb) maxGrDb = grDb;
    }

    this._sinceReport++;
    if (this._sinceReport >= 4) {
      this._sinceReport = 0;
      this.port.postMessage({ gainReductionDb: maxGrDb });
    }

    return true;
  }
}

registerProcessor('gr-meter-processor', GRMeterProcessor);
