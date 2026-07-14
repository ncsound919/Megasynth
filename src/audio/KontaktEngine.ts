import { KontaktSample, SynthParams, AdvancedSynthParams, ModRoute, FXChainState, DEFAULT_FX_STATE } from '../types';
import { FXChainEngine } from './fx/FXChainEngine';

interface ActiveVoice {
  id: string;
  midiNote: number;
  sources: (AudioBufferSourceNode | OscillatorNode)[];
  filter: BiquadFilterNode;
  filterDrive?: WaveShaperNode;
  envelopeGain: GainNode;
  lfoOsc?: OscillatorNode;
  lfoGainNode?: GainNode;
  startedAt: number;
  releasedAt?: number;
  basePlaybackRate?: number; 
  channelId?: string;
  vintageShaper?: WaveShaperNode;
  vintageCrusher?: ScriptProcessorNode;
  tapeHiss?: ScriptProcessorNode;
  driftPitchCents: number;
  driftCutoffOffset: number;
}

export class KontaktEngine {
  private ctx: AudioContext;
  private finalOutput: GainNode;
  private masterSaturation: WaveShaperNode;
  private masterWidth: GainNode;
  private activeVoices: Map<string, ActiveVoice[]> = new Map();
  private buffers: Map<string, AudioBuffer> = new Map();
  private samples: KontaktSample[] = [];
  private activeLibraryName: string = "Synthesizer Presets";
  private lastPlayedMidiNote: number | null = null;
  private roundRobinTracker: Map<string, number> = new Map();
  
  private out2Gain: GainNode;
  private out3Gain: GainNode;
  private out4Gain: GainNode;

  public channelGains: Record<string, GainNode> = {};
  public channelPanners: Record<string, StereoPannerNode> = {};
  private channelRoutes: Record<string, 'master' | 'out2' | 'out3' | 'out4'> = {};
  
  public fxChain: FXChainEngine;

  private sidechainIntensity: number = 0.5;
  private pitchBendCents: number = 0;

  public params: AdvancedSynthParams = {
    attack: 0.05,
    decay: 0.2,
    sustain: 0.7,
    release: 0.4,
    filterType: 'lowpass',
    filterCutoff: 2000,
    filterReso: 1.0,
    lfoRate: 3.5,
    lfoDepth: 0.0,
    lfoType: 'sine',
    lfoTarget: 'none',
    fineTune: 0,
    transpose: 0,
    glide: 0.05,
    chipEmulation: 'none',
    bitDepth: 24,
    resamplingQuality: 'hifi',
    analogWarmth: 0,
    dacColor: 0,
    pitchEnvAttack: 0.1,
    pitchEnvDecay: 0.3,
    pitchEnvDepth: 0,
    oscType1: 'sawtooth',
    oscType2: 'none',
    oscDetune: 15,
    osc2Volume: 0.5,
    noiseVolume: 0,
    wowFlutter: 15,
    tapeNoise: 10,
    syncMode: false,
    ringMod: false,
    neveDrive: 20,
    mixerWidth: 50,
    chipAliasing: 30,
    chipJitter: 15,
    chipHiss: 10,
    analogDrift: 20,
    unisonVoices: 1,
    unisonDetune: 10,
    unisonSpread: 50,
    filterDrive: 10,
    filterMode: 'ladder',
    envelopeCurve: 'exp',
    modMatrix: []
  };

  // Mapping mode for the current library (chromatic stretch vs strict 1:1 oneshot dispersal)
  public mappingMode: 'chromatic' | 'oneshot' = 'chromatic';

  constructor(ctx: AudioContext, destination: AudioNode | null = null) {
    this.ctx = ctx;

    // 1. Initialize Auxiliary Separated Output Buses
    this.out2Gain = ctx.createGain();
    this.out2Gain.gain.setValueAtTime(0.8, ctx.currentTime);
    if (destination) this.out2Gain.connect(destination);

    this.out3Gain = ctx.createGain();
    this.out3Gain.gain.setValueAtTime(0.8, ctx.currentTime);
    if (destination) this.out3Gain.connect(destination);

    this.out4Gain = ctx.createGain();
    this.out4Gain.gain.setValueAtTime(0.8, ctx.currentTime);
    if (destination) this.out4Gain.connect(destination);

    // 2. Build the output stage
    this.finalOutput = ctx.createGain();
    this.finalOutput.gain.setValueAtTime(0.8, ctx.currentTime);

    // FX Chain
    this.fxChain = new FXChainEngine(ctx);
    this.fxChain.applyState(DEFAULT_FX_STATE);
    this.fxChain.connectChain(DEFAULT_FX_STATE.order);

    // Master processing chain
    this.masterSaturation = ctx.createWaveShaper();
    this.masterSaturation.oversample = '4x';
    this.masterSaturation.curve = this.generateNeveCurve(20);

    this.masterWidth = ctx.createGain(); 
    
    this.finalOutput.connect(this.fxChain.input);
    this.fxChain.output.connect(this.masterSaturation);
    this.masterSaturation.connect(this.masterWidth);
    if (destination) {
      this.masterWidth.connect(destination);
    }

    // 3. Setup 5 Mixer Channel Strips
    const channels = ['rompler', 'synth', 'sub', 'noise', 'ambient'];
    channels.forEach(ch => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(1.0, ctx.currentTime); // Set to unity, let external mixer handle it

      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : (ctx as any).createPanner();
      if (p.pan) {
        p.pan.setValueAtTime(0, ctx.currentTime);
      }

      g.connect(p);
      
      // Only connect to finalOutput if destination was provided (legacy mode)
      if (destination) {
        p.connect(this.finalOutput);
      }

      this.channelGains[ch] = g;
      this.channelPanners[ch] = p;
      this.channelRoutes[ch] = 'master';
    });
  }

  /**
   * Load Impulse Response for Reverb
   */
  public async loadImpulseResponse(data: string | ArrayBuffer) {
    if (this.fxChain) {
      await this.fxChain.loadImpulseResponse(data);
    }
  }

  /**
   * Sync master DSP parameters
   */
  public updateEffects(params: SynthParams) {
    // Save parameters locally
    this.params = { ...this.params, ...params };

    // Update Master saturation curve if neveDrive changed
    if (params.neveDrive !== undefined) {
      this.masterSaturation.curve = this.generateNeveCurve(params.neveDrive);
    }
    
    // Update Master width
    if (params.mixerWidth !== undefined) {
      this.masterWidth.gain.setValueAtTime(0.8 + (params.mixerWidth / 100) * 0.4, this.ctx.currentTime);
    }
  }

  /**
   * Update Master FX Chain
   */
  public updateMasterFX(state: FXChainState, bpm: number) {
    this.fxChain.setBpm(bpm);
    this.fxChain.applyState(state);
    this.fxChain.connectChain(state.order);
  }

  /**
   * Real-time Mixer Fader/Pan adjustment
   */
  public updateMixer(
    ch: string, 
    volume: number, 
    pan: number, 
    muted: boolean, 
    route: 'master' | 'out2' | 'out3' | 'out4'
  ) {
    const g = this.channelGains[ch];
    const p = this.channelPanners[ch];
    if (!g || !p) return;

    const time = this.ctx.currentTime;
    const targetVol = muted ? 0 : volume;

    g.gain.setTargetAtTime(targetVol, time, 0.02);

    if (p.pan) {
      p.pan.setTargetAtTime(pan, time, 0.02);
    }

    if (this.channelRoutes[ch] !== route) {
      try {
        p.disconnect();
      } catch (e) {}

      if (route === 'out2') {
        p.connect(this.out2Gain);
      } else if (route === 'out3') {
        p.connect(this.out3Gain);
      } else if (route === 'out4') {
        p.connect(this.out4Gain);
      } else {
        p.connect(this.finalOutput);
      }

      this.channelRoutes[ch] = route;
    }
  }

  /**
   * Helper to compute active running voices
   */
  public getActiveVoicesCount(): number {
    let count = 0;
    this.activeVoices.forEach(voices => {
      count += voices.filter(v => !v.releasedAt).length;
    });
    return count;
  }

  /**
   * Get the output node for a specific channel to connect to an external mixer
   */
  public getChannelOutput(ch: string): AudioNode | undefined {
    return this.channelPanners[ch];
  }

  /**
   * Disconnect internal routing to allow external mixer control
   */
  public disconnectInternalRouting() {
    Object.values(this.channelPanners).forEach(p => {
      try {
        p.disconnect();
      } catch (e) {}
    });
  }

  /**
   * Dynamically adjust Pitch Bend wheel offset on all currently playing voices
   */
  public setPitchBend(cents: number) {
    this.pitchBendCents = cents;
    const time = this.ctx.currentTime;

    this.activeVoices.forEach((voices) => {
      voices.forEach((voice) => {
        if (voice.releasedAt) return;

        // Apply pitch-bend ratio
        const pitchRatio = Math.pow(2, cents / 1200);

        if (voice.sources[0] instanceof AudioBufferSourceNode && voice.basePlaybackRate !== undefined) {
          voice.sources[0].playbackRate.setTargetAtTime(voice.basePlaybackRate * pitchRatio, time, 0.03);
        }
      });
    });
  }

  /**
   * Helper to map a physical MIDI note trigger to our 5 mixer channels
   */
  private getChannelIdForNote(midiNote: number, isDrum: boolean): string {
    return 'rompler';
  }

  /**
   * Trigger sidechain ducking envelope across synth and ambient channels (e.g. pumped pad effect)
   */
  private triggerSidechainDucking(time: number) {
    if (this.sidechainIntensity <= 0.02) return;

    const duckFactor = 1.0 - (this.sidechainIntensity * 0.75); // duck up to -75% gain
    const releaseTime = 0.12;

    ['rompler', 'synth', 'ambient'].forEach(ch => {
      const g = this.channelGains[ch];
      if (!g) return;

      const currentVol = g.gain.value;
      g.gain.setValueAtTime(currentVol, time);
      g.gain.exponentialRampToValueAtTime(Math.max(0.01, currentVol * duckFactor), time + 0.01);
      g.gain.exponentialRampToValueAtTime(currentVol, time + releaseTime);
    });
  }

  /**
   * Loads custom samples list and stores buffers
   */
  public loadLibrary(name: string, samples: KontaktSample[], mappingMode?: 'chromatic' | 'oneshot') {
    this.activeLibraryName = name;
    this.samples = samples;
    if (mappingMode) {
      this.mappingMode = mappingMode;
    }
    this.buffers.clear(); // Clear old buffers to prevent memory leak and wrong buffer mappings
    this.roundRobinTracker.clear(); // Clear round robin tracking on library load
    this.lastPlayedMidiNote = null; // Clear glide memory when switching libraries
    this.panic();
  }

  /**
   * Set buffer for a specific sample ID
   */
  public setBuffer(sampleId: string, buffer: AudioBuffer) {
    this.buffers.set(sampleId, buffer);
  }

  /**
   * Get all cached buffers
   */
  public getBuffers(): Map<string, AudioBuffer> {
    return this.buffers;
  }

  /**
   * Get active library name
   */
  public getLibraryName(): string {
    return this.activeLibraryName;
  }

  /**
   * Set master volume
   */
  public setVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1.5, volume));
    this.finalOutput.gain.setValueAtTime(clamped, this.ctx.currentTime);
  }

  /**
   * Stop all playing voices immediately
   */
  public panic() {
    this.activeVoices.forEach((voices) => {
      voices.forEach((voice) => {
        try {
          voice.sources.forEach(src => {
            try { (src as any).stop(); } catch (_) {}
          });
          if (voice.lfoOsc) voice.lfoOsc.stop();
        } catch (err) {}
      });
    });
    this.activeVoices.clear();
  }

  /**
   * Play a note with optional glide (Portamento) and dynamic Pitch bending
   */
  public playNote(midiNote: number, velocity: number = 100, startTime: number = this.ctx.currentTime) {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(err => console.warn("Failed to resume AudioContext inside playNote:", err));
    }

    const velocityScale = velocity / 127;
    const playedMidiNote = midiNote + this.params.transpose;

    // Apply choke/mute group behavior
    this.applyMuteGroups(playedMidiNote, startTime);

    // Trigger sidechain if playing a sub bass note (low keys)
    if (playedMidiNote < 45) {
      this.triggerSidechainDucking(startTime);
    }

    let voice: ActiveVoice | null = null;

    if (this.samples.length > 0) {
      // Create multi-sample based voice
      voice = this.createSampleVoice(playedMidiNote, velocityScale, startTime);
    } else {
      // Fallback: Create powerful synthesis voice
      voice = this.createSynthVoice(playedMidiNote, velocityScale, startTime);
    }

    if (!voice) return;

    // Register voice
    const voiceKey = playedMidiNote.toString();
    const existing = this.activeVoices.get(voiceKey) || [];
    existing.push(voice);
    this.activeVoices.set(voiceKey, existing);

    this.lastPlayedMidiNote = playedMidiNote;
  }

  /**
   * Release a note trigger
   */
  public noteOff(midiNote: number, endTime: number = this.ctx.currentTime) {
    const playedMidiNote = midiNote + this.params.transpose;
    
    // Trigger release articulation samples
    this.triggerReleaseSamples(playedMidiNote, endTime);

    const voiceKey = playedMidiNote.toString();
    const voices = this.activeVoices.get(voiceKey);

    if (!voices || voices.length === 0) return;

    voices.forEach((voice) => {
      if (voice.releasedAt) return;
      voice.releasedAt = endTime;

      const releaseTime = Math.max(0.01, this.params.release);
      
      try {
        voice.envelopeGain.gain.cancelScheduledValues(endTime);
        voice.envelopeGain.gain.setValueAtTime(voice.envelopeGain.gain.value, endTime);
        voice.envelopeGain.gain.exponentialRampToValueAtTime(0.001, endTime + releaseTime);
      } catch (e) {
        try {
          voice.envelopeGain.gain.linearRampToValueAtTime(0, endTime + releaseTime);
        } catch (_) {}
      }

      setTimeout(() => {
        try {
          voice.sources.forEach(src => {
            try { (src as any).stop(); } catch (_) {}
            try { src.disconnect(); } catch (_) {}
          });
          if (voice.tapeHiss) {
            try { voice.tapeHiss.disconnect(); } catch (_) {}
          }
          if (voice.lfoOsc) voice.lfoOsc.stop();
        } catch (err) {
        } finally {
          try {
            voice.filter.disconnect();
            if (voice.filterDrive) voice.filterDrive.disconnect();
            voice.envelopeGain.disconnect();
          } catch (_) {}
        }
      }, releaseTime * 1000 + 100);
    });

    this.activeVoices.set(voiceKey, voices.filter(v => !v.releasedAt));
  }

  /**
   * Create a voice using imported multi-samples
   */
  private createSampleVoice(playedMidiNote: number, velocityScale: number, startTime: number): ActiveVoice | null {
    // Determine sample grouping (exclude release-triggers)
    let matchingSamples = this.samples.filter(s => {
      if (s.articulation === 'release') return false;
      if (s.isDrum || this.mappingMode === 'oneshot') {
        return s.midiNote === playedMidiNote &&
          velocityScale * 127 >= s.velocityLow && velocityScale * 127 <= s.velocityHigh;
      }
      return playedMidiNote >= s.midiNote - 12 && playedMidiNote <= s.midiNote + 12 &&
        velocityScale * 127 >= s.velocityLow && velocityScale * 127 <= s.velocityHigh;
    });

    // Fallback if no matching velocity ranges found
    if (matchingSamples.length === 0) {
      const isDrumTrigger = this.samples.some(s => s.isDrum && s.midiNote === playedMidiNote);
      if (isDrumTrigger || this.mappingMode === 'oneshot') {
        matchingSamples = this.samples.filter(s => s.midiNote === playedMidiNote && s.articulation !== 'release');
      } else {
        // Only consider non-drum samples for chromatic distance-based stretching
        const nonDrumSamples = this.samples.filter(s => !s.isDrum && s.articulation !== 'release');
        const sourceList = nonDrumSamples.length > 0 ? nonDrumSamples : this.samples.filter(s => s.articulation !== 'release');
        matchingSamples = [...sourceList].sort((a, b) => 
          Math.abs(a.midiNote - playedMidiNote) - Math.abs(b.midiNote - playedMidiNote)
        );
      }
    }

    if (matchingSamples.length === 0) {
      console.warn(`No matching sample found for MIDI note ${playedMidiNote} in ${this.activeLibraryName}`);
      return null;
    }

    // Select with composite key Round-Robin support (Note + Velocity range + Articulation)
    let selectedSample = matchingSamples[0];
    if (matchingSamples.length > 1) {
      const rrKey = `${playedMidiNote}_${matchingSamples[0].velocityLow}_${matchingSamples[0].velocityHigh}_${matchingSamples[0].articulation}`;
      const currentRR = this.roundRobinTracker.get(rrKey) || 0;
      selectedSample = matchingSamples[currentRR % matchingSamples.length];
      this.roundRobinTracker.set(rrKey, (currentRR + 1) % matchingSamples.length);
    }

    const buffer = this.buffers.get(selectedSample.id) || this.buffers.get(selectedSample.name) || selectedSample.buffer;

    // Create source
    const source = this.ctx.createBufferSource();
    if (buffer) {
      source.buffer = buffer;
      
      // Map loops
      if (selectedSample.loopPoints?.enabled) {
        source.loop = true;
        const sr = buffer.sampleRate;
        source.loopStart = selectedSample.loopPoints.start / sr;
        source.loopEnd = selectedSample.loopPoints.end / sr;
      }
    } else {
      console.warn(`No decoded audio buffer available for sample: ${selectedSample.name} (${selectedSample.id})`);
      return null;
    }

    // Pitch ratio with Pitch bend offset
    const drift = this.getAnalogDrift();
    const semitonesDifference = playedMidiNote - selectedSample.midiNote + ((this.params.fineTune + drift.pitch) / 100);
    const basePlaybackRate = Math.pow(2, semitonesDifference / 12);
    const bentRate = basePlaybackRate * Math.pow(2, this.pitchBendCents / 1200);
    
    // Apply Pitch Envelope
    this.applyPitchEnvelope(source.playbackRate, bentRate, startTime);

    const filter = this.ctx.createBiquadFilter();
    const biquadMap: Record<string, BiquadFilterType> = {
      lowpass: 'lowpass',
      highpass: 'highpass',
      bandpass: 'bandpass',
      moog_ladder: 'lowpass',
      curtis_sem: 'lowpass',
      oberheim: 'lowpass',
      ms20: 'lowpass'
    };
    filter.type = biquadMap[this.params.filterType] || 'lowpass';
    
    const driftedCutoff = this.params.filterCutoff * Math.pow(2, drift.cutoff);
    filter.frequency.setValueAtTime(driftedCutoff, startTime);
    filter.Q.setValueAtTime(this.params.filterReso, startTime);

    const envelopeGain = this.ctx.createGain();
    this.applyADSR(envelopeGain.gain, velocityScale, startTime);

    // Connect through correct Mixer Strip
    // Automatic routing: if it's a sample, it goes to 'rompler'
    const chId = 'rompler';
    const targetGainNode = this.channelGains[chId] || this.finalOutput;

    // Connect source to filter
    source.connect(filter);

    // NEW: Insert vintage hardware chip simulation nodes
    const vintageSetup = this.createVintageDSP(filter, envelopeGain, startTime);

    // Connect envelope stage to mixer strip
    envelopeGain.connect(targetGainNode);

    this.setupLFO([source], filter, envelopeGain, startTime, playedMidiNote);
    source.start(startTime);

    return {
      id: Math.random().toString(36).substring(7),
      midiNote: playedMidiNote,
      sources: [source],
      filter,
      envelopeGain,
      startedAt: startTime,
      basePlaybackRate,
      channelId: chId,
      vintageShaper: vintageSetup.shaper,
      vintageCrusher: vintageSetup.crusher,
      driftPitchCents: drift.pitch,
      driftCutoffOffset: drift.cutoff
    };
  }

  private tuningTable: number[] | null = null;

  public setMicrotuning(cents: number[]) {
    if (cents.length !== 12) return;
    this.tuningTable = cents;
  }

  private getFrequency(midiNote: number, centsOffset: number = 0): number {
    let note = midiNote;
    let offset = centsOffset;

    if (this.tuningTable) {
      const octave = Math.floor(midiNote / 12);
      const noteInOctave = midiNote % 12;
      offset += this.tuningTable[noteInOctave];
    }

    return 440 * Math.pow(2, (note - 69 + (offset / 100)) / 12);
  }

  /**
   * Calculate subtle analog instability for a new voice
   */
  private getAnalogDrift(): { pitch: number; cutoff: number } {
    const drift = (this.params.analogDrift || 0) / 100;
    const pitch = (Math.random() * 2 - 1) * 10 * drift;
    const cutoff = (Math.random() * 2 - 1) * 0.2 * drift;
    return { pitch, cutoff };
  }

  private createSigmoidCurve(amount: number): Float32Array {
    const n = 4096;
    const curve = new Float32Array(n);
    const k = amount * 2;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
    }
    return curve;
  }

  /**
   * Create a synthetic/synthesizer voice using advanced dual oscillator + classic filter modeling
   */
  private createSynthVoice(playedMidiNote: number, velocityScale: number, startTime: number): ActiveVoice | null {
    const drift = this.getAnalogDrift();
    const centsOffset = (this.params.fineTune || 0) + drift.pitch;
    const freq = this.getFrequency(playedMidiNote, centsOffset);

    const unisonCount = Math.max(1, Math.min(8, this.params.unisonVoices || 1));
    const unisonDetune = this.params.unisonDetune || 0;
    const unisonSpread = (this.params.unisonSpread || 0) / 100;

    const voiceSources: (OscillatorNode | AudioBufferSourceNode)[] = [];
    const voiceMixer = this.ctx.createGain();

    for (let i = 0; i < unisonCount; i++) {
      let detune = 0;
      let pan = 0;
      if (unisonCount > 1) {
        const ratio = i / (unisonCount - 1);
        detune = (ratio * 2 - 1) * unisonDetune;
        pan = (ratio * 2 - 1) * unisonSpread;
      }

      const osc1 = this.ctx.createOscillator();
      const type1 = this.params.oscType1 || 'sawtooth';
      osc1.type = (type1 === 'pwm' || type1 === 'sid_pulse' || type1 === 'nes_pulse') ? 'square' : type1 as OscillatorType;
      osc1.frequency.setValueAtTime(freq, startTime);
      osc1.detune.setValueAtTime(detune, startTime);
      
      const oscGain = this.ctx.createGain();
      oscGain.gain.value = 1 / Math.sqrt(unisonCount);

      const panner = this.ctx.createStereoPanner();
      panner.pan.value = pan;

      osc1.connect(oscGain);
      oscGain.connect(panner);
      panner.connect(voiceMixer);
      
      osc1.start(startTime);
      voiceSources.push(osc1);

      const type2 = this.params.oscType2 || 'none';
      if (type2 !== 'none') {
        const osc2 = this.ctx.createOscillator();
        let freq2 = freq;
        if (type2 === 'sub_oct') {
          osc2.type = 'square';
          freq2 = freq / 2;
        } else {
          osc2.type = type2 as OscillatorType;
          const detuneCents = (this.params.oscDetune || 0) + detune;
          freq2 = freq * Math.pow(2, detuneCents / 1200);
        }
        osc2.frequency.setValueAtTime(freq2, startTime);
        
        const osc2Gain = this.ctx.createGain();
        osc2Gain.gain.value = (this.params.osc2Volume || 0.5) / Math.sqrt(unisonCount);

        osc2.connect(osc2Gain);
        osc2Gain.connect(panner);
        
        osc2.start(startTime);
        voiceSources.push(osc2);
      }
    }

    const noiseVol = this.params.noiseVolume || 0;
    if (noiseVol > 0) {
      const noise = this.ctx.createScriptProcessor(1024, 0, 1);
      noise.onaudioprocess = (e) => {
        const output = e.outputBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) {
          output[i] = (Math.random() * 2 - 1) * noiseVol * 0.18;
        }
      };
      noise.connect(voiceMixer);
      voiceSources.push(noise as any);
    }

    const filter = this.ctx.createBiquadFilter();
    const biquadMap: Record<string, BiquadFilterType> = {
      lowpass: 'lowpass', highpass: 'highpass', bandpass: 'bandpass',
      moog_ladder: 'lowpass', curtis_sem: 'lowpass', oberheim: 'lowpass', ms20: 'lowpass'
    };
    filter.type = biquadMap[this.params.filterType] || 'lowpass';
    
    const driftedCutoff = this.params.filterCutoff * Math.pow(2, drift.cutoff);
    filter.frequency.setValueAtTime(driftedCutoff, startTime);
    filter.Q.setValueAtTime(this.params.filterReso, startTime);

    let filterDriveNode: WaveShaperNode | undefined;
    if (this.params.filterDrive && this.params.filterDrive > 0) {
      filterDriveNode = this.ctx.createWaveShaper();
      filterDriveNode.curve = this.createSigmoidCurve(this.params.filterDrive);
      voiceMixer.connect(filterDriveNode);
      filterDriveNode.connect(filter);
    } else {
      voiceMixer.connect(filter);
    }

    const envelopeGain = this.ctx.createGain();
    this.applyADSR(envelopeGain.gain, velocityScale, startTime);
    filter.connect(envelopeGain);

    this.setupLFO(voiceSources, filter, envelopeGain, startTime, playedMidiNote);

    const chId = playedMidiNote < 48 ? 'sub' : 'synth';
    const targetGainNode = this.channelGains[chId] || this.finalOutput;
    envelopeGain.connect(targetGainNode);

    return {
      id: Math.random().toString(36).substring(7),
      midiNote: playedMidiNote,
      sources: voiceSources,
      filter,
      filterDrive: filterDriveNode,
      envelopeGain,
      startedAt: startTime,
      channelId: chId,
      driftPitchCents: drift.pitch,
      driftCutoffOffset: drift.cutoff
    };
  }

  /**
   * Generates the ADSR volume envelope
   */
  private applyADSR(gainParam: AudioParam, velocityScale: number, startTime: number) {
    const peakVolume = velocityScale * 0.9;
    const sustainVolume = peakVolume * this.params.sustain;

    const attackTime = Math.max(0.005, this.params.attack);
    const decayTime = Math.max(0.005, this.params.decay);

    gainParam.cancelScheduledValues(startTime);
    gainParam.setValueAtTime(0.001, startTime);

    const curve = this.params.envelopeCurve || 'exp';

    if (this.params.chipEmulation === 'ensoniq_asr10' || curve === 's-curve') {
      const attackCurve = new Float32Array(10);
      for (let i = 0; i < 10; i++) {
        attackCurve[i] = 0.001 + Math.pow(i / 9, 2) * peakVolume;
      }
      gainParam.setValueCurveAtTime(attackCurve, startTime, attackTime);

      const decayCurve = new Float32Array(10);
      for (let i = 0; i < 10; i++) {
        decayCurve[i] = sustainVolume + Math.pow((9 - i) / 9, 3) * (peakVolume - sustainVolume);
      }
      gainParam.setValueCurveAtTime(decayCurve, startTime + attackTime, decayTime);
    } else if (curve === 'exp') {
      gainParam.exponentialRampToValueAtTime(peakVolume, startTime + attackTime);
      gainParam.exponentialRampToValueAtTime(Math.max(0.001, sustainVolume), startTime + attackTime + decayTime);
    } else {
      // Linear
      gainParam.linearRampToValueAtTime(peakVolume, startTime + attackTime);
      gainParam.linearRampToValueAtTime(Math.max(0.001, sustainVolume), startTime + attackTime + decayTime);
    }
  }

  /**
   * Configures LFO modulation routings
   */
  private setupLFO(
    sources: (AudioBufferSourceNode | OscillatorNode)[],
    filter: BiquadFilterNode,
    envelopeGain: GainNode,
    startTime: number,
    midiNote: number
  ) {
    const lfos: { lfoOsc: OscillatorNode; lfoGain: GainNode }[] = [];

    // Basic LFO
    if (this.params.lfoTarget !== 'none' && this.params.lfoDepth > 0) {
      const lfoOsc = this.ctx.createOscillator();
      lfoOsc.type = this.params.lfoType;
      
      // LFO frequency keytrack: higher notes = faster LFO (optional concept)
      // Here we'll just use the base rate for now or implement if requested
      const rate = this.params.lfoRate;
      lfoOsc.frequency.setValueAtTime(rate, startTime);

      const lfoGain = this.ctx.createGain();
      lfoGain.gain.setValueAtTime(0, startTime);
      
      // Fade-in logic (0.5s fade in for testing)
      lfoGain.gain.linearRampToValueAtTime(1.0, startTime + 0.5);

      if (this.params.lfoTarget === 'cutoff') {
        const depth = this.params.lfoDepth * 3500;
        const targetGain = this.ctx.createGain();
        targetGain.gain.value = depth;
        lfoGain.connect(targetGain);
        targetGain.connect(filter.frequency);
      } 
      else if (this.params.lfoTarget === 'pitch') {
        const depth = this.params.lfoDepth * 150;
        const targetGain = this.ctx.createGain();
        targetGain.gain.value = depth;
        lfoGain.connect(targetGain);
        sources.forEach(src => {
          if (src instanceof OscillatorNode) {
            targetGain.connect(src.detune);
          } else {
            const pbDepth = this.params.lfoDepth * 0.15;
            const pbGain = this.ctx.createGain();
            pbGain.gain.value = pbDepth;
            lfoGain.connect(pbGain);
            pbGain.connect(src.playbackRate);
          }
        });
      } 
      else if (this.params.lfoTarget === 'volume') {
        const depth = this.params.lfoDepth * 0.45;
        const targetGain = this.ctx.createGain();
        targetGain.gain.value = depth;
        lfoGain.connect(targetGain);
        targetGain.connect(envelopeGain.gain);
      }

      lfoOsc.connect(lfoGain);
      lfoOsc.start(startTime);
      lfos.push({ lfoOsc, lfoGain });
    }

    // Modulation Matrix processing
    if (this.params.modMatrix) {
      this.params.modMatrix.forEach(route => {
        if (route.source === 'lfo1' || route.source === 'lfo2') {
          // For simplicity, we'll create a new LFO for each route in the matrix
          // in a production app we'd reuse the LFO oscillators
          const lfoOsc = this.ctx.createOscillator();
          lfoOsc.type = this.params.lfoType; // use main LFO type for now
          lfoOsc.frequency.setValueAtTime(this.params.lfoRate, startTime);
          
          const lfoGain = this.ctx.createGain();
          const amount = route.bipolar ? route.amount * 2 : route.amount;
          
          lfoOsc.connect(lfoGain);
          
          if (route.dest === 'cutoff') {
            lfoGain.gain.value = amount * 5000;
            lfoGain.connect(filter.frequency);
          } else if (route.dest === 'pitch') {
            lfoGain.gain.value = amount * 1200;
            sources.forEach(src => {
              if (src instanceof OscillatorNode) lfoGain.connect(src.detune);
            });
          } else if (route.dest === 'resonance') {
            lfoGain.gain.value = amount * 20;
            lfoGain.connect(filter.Q);
          }
          
          lfoOsc.start(startTime);
          lfos.push({ lfoOsc, lfoGain });
        }
      });
    }

    return lfos[0] || null; // Return first one for back-compat with ActiveVoice interface
  }

  /**
   * Generates dynamic bitcrushing, sample-rate reduction and saturation 
   * to emulate classic system processors like Akai, E-MU SP-1200, or Ensoniq ASR-10.
   */
  private createVintageDSP(
    filter: BiquadFilterNode, 
    envelopeGain: GainNode, 
    startTime: number
  ): { shaper?: WaveShaperNode; crusher?: ScriptProcessorNode } {
    const emulation = this.params.chipEmulation;
    if (emulation === 'none') {
      filter.connect(envelopeGain);
      return {};
    }

    let bitDepth = this.params.bitDepth;
    let sampleRate = this.ctx.sampleRate;
    let quality = this.params.resamplingQuality;
    let saturation = this.params.analogWarmth;
    let dacColor = this.params.dacColor;

    // Apply hardware emulation defaults if selected
    if (emulation === 'akai_s1000') {
      bitDepth = 16;
      sampleRate = 44100;
      quality = 'linear';
      saturation = Math.max(15, saturation);
      dacColor = Math.max(25, dacColor);
      filter.frequency.setValueAtTime(Math.min(filter.frequency.value, 15000), startTime);
    } else if (emulation === 'emu_sp1200') {
      bitDepth = 12;
      sampleRate = 26040;
      quality = 'drop'; // Nearest-neighbor downsampling creates authentic metallic ring aliasing
      saturation = Math.max(50, saturation);
      dacColor = Math.max(40, dacColor);
      filter.frequency.setValueAtTime(Math.min(filter.frequency.value, 8000), startTime);
    } else if (emulation === 'ensoniq_asr10') {
      bitDepth = 16;
      sampleRate = 30000;
      quality = 'linear';
      saturation = Math.max(60, saturation);
      dacColor = Math.max(30, dacColor);
    } else if (emulation === 'roland_s550') {
      bitDepth = 12;
      sampleRate = 30000;
      quality = 'linear';
      saturation = Math.max(35, saturation);
      dacColor = Math.max(55, dacColor);
      filter.frequency.setValueAtTime(Math.min(filter.frequency.value, 10000), startTime);
    } else if (emulation === 'kurzweil_k2000') {
      bitDepth = 16;
      sampleRate = 48000;
      quality = 'hifi';
      saturation = Math.max(40, saturation);
    } else if (emulation === 'korg_triton') {
      bitDepth = 16;
      sampleRate = 48000;
      quality = 'hifi';
      saturation = Math.max(70, saturation); // "Valve Force" vacuum tube saturation
    } else if (emulation === 'yamaha_motif') {
      bitDepth = 16;
      sampleRate = 44100;
      quality = 'hifi';
      saturation = Math.max(20, saturation);
    } else if (emulation === 'sid_6581') {
      bitDepth = 8;
      sampleRate = 22050;
      quality = 'drop';
      saturation = Math.max(80, saturation);
      dacColor = Math.max(70, dacColor);
    } else if (emulation === 'nes_apu') {
      bitDepth = 4;
      sampleRate = 16000;
      quality = 'drop';
      saturation = Math.max(40, saturation);
    } else if (emulation === 'mellotron_tape') {
      bitDepth = 24;
      sampleRate = 44100;
      quality = 'linear';
      saturation = Math.max(30, saturation);
      dacColor = Math.max(50, dacColor);
    }

    let lastNode: AudioNode = filter;

    // 1. WAVE SHAPER (Saturation / Overdrive / Preamp)
    let shaper: WaveShaperNode | undefined;
    if (saturation > 0) {
      shaper = this.ctx.createWaveShaper();
      if (emulation === 'korg_triton') {
        shaper.curve = this.generateTubeCurve(saturation);
      } else if (emulation === 'kurzweil_k2000') {
        shaper.curve = this.generateHardClipCurve(saturation);
      } else {
        shaper.curve = this.generateSoftClipCurve(saturation);
      }
      shaper.oversample = '4x';
      lastNode.connect(shaper);
      lastNode = shaper;
    }

    // 2. BITCRUSHER / RESAMPLER (Enhanced with Jitter & Aliasing)
    let crusher: ScriptProcessorNode | undefined;
    if (bitDepth < 24 || sampleRate < this.ctx.sampleRate || quality !== 'hifi') {
      crusher = this.ctx.createScriptProcessor(512, 1, 1);
      
      let lastVal = 0;
      let phaser = 0;
      const step = Math.pow(0.5, bitDepth - 1);
      const ratio = sampleRate / this.ctx.sampleRate;
      const isNearest = quality === 'drop';
      const jitter = (this.params.chipJitter ?? 15) * 0.00005;
      const aliasingDepth = (this.params.chipAliasing ?? 30) / 100;
      
      crusher.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const output = e.outputBuffer.getChannelData(0);
        
        for (let i = 0; i < input.length; i++) {
          phaser += ratio * (1 + (Math.random() - 0.5) * jitter);
          if (phaser >= 1) {
            phaser -= Math.floor(phaser);
            const val = input[i];
            // Quantize
            const quantized = Math.round(val / step) * step;
            // Mix back aliasing (dry/wet quantization based on aliasing depth)
            lastVal = quantized * aliasingDepth + val * (1 - aliasingDepth);
          }
          
          if (isNearest) {
            output[i] = lastVal;
          } else {
            // Linear interpolate for a warmer downsampling
            output[i] = lastVal + (input[i] - lastVal) * phaser;
          }
        }
      };
      
      lastNode.connect(crusher);
      lastNode = crusher;
    }

    // 3. COLORATION EQ (For DAC Color, emulate high-shelf roll off of vintage DACs)
    if (dacColor > 0) {
      const colorFilter = this.ctx.createBiquadFilter();
      colorFilter.type = 'highshelf';
      colorFilter.frequency.setValueAtTime(3200, startTime);
      // Dampen highs based on dacColor (-15dB max dampening)
      const gainValue = -(dacColor / 100) * 15;
      colorFilter.gain.setValueAtTime(gainValue, startTime);
      
      lastNode.connect(colorFilter);
      lastNode = colorFilter;
    }

    // Connect final DSP node to envelope gain
    lastNode.connect(envelopeGain);

    return { shaper, crusher };
  }

  private generateSoftClipCurve(amount: number): Float32Array {
    const k = amount * 1.5;
    const n = 44100;
    const curve = new Float32Array(n);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private generateNeveCurve(amount: number): Float32Array {
    const n = 44100;
    const curve = new Float32Array(n);
    const k = amount / 100;
    
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      // Neve-style: Subtle saturation with even-order harmonics (asymmetry)
      // and soft top-end rounding
      const absX = Math.abs(x);
      if (x > 0) {
        curve[i] = x - k * (x * x);
      } else {
        curve[i] = x + k * (x * x) * 0.5; // Asymmetric
      }
      // Apply general soft clipping
      curve[i] = Math.tanh(curve[i] * (1 + k));
    }
    return curve;
  }

  private generateHardClipCurve(amount: number): Float32Array {
    const limit = Math.max(0.1, 1.0 - (amount / 120));
    const n = 44100;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      if (x > limit) curve[i] = limit;
      else if (x < -limit) curve[i] = -limit;
      else curve[i] = x;
    }
    return curve;
  }

  private generateTubeCurve(amount: number): Float32Array {
    const n = 44100;
    const curve = new Float32Array(n);
    const drive = 1 + (amount / 12);
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      if (x > 0) {
        curve[i] = 1.0 - Math.exp(-x * drive);
      } else {
        curve[i] = -1.0 + Math.exp(x * drive * 0.7);
      }
    }
    return curve;
  }

  /**
   * Applies the Pitch Envelope modulation on sample playback rate.
   */
  private applyPitchEnvelope(playbackRateParam: AudioParam, baseRate: number, startTime: number) {
    const attack = Math.max(0.005, this.params.pitchEnvAttack ?? 0.1);
    const decay = Math.max(0.005, this.params.pitchEnvDecay ?? 0.3);
    const depth = this.params.pitchEnvDepth ?? 0;

    if (depth === 0) {
      playbackRateParam.setValueAtTime(baseRate, startTime);
      return;
    }

    const peakRate = baseRate * Math.pow(2, depth / 12);

    playbackRateParam.cancelScheduledValues(startTime);
    playbackRateParam.setValueAtTime(baseRate, startTime);
    playbackRateParam.linearRampToValueAtTime(peakRate, startTime + attack);
    playbackRateParam.exponentialRampToValueAtTime(Math.max(0.001, baseRate), startTime + attack + decay);
  }

  /**
   * Applies choke groups / mute groups for drum programming (e.g. Open Hat choked by Closed Hat).
   */
  private applyMuteGroups(playedMidiNote: number, startTime: number) {
    const hiHatGroup = [42, 44, 46];
    if (hiHatGroup.includes(playedMidiNote)) {
      hiHatGroup.forEach(note => {
        if (note !== playedMidiNote) {
          const voiceKey = note.toString();
          const voices = this.activeVoices.get(voiceKey);
          if (voices && voices.length > 0) {
            voices.forEach(voice => {
              try {
                voice.envelopeGain.gain.cancelScheduledValues(startTime);
                voice.envelopeGain.gain.setValueAtTime(voice.envelopeGain.gain.value, startTime);
                voice.envelopeGain.gain.linearRampToValueAtTime(0, startTime + 0.015);
                setTimeout(() => {
                  try {
                    voice.sources.forEach(src => {
                      try { (src as any).stop(); } catch (_) {}
                    });
                    if (voice.lfoOsc) voice.lfoOsc.stop();
                  } catch (_) {}
                }, 20);
              } catch (_) {}
            });
            this.activeVoices.set(voiceKey, []);
          }
        }
      });
    }
  }

  /**
   * Triggers release articulation samples when a MIDI key is released.
   */
  private triggerReleaseSamples(playedMidiNote: number, startTime: number) {
    const releaseSamples = this.samples.filter(s => 
      s.articulation === 'release' && 
      playedMidiNote >= s.midiNote - 12 && playedMidiNote <= s.midiNote + 12
    );

    releaseSamples.forEach(sample => {
      const buffer = this.buffers.get(sample.id) || this.buffers.get(sample.name) || sample.buffer;
      if (!buffer) return;

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;

      const semitonesDifference = playedMidiNote - sample.midiNote + (this.params.fineTune / 100);
      const basePlaybackRate = Math.pow(2, semitonesDifference / 12);
      source.playbackRate.setValueAtTime(basePlaybackRate, startTime);

      const filter = this.ctx.createBiquadFilter();
      const biquadMap: Record<string, BiquadFilterType> = {
        lowpass: 'lowpass',
        highpass: 'highpass',
        bandpass: 'bandpass',
        moog_ladder: 'lowpass',
        curtis_sem: 'lowpass',
        oberheim: 'lowpass',
        ms20: 'lowpass'
      };
      filter.type = biquadMap[this.params.filterType] || 'lowpass';
      filter.frequency.setValueAtTime(this.params.filterCutoff, startTime);
      filter.Q.setValueAtTime(this.params.filterReso, startTime);

      const envelopeGain = this.ctx.createGain();
      envelopeGain.gain.setValueAtTime(0.7, startTime);
      envelopeGain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.5);

      source.connect(filter);
      const vintageSetup = this.createVintageDSP(filter, envelopeGain, startTime);
      envelopeGain.connect(this.finalOutput);

      source.start(startTime);

      setTimeout(() => {
        try { source.stop(); } catch (_) {}
        try {
          source.disconnect();
          filter.disconnect();
          envelopeGain.disconnect();
        } catch (_) {}
      }, 600);
    });
  }

  /**
   * Helper to compute active running voices to power real CPU & DISK performance monitors.
   */
  /**
   * Renders the current synthesizer state to a single high-quality AudioBuffer
   */
  public async renderOneShot(midiNote: number = 60, duration: number = 2.0): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(2, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    
    // Simplification: In a full implementation we would rebuild the DSP chain in the offlineCtx.
    // For this context, we will return a placeholder buffer for now,
    // as building the entire graph in OfflineAudioContext is extensive.
    return new Promise((resolve) => {
      const buffer = this.ctx.createBuffer(2, this.ctx.sampleRate * duration, this.ctx.sampleRate);
      // Fill with a simple sine for testing if needed
      resolve(buffer);
    });
  }

  /**
   * Persistence: Save current parameters to local storage
   */
  public savePreset(name: string) {
    const presets = JSON.parse(localStorage.getItem('kloader_presets') || '{}');
    presets[name] = { ...this.params };
    localStorage.setItem('kloader_presets', JSON.stringify(presets));
  }

  /**
   * Persistence: Load presets list
   */
  public getSavedPresets(): string[] {
    const presets = JSON.parse(localStorage.getItem('kloader_presets') || '{}');
    return Object.keys(presets);
  }

  /**
   * Persistence: Load a specific preset
   */
  public loadPreset(name: string): SynthParams | null {
    const presets = JSON.parse(localStorage.getItem('kloader_presets') || '{}');
    return presets[name] || null;
  }
}

