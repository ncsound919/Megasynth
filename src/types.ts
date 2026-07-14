export interface KontaktSample {
  id: string;
  name: string;
  buffer: AudioBuffer | null;
  midiNote: number;       // Parsed root MIDI note (e.g., 60 for C4)
  velocityLow: number;    // Min velocity (0-127) that triggers this sample
  velocityHigh: number;   // Max velocity (0-127) that triggers this sample
  velocity: number;       // Nominal velocity representing this sample
  articulation: string;   // e.g., 'sustain', 'staccato', 'release', 'default'
  size?: number;          // Bytes (optional, for UI info)
  isDrum?: boolean;       // Is it a parsed drum sample?
  roundRobinIdx?: number; // Round robin index if multiple samples exist on same key
  formatDetected?: string; // Format detected (WAV, SFZ, SF2, AKP, SND, SVD, etc.)
  loopPoints?: {
    start: number;
    end: number;
    enabled: boolean;
  };
}

export interface KontaktZone {
  lowMidi: number;
  highMidi: number;
  velocityLow: number;
  velocityHigh: number;
  sampleId: string;
  roundRobinIdx: number;
}

export interface KontaktInstrument {
  id: string;
  name: string;
  zones: KontaktZone[];
  baseNote: number;
}

export interface KontaktLibrary {
  name: string;
  samples: KontaktSample[];
  articulations: string[];
  velocityLayers: number;
}

export interface SynthParams {
  attack: number;         // Seconds
  decay: number;          // Seconds
  sustain: number;        // Amplitude (0-1)
  release: number;        // Seconds
  filterType: 'lowpass' | 'highpass' | 'bandpass' | 'moog_ladder' | 'curtis_sem' | 'oberheim' | 'ms20';
  filterCutoff: number;   // Hz
  filterReso: number;     // Q (0-20)
  lfoRate: number;        // Hz (0.1 - 20)
  lfoDepth: number;       // Intensity (0 - 1)
  lfoType: 'sine' | 'triangle' | 'sawtooth' | 'square';
  lfoTarget: 'cutoff' | 'pitch' | 'volume' | 'pulseWidth' | 'none';
  fineTune: number;       // Cents (-100 to 100)
  transpose: number;      // Semitones (-24 to 24)
  glide: number;          // Portamento time (0 to 1s)
  
  // Retro Rompler / Vintage Emulation additions
  chipEmulation: 'none' | 'akai_s1000' | 'emu_sp1200' | 'ensoniq_asr10' | 'roland_s550' | 'kurzweil_k2000' | 'korg_triton' | 'yamaha_motif' | 'sid_6581' | 'nes_apu' | 'ym2612_fm' | 'mellotron_tape';
  bitDepth: number;       // 8, 12, 16, 24
  resamplingQuality: 'hifi' | 'linear' | 'drop';
  analogWarmth: number;   // Saturation depth (0 - 100)
  dacColor: number;       // Low-pass/dampening resonance coloration (0 - 100)
  volume?: number;        // Optional general level (0 - 1)
  pan?: number;           // Optional pan (-1 to 1)
  pitchEnvAttack?: number; // Pitch Env Attack time in seconds
  pitchEnvDecay?: number;  // Pitch Env Decay time in seconds
  pitchEnvDepth?: number;  // Pitch Env depth in semitones (-12 to 12)
  sidechainGain?: number;  // Sidechain compression gain/reduction amount (0 - 100)
  
  // Enhanced Pro-Audio Parameters
  neveDrive?: number;      // Neve-style console saturation (0-100)
  mixerWidth?: number;     // Stereo width enhancement (0-100)
  chipAliasing?: number;   // Controlled aliasing depth (0-100)
  chipJitter?: number;     // Clock jitter amount (0-100)
  chipHiss?: number;       // Background analog noise floor (0-100)
  
  // Dual Oscillator & Synthesis elements
  oscType1?: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'pwm' | 'nes_pulse' | 'sid_pulse';
  oscType2?: 'sine' | 'triangle' | 'sawtooth' | 'square' | 'sub_oct' | 'none';
  oscDetune?: number;      // Cents (0 - 100)
  osc2Volume?: number;     // Volume ratio (0 - 1)
  pulseWidth?: number;     // Duty cycle for pwm/sid_pulse/nes_pulse osc1 types (0-1, 0.5 = square)
  noiseVolume?: number;    // White noise level (0 - 1)
  wowFlutter?: number;     // Mellotron wow & flutter (0 - 100)
  tapeNoise?: number;      // Mellotron mechanical tape background noise (0 - 100)
  syncMode?: boolean;      // Oscillator 2 syncs to Oscillator 1
  ringMod?: boolean;       // Ring Modulation between oscillators
}

export interface EQBand {
  id: string;
  enabled: boolean;
  type: 'lowshelf' | 'highshelf' | 'peaking' | 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  freq: number;
  gain: number;
  q: number;
  color: string;
  dynThreshold?: number; // -60 to 0 dB
  dynRatio?: number;     // 1 to 20
  dynAttack?: number;    // ms
  dynRelease?: number;   // ms
  dynEnabled?: boolean;
}

export interface ModRoute {
  source: 'lfo1' | 'lfo2' | 'env1' | 'env2' | 'velocity' | 'aftertouch' | 'modwheel';
  dest: 'pitch' | 'cutoff' | 'resonance' | 'drive' | 'width' | 'pan';
  amount: number;
  bipolar: boolean;
}

export interface AdvancedSynthParams extends SynthParams {
  analogDrift?: number; // 0-100%
  unisonVoices?: number;
  unisonDetune?: number;
  unisonSpread?: number;
  filterDrive?: number;
  filterMode?: 'ladder' | 'ms20' | 'sallenkey';
  envelopeCurve?: 'linear' | 'exp' | 's-curve';
  modMatrix?: ModRoute[];
}

export interface ChannelState {
  id: string;
  label: string;
  volume: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  outputRoute: 'master' | 'out2' | 'out3' | 'out4';
  eq: EQBand[];
  compressor: {
    enabled: boolean;
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    makeupGain: number;
  };
  bus1: boolean;
  bus2: boolean;
  bus3: boolean;
  bus4: boolean;
}

export type DistortionStyle = 'A' | 'E' | 'N' | 'T' | 'P';

export interface DistortionFX {
  enabled: boolean;
  style: DistortionStyle;
  drive: number;
  punish: boolean;
  tone: number;
  outputTrim: number;
  mix: number;
}

export interface ChorusFX {
  enabled: boolean;
  mode: 'I' | 'II' | 'I+II';
  rateHz: number;
  depthMs: number;
  spread: number;
  mix: number;
}

export interface FlangerFX {
  enabled: boolean;
  bbdType: 'classic' | 'modern';
  rateHz: number;
  depthMs: number;
  feedback: number;
  mist: number; // Harmonic distortion/noise component
  mix: number;
}

export interface DelayFX {
  enabled: boolean;
  style: 'studio' | 'magnetic' | 'analog' | 'telephone';
  timeMode: 'free' | 'synced';
  timeMs: number;
  syncDivision: string;
  feedback: number;
  lowCut: number;
  highCut: number;
  ducking: number; // 0-100% ducking depth
  pingPong: boolean;
  mix: number;
}

export interface ReverbFX {
  enabled: boolean;
  mode: 'algorithmic' | 'convolution';
  type: 'room' | 'hall' | 'plate' | 'ambient';
  irName?: string;
  size: number;
  decay: number;
  preDelayMs: number;
  damping: number;
  mix: number;
}

export interface ChipFX {
  enabled: boolean;
  bitDepth: number;
  targetSR: number;
  antiAliasHz: number;
  dither: number;
  jitter: number;
  hiss: number;
  drive: number;
  driveCurve: 'none' | 'tube' | 'opamp' | 'tape' | 'hardclip';
  quantStyle: 'linear' | 'stepped' | 'muLikeSoft';
  wowHz: number;
  wowDepth: number;
  flutterHz: number;
  flutterDepth: number;
  mix: number;
}

export interface FXChainState {
  chip: ChipFX;
  distortion: DistortionFX;
  chorus: ChorusFX;
  flanger: FlangerFX;
  delay: DelayFX;
  reverb: ReverbFX;
  order: Array<'chip' | 'distortion' | 'chorus' | 'flanger' | 'delay' | 'reverb'>;
}

export const DEFAULT_FX_STATE: FXChainState = {
  chip: { 
    enabled: false, 
    bitDepth: 12, 
    targetSR: 26040, 
    antiAliasHz: 12000, 
    dither: 0.2, 
    jitter: 0.1, 
    hiss: 0.05, 
    drive: 0.2, 
    driveCurve: 'tube', 
    quantStyle: 'stepped',
    wowHz: 0.5,
    wowDepth: 5,
    flutterHz: 12,
    flutterDepth: 3,
    mix: 100
  },
  distortion: { enabled: false, style: 'A', drive: 30, punish: false, tone: 0, outputTrim: -3, mix: 100 },
  chorus: { enabled: false, mode: 'I', rateHz: 0.5, depthMs: 4, spread: 80, mix: 50 },
  flanger: { enabled: false, bbdType: 'classic', rateHz: 0.2, depthMs: 3, feedback: 60, mist: 10, mix: 50 },
  delay: { enabled: false, style: 'studio', timeMode: 'synced', timeMs: 350, syncDivision: '1/8', feedback: 35, lowCut: 200, highCut: 4000, ducking: 0, pingPong: true, mix: 30 },
  reverb: { enabled: false, mode: 'algorithmic', type: 'hall', size: 60, decay: 55, preDelayMs: 20, damping: 40, mix: 25 },
  order: ['chip', 'distortion', 'chorus', 'flanger', 'delay', 'reverb'],
};

/**
 * State for one auxiliary bus (bus1-4). Channels send to these pre- or
 * post-fader via ChannelState.bus1..bus4 (existing boolean toggles).
 * This is the RETURN side: level/mute/pan for what comes back into the
 * master mix. Without this, a channel's bus send had a source (the
 * boolean toggle) but no destination — audio sent to a bus vanished.
 */
export interface BusSendState {
  id: 'bus1' | 'bus2' | 'bus3' | 'bus4';
  label: string;
  returnLevel: number;   // 0-1.2, gain applied on the way back into master
  muted: boolean;
  pan: number;            // -1 to 1
}

export const DEFAULT_BUS_SENDS: BusSendState[] = [
  { id: 'bus1', label: 'Bus 1', returnLevel: 1, muted: false, pan: 0 },
  { id: 'bus2', label: 'Bus 2', returnLevel: 1, muted: false, pan: 0 },
  { id: 'bus3', label: 'Bus 3', returnLevel: 1, muted: false, pan: 0 },
  { id: 'bus4', label: 'Bus 4', returnLevel: 1, muted: false, pan: 0 },
];

export interface MasterState {
  volume: number;
  neveDrive: number;
  stereoWidth: number;
  busCompEnabled: boolean;
  busCompThreshold: number;
  busCompRatio: number;
  busCompAttack: number;
  busCompRelease: number;
  busCompMakeup: number;
  sidechainSource: string;
  fx: FXChainState;
  bpm: number;
  busSends: BusSendState[];
}

export interface SequenceStep {
  active: boolean;
  velocity: number;       // 1-127
}

export interface SequencerTrack {
  id: string;
  name: string;
  type: 'drum' | 'synth';
  soundId: string;        // 'kick', 'snare', 'hihat', 'clap' or MIDI note number as string (e.g. '60')
  steps: SequenceStep[];  // Array of 16 steps
  volume: number;         // 0 - 1
  muted: boolean;
}