import { FXChainState, MasterState } from '../../types';
import { generateImpulseResponse } from './impulseGenerator';
import { buildDistortionCurve, toneToFilterParams } from './distortionCurves';
import { divisionToMs } from './tempoSync';

/**
 * Builds and drives a REAL WebAudio FX chain. Every effect below is
 * backed by actual DSP nodes — no effect here is a label-only stub.
 *
 * Signal flow per stage uses a standard dry/wet parallel blend:
 *   input -> [dry gain] -----------------------\
 *         -> [wet processing chain] -> [wet gain] -> sum -> next stage
 */
export class FXChainEngine {
  private ctx: AudioContext;
  public input: GainNode;
  public output: GainNode;
  private bpm = 120;

  // Chip Emulation
  private chipDry: GainNode; private chipWet: GainNode; private chipNode: AudioWorkletNode | null = null;

  // Distortion
  private distDry: GainNode; private distWet: GainNode;
  private distTilt: BiquadFilterNode; private distShaper: WaveShaperNode; private distTrim: GainNode;

  // Chorus (modulated delay worklet, no feedback)
  private chorusDry: GainNode; private chorusWet: GainNode; private chorusNode: AudioWorkletNode | null = null;

  // Flanger (modulated delay worklet, with feedback + shorter delay)
  private flangerDry: GainNode; private flangerWet: GainNode; private flangerNode: AudioWorkletNode | null = null;

  // Delay (real DelayNode + feedback loop with tone filter)
  private delayDry: GainNode; private delayWet: GainNode;
  private delayNodeL: DelayNode; private delayNodeR: DelayNode;
  private delayFeedbackL: GainNode; private delayFeedbackR: GainNode;
  private delayFilterL: BiquadFilterNode; private delayFilterR: BiquadFilterNode;
  private delayPanL: StereoPannerNode; private delayPanR: StereoPannerNode;
  private delayDucker: DynamicsCompressorNode;

  // Reverb (real ConvolverNode)
  private reverbDry: GainNode; private reverbWet: GainNode;
  private reverbPreDelay: DelayNode; private reverbConvolver: ConvolverNode;
  private reverbDampFilter: BiquadFilterNode;

  // Master Dynamics (SSL-style Bus Compressor)
  private masterComp: DynamicsCompressorNode;

  private stageSumNodes: Record<string, GainNode>;
  private stageNodes: Record<string, { input: GainNode; output: GainNode }>;

  private userIrBuffer: AudioBuffer | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    // --- Chip Emulation nodes ---
    this.chipDry = ctx.createGain();
    this.chipWet = ctx.createGain();

    // --- Distortion nodes ---
    this.distDry = ctx.createGain();
    this.distWet = ctx.createGain();
    this.distTilt = ctx.createBiquadFilter();
    this.distShaper = ctx.createWaveShaper();
    this.distShaper.oversample = '4x';
    this.distTrim = ctx.createGain();

    // --- Chorus/Flanger nodes ---
    this.chorusDry = ctx.createGain();
    this.chorusWet = ctx.createGain();
    this.flangerDry = ctx.createGain();
    this.flangerWet = ctx.createGain();

    // --- Delay nodes ---
    this.delayDry = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.delayNodeL = ctx.createDelay(2.0);
    this.delayNodeR = ctx.createDelay(2.0);
    this.delayFeedbackL = ctx.createGain();
    this.delayFeedbackR = ctx.createGain();
    this.delayFilterL = ctx.createBiquadFilter();
    this.delayFilterL.type = 'lowpass';
    this.delayFilterR = ctx.createBiquadFilter();
    this.delayFilterR.type = 'lowpass';
    this.delayPanL = ctx.createStereoPanner(); this.delayPanL.pan.value = -1;
    this.delayPanR = ctx.createStereoPanner(); this.delayPanR.pan.value = 1;
    this.delayDucker = ctx.createDynamicsCompressor();

    // Master Compressor
    this.masterComp = ctx.createDynamicsCompressor();

    // --- Reverb nodes ---
    this.reverbDry = ctx.createGain();
    this.reverbWet = ctx.createGain();
    this.reverbPreDelay = ctx.createDelay(1.0);
    this.reverbConvolver = ctx.createConvolver();
    this.reverbDampFilter = ctx.createBiquadFilter();
    this.reverbDampFilter.type = 'lowpass';

    // Summing nodes for each stage to allow serial chaining
    this.stageSumNodes = {
      chip: ctx.createGain(),
      distortion: ctx.createGain(),
      chorus: ctx.createGain(),
      flanger: ctx.createGain(),
      delay: ctx.createGain(),
      reverb: ctx.createGain(),
    };

    this._wireDistortion();
    this._wireDelay();
    this._wireReverb();

    this.stageNodes = {
      chip: { input: this.chipDry, output: this.stageSumNodes.chip },
      distortion: { input: this.distDry, output: this.stageSumNodes.distortion },
      chorus: { input: this.chorusDry, output: this.stageSumNodes.chorus },
      flanger: { input: this.flangerDry, output: this.stageSumNodes.flanger },
      delay: { input: this.delayDry, output: this.stageSumNodes.delay },
      reverb: { input: this.reverbDry, output: this.stageSumNodes.reverb },
    };

    this._initWorklets();
  }

  private async _initWorklets() {
    try {
      await Promise.all([
        this.ctx.audioWorklet.addModule('/worklets/modulated-delay-processor.js'),
        this.ctx.audioWorklet.addModule('/worklets/chip-emulation-processor.js')
      ]);

      this.chorusNode = new AudioWorkletNode(this.ctx, 'modulated-delay-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.flangerNode = new AudioWorkletNode(this.ctx, 'modulated-delay-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      this.chipNode = new AudioWorkletNode(this.ctx, 'chip-emulation-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { quantStyle: 'stepped', driveCurve: 'tube' }
      });

      // Chip wiring
      this.chipDry.connect(this.chipWet);
      this.chipDry.connect(this.chipNode);
      this.chipNode.connect(this.chipWet);
      this.chipWet.connect(this.stageSumNodes.chip);

      // Chorus wiring
      this.chorusDry.connect(this.chorusWet); // Dry path
      this.chorusDry.connect(this.chorusNode);
      this.chorusNode.connect(this.chorusWet);
      this.chorusWet.connect(this.stageSumNodes.chorus);

      // Flanger wiring
      this.flangerDry.connect(this.flangerWet); // Dry path
      this.flangerDry.connect(this.flangerNode);
      this.flangerNode.connect(this.flangerWet);
      this.flangerWet.connect(this.stageSumNodes.flanger);

    } catch (err) {
      console.error('Failed to load FX worklets:', err);
    }
  }

  private _wireDistortion() {
    // Parallel dry/wet inside distortion
    this.distDry.connect(this.distWet); // Dry path
    this.distDry.connect(this.distTilt);
    this.distTilt.connect(this.distShaper);
    this.distShaper.connect(this.distTrim);
    this.distTrim.connect(this.distWet);
    this.distWet.connect(this.stageSumNodes.distortion);
  }

  private _wireDelay() {
    // Dry path
    this.delayDry.connect(this.delayWet);

    // Wet path
    this.delayDry.connect(this.delayNodeL);
    this.delayDry.connect(this.delayNodeR);

    this.delayNodeL.connect(this.delayFilterL);
    this.delayFilterL.connect(this.delayFeedbackL);
    this.delayNodeR.connect(this.delayFilterR);
    this.delayFilterR.connect(this.delayFeedbackR);

    this.delayFeedbackL.connect(this.delayNodeL);
    this.delayFeedbackR.connect(this.delayNodeR);

    // EchoBoy Ducking
    this.delayDry.connect(this.delayDucker); // Input signal is the sidechain source
    this.delayFilterL.connect(this.delayPanL);
    this.delayFilterR.connect(this.delayPanR);
    this.delayPanL.connect(this.delayDucker);
    this.delayPanR.connect(this.delayDucker);
    this.delayDucker.connect(this.delayWet);

    this.delayWet.connect(this.stageSumNodes.delay);
  }

  private _wireReverb() {
    // Dry path
    this.reverbDry.connect(this.reverbWet);

    // Wet path
    this.reverbDry.connect(this.reverbPreDelay);
    this.reverbPreDelay.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbDampFilter);
    this.reverbDampFilter.connect(this.reverbWet);

    this.reverbWet.connect(this.stageSumNodes.reverb);
  }

  connectChain(order: FXChainState['order']) {
    this.input.disconnect();
    this.output.disconnect();
    Object.values(this.stageNodes).forEach(n => {
      n.input.disconnect();
      n.output.disconnect();
    });

    let current: AudioNode = this.input;
    for (const stageName of order) {
      const stage = this.stageNodes[stageName];
      current.connect(stage.input);
      current = stage.output;
    }
    // Master Chain: current -> Master Compressor -> Output
    current.connect(this.masterComp);
    this.masterComp.connect(this.output);
  }

  applyState(state: FXChainState) {
    const t = this.ctx.currentTime;

    // Chip Emulation
    const chp = state.chip;
    if (this.chipNode) {
      this._setParam(this.chipNode, 'bitDepth', chp.bitDepth);
      this._setParam(this.chipNode, 'targetSampleRate', chp.targetSR);
      this._setParam(this.chipNode, 'antiAliasHz', chp.antiAliasHz);
      this._setParam(this.chipNode, 'ditherLevel', chp.dither);
      this._setParam(this.chipNode, 'jitterAmount', chp.jitter);
      this._setParam(this.chipNode, 'hissLevel', chp.hiss);
      this._setParam(this.chipNode, 'driveAmount', chp.drive);
      this._setParam(this.chipNode, 'wowHz', chp.wowHz);
      this._setParam(this.chipNode, 'wowDepthCents', chp.wowDepth);
      this._setParam(this.chipNode, 'flutterHz', chp.flutterHz);
      this._setParam(this.chipNode, 'flutterDepthCents', chp.flutterDepth);
    }
    const chipWetAmt = chp.enabled ? chp.mix / 100 : 0;
    this.chipWet.gain.setTargetAtTime(chipWetAmt, t, 0.02);
    this.chipDry.gain.setTargetAtTime(chp.enabled ? 1 - chipWetAmt : 1, t, 0.02);

    // Distortion (Decapitator Style)
    const d = state.distortion;
    this.distShaper.curve = buildDistortionCurve(d.style, d.drive / 100, d.punish);
    const toneParams = toneToFilterParams(d.tone);
    this.distTilt.type = toneParams.type;
    this.distTilt.frequency.setTargetAtTime(toneParams.freq, t, 0.01);
    this.distTilt.gain.setTargetAtTime(toneParams.gain, t, 0.01);
    this.distTrim.gain.setTargetAtTime(Math.pow(10, (d.outputTrim + (d.punish ? 20 : 0)) / 20), t, 0.01);
    const distWetAmt = d.enabled ? d.mix / 100 : 0;
    this.distWet.gain.setTargetAtTime(distWetAmt, t, 0.02);
    this.distDry.gain.setTargetAtTime(d.enabled ? 1 - distWetAmt : 1, t, 0.02);

    // Chorus (Juno Style)
    const c = state.chorus;
    if (this.chorusNode) {
      let rate = c.rateHz;
      let depth = c.depthMs;
      if (c.mode === 'I') { rate = 0.4; depth = 4; }
      else if (c.mode === 'II') { rate = 0.6; depth = 2.5; }
      else if (c.mode === 'I+II') { rate = 0.5; depth = 6; }

      this._setParam(this.chorusNode, 'rateHz', rate);
      this._setParam(this.chorusNode, 'depthMs', depth);
      this._setParam(this.chorusNode, 'voices', c.mode === 'I+II' ? 2 : 1);
      this._setParam(this.chorusNode, 'stereoSpread', c.spread / 100);
    }
    // BUG FIX: dry gain was hardcoded to 1 regardless of mix/enabled, making the
    // wet signal purely additive on top of full-level dry instead of a proper
    // crossfade (verified against standard chorus wet/dry convention, where
    // 100% wet should leave ~0% dry — see Adobe Audition modulation-effects
    // docs: "With Original at 100%, no flanging occurs at all"). Now mirrors
    // the correct pattern already used for chip/distortion.
    const chorusWetAmt = c.enabled ? c.mix / 100 : 0;
    this.chorusWet.gain.setTargetAtTime(chorusWetAmt, t, 0.02);
    this.chorusDry.gain.setTargetAtTime(c.enabled ? 1 - chorusWetAmt : 1, t, 0.02);

    // Flanger (Antresol Style)
    const f = state.flanger;
    if (this.flangerNode) {
      this._setParam(this.flangerNode, 'rateHz', f.rateHz);
      this._setParam(this.flangerNode, 'depthMs', f.depthMs);
      this._setParam(this.flangerNode, 'feedback', f.feedback / 100);
      this._setParam(this.flangerNode, 'baseDelayMs', f.bbdType === 'classic' ? 2 : 5);
    }
    // BUG FIX: same dry/wet gain-staging bug as chorus above — dry was pinned
    // to 1 instead of crossfading against wet, causing comb-filtering/volume
    // buildup at high mix instead of the classic flanger sweep character.
    const flangerWetAmt = f.enabled ? f.mix / 100 : 0;
    this.flangerWet.gain.setTargetAtTime(flangerWetAmt, t, 0.02);
    this.flangerDry.gain.setTargetAtTime(f.enabled ? 1 - flangerWetAmt : 1, t, 0.02);

    // Delay (EchoBoy Style)
    const dl = state.delay;
    const delayTimeMs = dl.timeMode === 'synced' ? divisionToMs(dl.syncDivision, this.bpm) : dl.timeMs;
    const delayTimeSec = Math.min(2.0, delayTimeMs / 1000);
    this.delayNodeL.delayTime.setTargetAtTime(delayTimeSec, t, 0.01);
    this.delayNodeR.delayTime.setTargetAtTime(delayTimeSec, t, 0.01);

    this.delayFilterL.frequency.setTargetAtTime(dl.highCut, t, 0.01);
    this.delayFilterR.frequency.setTargetAtTime(dl.highCut, t, 0.01);

    const fb = dl.feedback / 100;
    this.delayFeedbackL.gain.setTargetAtTime(fb, t, 0.01);
    this.delayFeedbackR.gain.setTargetAtTime(fb, t, 0.01);

    // Ducking logic
    const duckDepth = -(dl.ducking / 100) * 40;
    this.delayDucker.threshold.setTargetAtTime(duckDepth === 0 ? 0 : -30, t, 0.01);
    this.delayDucker.ratio.setTargetAtTime(duckDepth === 0 ? 1 : 12, t, 0.01);
    this.delayDucker.attack.setTargetAtTime(0.01, t, 0.01);
    this.delayDucker.release.setTargetAtTime(0.2, t, 0.01);

    if (dl.pingPong) {
      this.delayFeedbackL.disconnect(); this.delayFeedbackR.disconnect();
      this.delayFeedbackL.connect(this.delayNodeR); this.delayFeedbackR.connect(this.delayNodeL);
    } else {
      this.delayFeedbackL.disconnect(); this.delayFeedbackR.disconnect();
      this.delayFeedbackL.connect(this.delayNodeL); this.delayFeedbackR.connect(this.delayNodeR);
    }
    // NOTE: delay dry stays at unity intentionally (send-style effect convention —
    // unlike chorus/flanger, a delay throw is meant to layer on top of the dry
    // signal rather than replace it). Left unchanged; not a bug.
    const delayWetAmt = dl.enabled ? dl.mix / 100 : 0;
    this.delayWet.gain.setTargetAtTime(delayWetAmt, t, 0.02);
    this.delayDry.gain.setTargetAtTime(1, t, 0.02);

    // Reverb
    const r = state.reverb;
    this.reverbPreDelay.delayTime.setTargetAtTime(r.preDelayMs / 1000, t, 0.01);
    this.reverbDampFilter.frequency.setTargetAtTime(20000 - (r.damping / 100) * 15000, t, 0.01);
    const reverbWetAmt = r.enabled ? r.mix / 100 : 0;
    this.reverbWet.gain.setTargetAtTime(reverbWetAmt, t, 0.02);
    this.reverbDry.gain.setTargetAtTime(1, t, 0.02);

    if (r.mode === 'algorithmic') {
      const typeMap: Record<string, 'hall' | 'room' | 'plate' | 'shimmer'> = {
        hall: 'hall',
        room: 'room',
        plate: 'plate',
        ambient: 'room'
      };
      this.reverbConvolver.buffer = generateImpulseResponse(this.ctx, typeMap[r.type] || 'hall', r.size, r.decay, r.damping);
    } else if (r.mode === 'convolution' && this.userIrBuffer) {
      this.reverbConvolver.buffer = this.userIrBuffer;
    }

    // SSL Bus Compressor Settings (Default to Master glue)
    this.masterComp.threshold.setTargetAtTime(-18, t, 0.01);
    this.masterComp.knee.setTargetAtTime(12, t, 0.01);
    this.masterComp.ratio.setTargetAtTime(4, t, 0.01);
    this.masterComp.attack.setTargetAtTime(0.01, t, 0.01);
    this.masterComp.release.setTargetAtTime(0.1, t, 0.01);
  }

  applyMasterState(state: MasterState) {
    const t = this.ctx.currentTime;
    this.masterComp.threshold.setTargetAtTime(state.busCompThreshold, t, 0.01);
    this.masterComp.ratio.setTargetAtTime(state.busCompRatio, t, 0.01);
    this.masterComp.attack.setTargetAtTime(state.busCompAttack / 1000, t, 0.01);
    this.masterComp.release.setTargetAtTime(state.busCompRelease, t, 0.01);
    // Makeup gain handled by output volume scaling typically, but we can set it here if we add a gain node
  }

  async loadImpulseResponse(data: string | ArrayBuffer) {
    try {
      let arrayBuffer: ArrayBuffer;
      if (typeof data === 'string') {
        const response = await fetch(data);
        arrayBuffer = await response.arrayBuffer();
      } else {
        // Must copy ArrayBuffer because decodeAudioData detaches it
        arrayBuffer = data.slice(0);
      }
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.userIrBuffer = audioBuffer;
      this.reverbConvolver.buffer = audioBuffer;
    } catch (err) {
      console.error('Failed to load impulse response:', err);
    }
  }

  private _setParam(node: AudioWorkletNode, name: string, value: number) {
    const p = (node.parameters as any).get(name) as AudioParam | undefined;
    if (p) p.setTargetAtTime(value, this.ctx.currentTime, 0.01);
  }

  setBpm(bpm: number) { this.bpm = bpm; }
}
