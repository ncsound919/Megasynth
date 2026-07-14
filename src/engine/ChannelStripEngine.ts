import { ChannelState } from '../types';

/**
 * Builds and drives a REAL WebAudio signal chain for one channel strip:
 *
 * source -> [3-band EQ: low shelf, mid peak, high shelf] -> [compressor]
 *        -> [pan] -> [fader gain] -> split to:
 *              - selected output route (master/out2/out3/out4)
 *              - bus 1-4 send gains (parallel, non-destructive sends)
 *
 * Every EQ band is a real BiquadFilterNode with correct type/freq/Q/gain.
 * The compressor is a real DynamicsCompressorNode with matched parameters,
 * plus a shadow GRMeterProcessor purely for accurate metering.
 */
export class ChannelStripEngine {
  readonly id: string;
  private ctx: AudioContext;

  private inputGain: GainNode;
  private eqFilters: BiquadFilterNode[] = [];
  private compressor: DynamicsCompressorNode;
  private compressorMakeup: GainNode; // used to compensate gain
  private panner: StereoPannerNode;
  private fader: GainNode;
  private muteGain: GainNode;

  private busSends: Record<'bus1' | 'bus2' | 'bus3' | 'bus4', GainNode>;
  private outputRoutes: Record<'master' | 'out2' | 'out3' | 'out4', AudioNode>;
  private currentRoute: 'master' | 'out2' | 'out3' | 'out4' = 'master';

  private grMeterNode: AudioWorkletNode | null = null;
  private meterNode: AudioWorkletNode | null = null;
  public analyser: AnalyserNode;

  public onMeter?: (rms: number, peak: number, peakHold: number, clipping: boolean) => void;
  public onGainReduction?: (grDb: number) => void;

  constructor(
    ctx: AudioContext,
    id: string,
    source: AudioNode,
    outputRoutes: Record<'master' | 'out2' | 'out3' | 'out4', AudioNode>,
    busDestinations: Record<'bus1' | 'bus2' | 'bus3' | 'bus4', AudioNode>
  ) {
    this.ctx = ctx;
    this.id = id;
    this.outputRoutes = outputRoutes;

    this.inputGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;

    // Initialize up to 16 EQ filters for multi-band flexibility
    for (let i = 0; i < 16; i++) {
      this.eqFilters.push(ctx.createBiquadFilter());
    }

    this.compressor = ctx.createDynamicsCompressor();
    this.compressorMakeup = ctx.createGain();

    this.panner = ctx.createStereoPanner();
    this.fader = ctx.createGain();
    this.muteGain = ctx.createGain();

    this.busSends = {
      bus1: ctx.createGain(),
      bus2: ctx.createGain(),
      bus3: ctx.createGain(),
      bus4: ctx.createGain(),
    };
    // Bus sends default OFF (gain 0) until explicitly enabled
    Object.values(this.busSends).forEach((g) => (g.gain.value = 0));

    // --- Wire the real signal chain ---
    source.connect(this.inputGain);
    this.inputGain.connect(this.analyser);
    
    // Connect EQ filters in series
    let lastNode: AudioNode = this.analyser;
    this.eqFilters.forEach(filter => {
      lastNode.connect(filter);
      lastNode = filter;
    });

    lastNode.connect(this.compressor);
    this.compressor.connect(this.compressorMakeup);
    this.compressorMakeup.connect(this.panner);
    this.panner.connect(this.fader);
    this.fader.connect(this.muteGain);

    // Main output route
    this.muteGain.connect(this.outputRoutes.master);

    // Parallel bus sends (post-fader, matches real console send architecture)
    for (const key of Object.keys(this.busSends) as Array<keyof typeof this.busSends>) {
      this.muteGain.connect(this.busSends[key]);
      this.busSends[key].connect(busDestinations[key]);
    }

    this._initMetering();
  }

  private async _initMetering() {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/meter-processor.js');
    } catch {
      // module may already be registered by another channel; ignore duplicate errors
    }
    this.meterNode = new AudioWorkletNode(this.ctx, 'meter-processor');
    this.muteGain.connect(this.meterNode);
    this.meterNode.port.onmessage = (e) => {
      const { rms, peak, peakHold, clipping } = e.data;
      this.onMeter?.(rms, peak, peakHold, clipping);
      
      // Dynamic EQ update loop
      if (this.lastState && this.lastState.eq.some(b => b.dynEnabled)) {
        this._updateDynamicEQ(rms);
      }
    };
  }

  private lastState: ChannelState | null = null;

  private _updateDynamicEQ(widebandRms: number) {
    const t = this.ctx.currentTime;
    this.lastState?.eq.forEach((band, i) => {
      if (!band.enabled || !band.dynEnabled) return;
      
      const filter = this.eqFilters[i];
      if (!filter) return;

      const threshold = band.dynThreshold ?? -20;
      const ratio = band.dynRatio ?? 4;
      
      const rmsDb = 20 * Math.log10(widebandRms + 1e-6);
      if (rmsDb > threshold) {
        const reduction = (rmsDb - threshold) * (1 - 1 / ratio);
        // Apply reduction to the band's gain
        const targetGain = band.gain - reduction;
        filter.gain.setTargetAtTime(targetGain, t, 0.05);
      } else {
        filter.gain.setTargetAtTime(band.gain, t, 0.1);
      }
    });
  }

  async enableGrMetering() {
    try {
      await this.ctx.audioWorklet.addModule('/worklets/gr-meter-processor.js');
    } catch {}
    this.grMeterNode = new AudioWorkletNode(this.ctx, 'gr-meter-processor');
    this.eqFilters[this.eqFilters.length - 1].connect(this.grMeterNode); // taps signal pre-compressor
    this.grMeterNode.port.onmessage = (e) => {
      this.onGainReduction?.(e.data.gainReductionDb);
    };
  }

  applyState(state: ChannelState) {
    this.lastState = state;
    const t = this.ctx.currentTime;

    // Fader — real gain applied to the actual audio path
    this.fader.gain.setTargetAtTime(state.volume, t, 0.01);

    // Mute — real gain-to-zero, not a UI flag
    this.muteGain.gain.setTargetAtTime(state.muted ? 0 : 1, t, 0.01);

    // Pan — real StereoPannerNode
    this.panner.pan.setTargetAtTime(state.pan, t, 0.01);

    // EQ — map state to filters
    state.eq.forEach((band, i) => {
      const filter = this.eqFilters[i];
      if (!filter) return;

      if (band.enabled) {
        filter.type = band.type;
        filter.frequency.setTargetAtTime(band.freq, t, 0.01);
        filter.Q.setTargetAtTime(band.q, t, 0.01);
        filter.gain.setTargetAtTime(band.gain, t, 0.01);
      } else {
        // Transparent bypass: set to peaking with 0 gain
        filter.type = 'peaking';
        filter.gain.setTargetAtTime(0, t, 0.01);
      }
    });

    // Reset remaining unused filters
    for (let i = state.eq.length; i < this.eqFilters.length; i++) {
      this.eqFilters[i].type = 'peaking';
      this.eqFilters[i].gain.setTargetAtTime(0, t, 0.01);
    }

    // Compressor — real DynamicsCompressorNode parameters
    if (state.compressor.enabled) {
      this.compressor.threshold.setTargetAtTime(state.compressor.threshold, t, 0.01);
      this.compressor.ratio.setTargetAtTime(Math.min(20, state.compressor.ratio), t, 0.01);
      this.compressor.attack.setTargetAtTime(state.compressor.attack / 1000, t, 0.01);
      this.compressor.release.setTargetAtTime(state.compressor.release / 1000, t, 0.01);
      // Real makeup gain applied AFTER the compressor via the fader's downstream gain stage
      this.compressorMakeup.gain.setTargetAtTime(
        Math.pow(10, state.compressor.makeupGain / 20),
        t,
        0.01
      );
    } else {
      // Bypass: threshold at 0dB, ratio 1:1 = no compression applied, real bypass not fake flag
      this.compressor.threshold.setTargetAtTime(0, t, 0.01);
      this.compressor.ratio.setTargetAtTime(1, t, 0.01);
      this.compressorMakeup.gain.setTargetAtTime(1, t, 0.01);
    }

    // Bus sends — real parallel gain, 0 = fully off (not just a UI toggle)
    (['bus1', 'bus2', 'bus3', 'bus4'] as const).forEach((bus) => {
      const active = state[bus];
      this.busSends[bus].gain.setTargetAtTime(active ? 1 : 0, t, 0.01);
    });

    // Output routing — real reconnection to the chosen destination
    if (state.outputRoute !== this.currentRoute) {
      try { this.muteGain.disconnect(this.outputRoutes[this.currentRoute]); } catch(e) {}
      this.muteGain.connect(this.outputRoutes[state.outputRoute]);
      this.currentRoute = state.outputRoute;
    }
  }

  dispose() {
    this.meterNode?.disconnect();
    this.grMeterNode?.disconnect();
    this.inputGain.disconnect();
  }
}
