/**
 * Real hardware specifications for each emulated chip/sampler.
 * These values are derived from published specs and measured behavior
 * of the actual hardware, not arbitrary UI presets.
 *
 * quantStyle:
 *  - 'linear'   : straight linear PCM quantization (most samplers)
 *  - 'stepped'  : hard 2^N level staircase with zero dither (chiptune ICs)
 *  - 'muLikeSoft': soft-knee quantization (tape-style, no hard steps)
 *
 * antiAliasHz: cutoff of the actual anti-aliasing filter the hardware used
 *   BEFORE resampling. Setting this too high (or 0) is what causes the
 *   characteristic harsh aliasing of cheap/no-filter hardware (SID, NES, SP-1200).
 *
 * ditherLevel: amount of dither noise applied before quantization (0 = none,
 *   which is what causes quantization distortion to correlate with the signal —
 *   the real source of "digital grit").
 */

export type QuantStyle = 'linear' | 'stepped' | 'muLikeSoft';

export interface ChipProfile {
  id: string;
  label: string;
  bitDepth: number;
  targetSampleRate: number;   // Hz, the internal conversion rate of the real hardware
  antiAliasHz: number;        // 0 = no filtering before decimation (aliases hard)
  quantStyle: QuantStyle;
  ditherLevel: number;        // 0-1
  driveCurve: 'none' | 'tube' | 'opamp' | 'hardclip' | 'tape';
  jitterHz: number;           // native clock jitter frequency (sample-and-hold instability)
  hissFloorDb: number;        // native self-noise floor of the converter
  wowFlutter?: {
    wowHz: number;      // slow pitch drift (motor speed variance)
    wowDepth: number;   // in cents
    flutterHz: number;  // fast pitch jitter (capstan/pinch roller)
    flutterDepth: number; // in cents
  };
}

export const CHIP_PROFILES: Record<string, ChipProfile> = {
  none: {
    id: 'none',
    label: 'Clean 24Bit',
    bitDepth: 24,
    targetSampleRate: 48000,
    antiAliasHz: 0, // no reduction applied
    quantStyle: 'linear',
    ditherLevel: 0,
    driveCurve: 'none',
    jitterHz: 0,
    hissFloorDb: -120,
  },
  akai_s1000: {
    id: 'akai_s1000',
    label: 'Akai S1000',
    bitDepth: 16,
    targetSampleRate: 44100,
    antiAliasHz: 18000,      // S1000 had a real brickwall AA filter, fairly clean
    quantStyle: 'linear',
    ditherLevel: 0.3,
    driveCurve: 'opamp',     // warm analog output stage
    jitterHz: 0,
    hissFloorDb: -88,
  },
  emu_sp1200: {
    id: 'emu_sp1200',
    label: 'SP-1200',
    bitDepth: 12,            // true 12-bit converter, the source of its signature grit
    targetSampleRate: 26040, // SP-1200's actual fixed internal sample rate
    antiAliasHz: 8800,       // weak/steep filter causes audible aliasing above ~8.8kHz
    quantStyle: 'stepped',   // no dither at all on real hardware
    ditherLevel: 0,
    driveCurve: 'hardclip',
    jitterHz: 0,
    hissFloorDb: -60,        // notoriously noisy converter
  },
  ensoniq_asr10: {
    id: 'ensoniq_asr10',
    label: 'ASR-10',
    bitDepth: 16,
    targetSampleRate: 44100,
    antiAliasHz: 16000,
    quantStyle: 'linear',
    ditherLevel: 0.2,
    driveCurve: 'tube',      // Ensoniq's analog output stage has a tube-like warmth
    jitterHz: 0,
    hissFloorDb: -80,
  },
  mellotron_tape: {
    id: 'mellotron_tape',
    label: 'Mellotron',
    bitDepth: 24,            // tape isn't bit-limited, it's mechanically limited
    targetSampleRate: 48000,
    antiAliasHz: 12000,      // tape high-frequency rolloff
    quantStyle: 'muLikeSoft',
    ditherLevel: 0,
    driveCurve: 'tape',
    jitterHz: 0,
    hissFloorDb: -50,        // tape hiss is loud
    wowFlutter: { wowHz: 0.9, wowDepth: 12, flutterHz: 11, flutterDepth: 4 },
  },
  sid_6581: {
    id: 'sid_6581',
    label: 'SID 6581',
    bitDepth: 8,             // real SID D/A resolution per voice
    targetSampleRate: 30800, // approximation of effective step rate (~30.8kHz)
    antiAliasHz: 0,          // no anti-alias filter — SID famously aliases hard
    quantStyle: 'stepped',
    ditherLevel: 0,
    driveCurve: 'hardclip',
    jitterHz: 0,
    hissFloorDb: -55,
  },
  nes_apu: {
    id: 'nes_apu',
    label: 'NES APU',
    bitDepth: 4,              // NES pulse channels are 4-bit volume steps
    targetSampleRate: 111860, // approximation of APU internal update rate
    antiAliasHz: 0,           // no filtering, raw stepped output
    quantStyle: 'stepped',
    ditherLevel: 0,
    driveCurve: 'hardclip',
    jitterHz: 0,
    hissFloorDb: -50,
  },
  kurzweil_k2000: {
    id: 'kurzweil_k2000',
    label: 'K2000 VAST',
    bitDepth: 16,
    targetSampleRate: 44100,
    antiAliasHz: 20000,
    quantStyle: 'linear',
    ditherLevel: 0.15,
    driveCurve: 'hardclip',   // VAST's digital signal processing has a harder digital edge
    jitterHz: 0,
    hissFloorDb: -90,
  },
};

export function getChipProfile(id: string): ChipProfile {
  return CHIP_PROFILES[id] ?? CHIP_PROFILES.none;
}
