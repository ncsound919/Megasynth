import { MasterState } from '../types';

/**
 * Custom worklet that implements a feed‑forward compressor with a sidechain input.
 * (Register this as 'sidechain-compressor' in a separate file.)
 */
// File: worklets/sidechain-compressor.js
// class SidechainCompressorProcessor extends AudioWorkletProcessor { ... }

export class MasterBusEngine {
  private ctx: AudioContext;

  // --- Mid / Side true matrix (corrected) ---
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private midGain: GainNode;        // (L+R)/2
  private sideGain: GainNode;       // (L−R)/2   (scaled by width)
  private sideInvertForR: GainNode; // -1 for right reconstruction
  private leftMixer: GainNode;      // L' = M + S
  private rightMixer: GainNode;     // R' = M − S

  // --- Saturation stage ---
  private saturationDrive: GainNode;
  private saturationShaper: WaveShaperNode;
  private saturationMakeup: GainNode;
  private _cachedCurve: Float32Array | null = null;
  private _cachedDriveAmount: number = -1;

  // --- Sidechain compressor (custom worklet) ---
  private compressorNode: AudioWorkletNode | null = null;
  private sidechainSource: GainNode; // summing point for external sidechain trigger
  private compressorMakeup: GainNode;

  // --- Output ---
  public input: GainNode;
  public masterOutput: GainNode;

  // --- Metering ---
  private grMeterNode: AudioWorkletNode | null = null;
  public onGainReduction?: (grDb: number) => void;

  constructor(ctx: AudioContext, destination: AudioNode | null = null) {
    this.ctx = ctx;
    this.input = ctx.createGain();

    // ---------- M/S Matrix (corrected) ----------
    this.splitter = ctx.createChannelSplitter(2);
    this.input.connect(this.splitter);
    this.merger = ctx.createChannelMerger(2);

    this.midGain = ctx.createGain();
    this.sideGain = ctx.createGain();
    this.sideInvertForR = ctx.createGain();
    this.leftMixer = ctx.createGain();
    this.rightMixer = ctx.createGain();

    // Mid signal: sum L+R, then halve
    this.splitter.connect(this.midGain, 0);
    this.splitter.connect(this.midGain, 1);
    this.midGain.gain.value = 0.5;

    // Side signal: L − R (invert R, sum with L, then halve)
    const invertR = ctx.createGain();
    invertR.gain.value = -1;
    this.splitter.connect(invertR, 1);
    this.splitter.connect(this.sideGain, 0);
    invertR.connect(this.sideGain);
    this.sideGain.gain.value = 0.5; // will be further scaled by width in applyState

    // Left channel: M + S
    this.midGain.connect(this.leftMixer);
    this.sideGain.connect(this.leftMixer); // positive side

    // Right channel: M − S
    this.midGain.connect(this.rightMixer);
    this.sideGain.connect(this.sideInvertForR); // invert side for R
    this.sideInvertForR.gain.value = -1;
    this.sideInvertForR.connect(this.rightMixer);

    // Merge back to stereo
    this.leftMixer.connect(this.merger, 0, 0);
    this.rightMixer.connect(this.merger, 0, 1);

    // ---------- Saturation stage ----------
    this.saturationDrive = ctx.createGain();
    this.saturationShaper = ctx.createWaveShaper();
    this.saturationShaper.oversample = '4x';
    this.saturationMakeup = ctx.createGain();

    this.merger.connect(this.saturationDrive);
    this.saturationDrive.connect(this.saturationShaper);
    this.saturationShaper.connect(this.saturationMakeup);

    // ---------- Sidechain compressor (custom) ----------
    this.sidechainSource = ctx.createGain(); // external trigger summing point
    this.compressorMakeup = ctx.createGain();
    // The compressor will be created asynchronously; until then, signal passes through unchanged.
    this.compressorNode = null;

    // ---------- Output routing ----------
    this.saturationMakeup.connect(this.compressorMakeup); // direct passthrough until compressor is ready
    this.compressorMakeup.connect(this.masterOutput = ctx.createGain());

    if (destination) {
      this.masterOutput.connect(destination);
    }

    // Load the custom compressor worklet asynchronously
    this._initSidechainCompressor();
  }

  /** Builds (or retrieves cached) the Neve saturation curve. */
  private _getNeveCurve(driveAmount: number): Float32Array {
    if (this._cachedCurve && driveAmount === this._cachedDriveAmount) {
      return this._cachedCurve;
    }
    const samples = 2048;
    const curve = new Float32Array(samples);
    const k = driveAmount * 20 + 1;
    const asym = 0.06 * driveAmount;
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = Math.tanh((x + asym) * k) - Math.tanh(asym * k);
    }
    this._cachedCurve = curve;
    this._cachedDriveAmount = driveAmount;
    return curve;
  }

  private async _initSidechainCompressor() {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/sidechain-compressor.js');
      this.compressorNode = new AudioWorkletNode(this.ctx, 'sidechain-compressor', {
        numberOfInputs: 2,  // input 0: main, input 1: sidechain
        numberOfOutputs: 1,
      });
      // Re‑route: saturationMakeup → compressor (main input), then to compressorMakeup
      this.saturationMakeup.disconnect();
      this.saturationMakeup.connect(this.compressorNode, 0, 0); // main
      this.sidechainSource.connect(this.compressorNode, 0, 1);  // sidechain
      this.compressorNode.connect(this.compressorMakeup);

      // Pass compressor parameters via its port
      this.compressorNode.port.onmessage = (e) => {
        if (e.data.type === 'gainReduction') {
          this.onGainReduction?.(e.data.grDb);
        }
      };
    } catch (e) {
      console.warn('Sidechain compressor worklet not available – using passthrough.', e);
      // Passthrough already active via the direct connection.
    }
  }

  /** Connect an external signal to trigger the compressor's sidechain. */
  connectSidechain(source: AudioNode) {
    source.connect(this.sidechainSource);
  }

  disconnectSidechain(source: AudioNode) {
    try { source.disconnect(this.sidechainSource); } catch {}
  }

  /**
   * Applies the complete master‑bus state.
   * All parameters ramp smoothly to avoid clicks.
   */
  applyState(state: MasterState) {
    const t = this.ctx.currentTime;

    // --- Stereo Width (corrected M/S scaling) ---
    const widthAmt = state.stereoWidth / 100;  // 0 = mono, 1 = normal, >1 = extended
    // The side signal is already (L−R)/2. We scale it by widthAmt.
    this.sideGain.gain.setTargetAtTime(0.5 * widthAmt, t, 0.01);
    // mid stays at 0.5

    // --- Neve Saturation ---
    const driveAmt = state.neveDrive / 100;
    this.saturationShaper.curve = this._getNeveCurve(driveAmt);
    this.saturationDrive.gain.setTargetAtTime(1 + driveAmt * 3, t, 0.01);
    this.saturationMakeup.gain.setTargetAtTime(1 / (1 + driveAmt * 1.5), t, 0.01);

    // --- Bus Compressor ---
    if (this.compressorNode) {
      // Send parameters to the custom sidechain compressor via its port
      const msg = {
        type: 'params',
        enabled: state.busCompEnabled,
        threshold: state.busCompThreshold,
        ratio: state.busCompRatio,
        attack: state.busCompAttack / 1000,
        release: state.busCompRelease / 1000,
        makeupGain: state.busCompMakeup ?? 0,
      };
      this.compressorNode.port.postMessage(msg);
    } else {
      // Fallback: use a native DynamicsCompressorNode (no sidechain)
      if (!this._fallbackComp) {
        this._createFallbackCompressor();
      }
      if (this._fallbackComp) {
        if (state.busCompEnabled) {
          this._fallbackComp.threshold.setTargetAtTime(state.busCompThreshold, t, 0.01);
          this._fallbackComp.ratio.setTargetAtTime(Math.min(20, state.busCompRatio), t, 0.01);
          this._fallbackComp.attack.setTargetAtTime(state.busCompAttack / 1000, t, 0.01);
          this._fallbackComp.release.setTargetAtTime(state.busCompRelease / 1000, t, 0.01);
        } else {
          this._fallbackComp.threshold.setTargetAtTime(0, t, 0.01);
          this._fallbackComp.ratio.setTargetAtTime(1, t, 0.01);
        }
      }
    }
  }

  private _fallbackComp: DynamicsCompressorNode | null = null;
  private _createFallbackCompressor() {
    this._fallbackComp = this.ctx.createDynamicsCompressor();
    this.saturationMakeup.disconnect();
    this.saturationMakeup.connect(this._fallbackComp);
    this._fallbackComp.connect(this.compressorMakeup);
  }

  /** Clean up all nodes when the bus is no longer needed. */
  dispose() {
    this.splitter.disconnect();
    this.merger.disconnect();
    this.midGain.disconnect();
    this.sideGain.disconnect();
    this.sideInvertForR.disconnect();
    this.leftMixer.disconnect();
    this.rightMixer.disconnect();
    this.saturationDrive.disconnect();
    this.saturationShaper.disconnect();
    this.saturationMakeup.disconnect();
    this.compressorMakeup.disconnect();
    this.masterOutput.disconnect();
    if (this._fallbackComp) {
      this._fallbackComp.disconnect();
    }
    this.compressorNode?.disconnect();
  }
}
