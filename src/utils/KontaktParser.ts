import JSZip from 'jszip';
import { KontaktSample } from '../types';
import { XMLParser } from 'fast-xml-parser';

// ════════════════════════════════════════════════════════════════════════
// SIGNAL EXTRACTION – all regex patterns are pre‑compiled once
// ════════════════════════════════════════════════════════════════════════

const PITCH_MAP: Record<string, number> = {
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11
};

const DYNAMIC_VELOCITY_MAP: Record<string, { low: number; high: number; nominal: number }> = {
  ppp: { low: 1, high: 20, nominal: 15 },
  pp:  { low: 21, high: 40, nominal: 30 },
  p:   { low: 41, high: 60, nominal: 50 },
  mp:  { low: 61, high: 75, nominal: 68 },
  mf:  { low: 76, high: 90, nominal: 83 },
  f:   { low: 91, high: 105, nominal: 98 },
  ff:  { low: 106, high: 120, nominal: 113 },
  fff: { low: 121, high: 127, nominal: 125 }
};

export type DrumVoice =
  | 'kick' | 'snare' | 'rimshot' | 'clap'
  | 'hihat_closed' | 'hihat_open' | 'hihat_pedal'
  | 'tom_low' | 'tom_mid' | 'tom_high'
  | 'crash' | 'ride' | 'cowbell' | 'shaker' | 'tambourine' | 'perc_misc';

const GM_NOTE_FOR_VOICE: Record<DrumVoice, number> = {
  kick: 36,
  rimshot: 37,
  snare: 38,
  clap: 39,
  tom_low: 41,
  hihat_closed: 42,
  tom_mid: 43,
  hihat_pedal: 44,
  tom_high: 45,
  hihat_open: 46,
  cowbell: 56,
  crash: 49,
  ride: 51,
  tambourine: 54,
  shaker: 70,
  perc_misc: 63,
};

// All regex patterns are compiled once and reused.
const VOICE_PATTERNS: { voice: DrumVoice; regex: RegExp; weight: number }[] = [
  { voice: 'hihat_open',    regex: /\b(open ?hat|open ?hh|ohh|oh)\b/i, weight: 3 },
  { voice: 'hihat_closed',  regex: /\b(closed ?hat|closed ?hh|chh|ch)\b/i, weight: 3 },
  { voice: 'hihat_pedal',   regex: /\b(pedal ?hat|pedal ?hh|phh|ph)\b/i, weight: 3 },
  { voice: 'hihat_closed',  regex: /\b(hi ?hat|hihat|hh|hats?)\b/i, weight: 1 },
  { voice: 'kick',          regex: /\b(kick ?drum|bass ?drum|sub ?drum|kick|bd|kd)\b/i, weight: 2 },
  { voice: 'snare',         regex: /\b(snare ?drum|snare|sd|sn)\b/i, weight: 2 },
  { voice: 'clap',          regex: /\b(hand ?clap|clap|snap|cp|clp)\b/i, weight: 2 },
  { voice: 'rimshot',       regex: /\b(rim ?shot|side ?stick|rim|stick)\b/i, weight: 2 },
  { voice: 'crash',         regex: /\b(crash ?cymbal|crash)\b/i, weight: 2 },
  { voice: 'ride',          regex: /\b(ride ?cymbal|ride)\b/i, weight: 2 },
  { voice: 'tom_low',       regex: /\b(floor ?tom|low ?tom|lt)\b/i, weight: 3 },
  { voice: 'tom_mid',       regex: /\b(mid ?tom|middle ?tom|mt)\b/i, weight: 3 },
  { voice: 'tom_high',      regex: /\b(hi ?tom|high ?tom|ht)\b/i, weight: 3 },
  { voice: 'tom_mid',       regex: /\b(tom\d?|toms)\b/i, weight: 1 },
  { voice: 'shaker',        regex: /\b(shaker|shake|cabasa|maracas?|guiro)\b/i, weight: 2 },
  { voice: 'cowbell',       regex: /\b(cowbell|cow ?bell|clave|triangle|cb)\b/i, weight: 2 },
  { voice: 'tambourine',    regex: /\b(tambourine|tamb)\b/i, weight: 2 },
  { voice: 'perc_misc',     regex: /\b(bongo|conga|djembe|timbale|perc(ussion)?)\b/i, weight: 1 },
];

// Pre‑compile all individual regex patterns for performance
const PITCH_REGEX = /(?:^|[\s_\-\[]|([a-g]))([a-g])(#|b|s|f|sharp|flat)?(-?\d)(?=$|[\s_\-.\]])/i;
const MIDI_NUMBER_REGEX = /(?:^|[_\-(\s])(?:midi|note|n|key)?[_\-\s]?(\d{2,3})(?:[_\-).\s]|$)/i;
const SEQUENCE_REGEX = /(?:^|[_\-\s])(\d{1,3})(?:[_\-\s.]|$)/;
const DYNAMIC_REGEX = /\b(ppp|pp|p|mp|mf|f|ff|fff)\b/;
const HARD_REGEX = /\b(hard|loud|highvel|hi ?vel|high|hi)\b/i;
const SOFT_REGEX = /\b(soft|quiet|lowvel|lo ?vel|low|lo)\b/i;
const MED_REGEX = /\b(med|mid|norm(al)?)\b/i;
const VEL_NUM_REGEX = /vel(?:ocity)?[_\s]?(\d{1,3})\b|\bv(\d)\b/i;
const RR_REGEX = /\brr[_\s]?(\d+)\b|\b(?:take|var|variation)[_\s]?(\d+)\b/i;
const TRAILING_NUMBER_REGEX = /(\d+)(?:\.(?:wav|mp3|flac|ogg|aif|aiff|m4a))?$/i;
const ARTICULATION_REGEX = /\b(staccato|stac|sustain|sus|pizzicato|pizz|release|rel|attack|mute|legato)\b/i;

const ARTICULATION_MAP: Record<string, string> = {
  staccato: 'staccato', stac: 'staccato',
  sustain: 'sustain', sus: 'sustain',
  pizzicato: 'pizzicato', pizz: 'pizzicato',
  release: 'release', rel: 'release',
  attack: 'attack', mute: 'mute', legato: 'legato',
};

// ════════════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════════════

interface FileSignals {
  path: string;
  filename: string;
  folderTokens: string[];
  drumVoice: DrumVoice | null;
  drumConfidence: number;
  pitchMidi: number | null;
  explicitMidiNumber: number | null;
  sequenceIndex: number | null;
  velocityLow: number;
  velocityHigh: number;
  velocityNominal: number;
  hasExplicitVelocity: boolean;
  roundRobinIdx: number;
  articulation: string;
}

export interface MappedSampleMeta {
  path: string;
  midiNote: number;
  velocityLow: number;
  velocityHigh: number;
  velocity: number;
  articulation: string;
  isDrum: boolean;
  roundRobinIdx: number;
  drumVoice: DrumVoice | null;
  mappingConfidence: number;
  mappingNote: string;
  loopPoints?: {
    start: number;
    end: number;
    enabled: boolean;
  };
}

export interface LibraryClassification {
  mode: 'chromatic' | 'oneshot' | 'hybrid';
  confidence: number;
  drumFileCount: number;
  pitchedFileCount: number;
  totalFiles: number;
  reasoning: string;
}

export interface MappingReport {
  classification: LibraryClassification;
  entries: MappedSampleMeta[];
  fallbackCount: number;  // files placed in fallback zone (low confidence)
  warnings: string[];
}

// ════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════

function tokenizeFolders(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  return parts.map(p => p.toLowerCase().replace(/[_\-]+/g, ' ').trim()).filter(Boolean);
}

function classifyDrumVoice(filename: string, folderTokens: string[]): { voice: DrumVoice | null; confidence: number } {
  const cleanFile = filename.toLowerCase().replace(/[_\-]+/g, ' ');
  const folderJoined = folderTokens.join(' ');

  let best: { voice: DrumVoice; score: number } | null = null;

  for (const pattern of VOICE_PATTERNS) {
    let score = 0;
    if (pattern.regex.test(cleanFile)) score += pattern.weight * 2;
    if (folderJoined && pattern.regex.test(folderJoined)) score += pattern.weight * 1.5;

    if (score > 0 && (!best || score > best.score)) {
      best = { voice: pattern.voice, score };
    }
  }

  if (!best) return { voice: null, confidence: 0 };
  return { voice: best.voice, confidence: best.score };
}

export function parsePitch(cleanName: string, folderTokens: string[] = []): number | null {
  // First try the filename
  let match = cleanName.match(PITCH_REGEX);
  
  // If not found, try folder tokens (sometimes a folder is named "C3")
  if (!match && folderTokens.length > 0) {
    for (const token of folderTokens) {
      match = token.match(PITCH_REGEX);
      if (match) break;
    }
  }

  if (!match) return null;

  const noteLetter = match[2].toLowerCase();
  const accidental = (match[3] || '').toLowerCase();
  const octave = parseInt(match[4], 10);
  if (Number.isNaN(octave) || octave < -2 || octave > 9) return null;

  let base = PITCH_MAP[noteLetter];
  if (accidental === '#' || accidental === 'sharp' || accidental === 's') base += 1;
  else if (accidental === 'b' || accidental === 'flat' || accidental === 'f') base -= 1;

  const midi = (octave + 1) * 12 + base;
  if (midi < 0 || midi > 127) return null;
  return midi;
}

function parseExplicitMidiNumber(cleanName: string): number | null {
  const match = cleanName.match(MIDI_NUMBER_REGEX);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  // MIDI range 0-127, but usually notes 21-108 for instruments.
  // We'll trust it if it's explicitly labeled or in a reasonable instrument range.
  if (num >= 21 && num <= 108) return num;
  // If it's a very low number like 01, it's likely a sequence index, not a MIDI note.
  return null;
}

function parseSequenceIndex(cleanName: string): number | null {
  // Avoid matching if there's a pitch or high midi number
  if (parsePitch(cleanName) !== null || parseExplicitMidiNumber(cleanName) !== null) return null;
  const match = cleanName.match(SEQUENCE_REGEX);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function parseVelocity(cleanName: string): { low: number; high: number; nominal: number; explicit: boolean } {
  // Dynamic markings
  const dynMatch = cleanName.match(DYNAMIC_REGEX);
  if (dynMatch) {
    const range = DYNAMIC_VELOCITY_MAP[dynMatch[1]];
    return { ...range, explicit: true };
  }
  if (HARD_REGEX.test(cleanName)) {
    return { low: 90, high: 127, nominal: 115, explicit: true };
  }
  if (SOFT_REGEX.test(cleanName)) {
    return { low: 0, high: 45, nominal: 30, explicit: true };
  }
  if (MED_REGEX.test(cleanName)) {
    return { low: 46, high: 89, nominal: 75, explicit: true };
  }
  const velNumMatch = cleanName.match(VEL_NUM_REGEX);
  if (velNumMatch) {
    const vStr = velNumMatch[1] || velNumMatch[2];
    const v = parseInt(vStr, 10);
    
    // If it's a single digit like V1, V2, treat as layer index
    if (vStr.length === 1 && v >= 1 && v <= 5) {
      const step = Math.floor(127 / 3); // Assume 3-5 layers
      return { low: Math.max(0, (v - 1) * step), high: Math.min(127, v * step), nominal: v * step, explicit: true };
    }
    
    if (v >= 1 && v <= 127) {
      return { low: Math.max(0, v - 15), high: Math.min(127, v + 15), nominal: v, explicit: true };
    }
  }
  return { low: 0, high: 127, nominal: 80, explicit: false };
}

function parseRoundRobin(cleanName: string): number {
  const rrMatch = cleanName.match(RR_REGEX);
  if (rrMatch) {
    const val = parseInt(rrMatch[1] || rrMatch[2], 10);
    return Math.max(0, val - 1);
  }
  
  // Try trailing number as fallback RR ONLY if it's a small number (1-16)
  // and not preceded by V or Pitch
  const trailingMatch = cleanName.match(/[_\-\s](\d{1,2})$/);
  if (trailingMatch) {
    const n = parseInt(trailingMatch[1], 10);
    if (n >= 1 && n <= 16) return n - 1;
  }
  return 0;
}

function parseArticulation(cleanName: string): string {
  const match = cleanName.match(ARTICULATION_REGEX);
  if (match) {
    const key = match[1].toLowerCase();
    return ARTICULATION_MAP[key] || 'default';
  }
  return 'default';
}

export function extractSignals(path: string): FileSignals {
  const filename = path.split('/').pop() || path;
  const folderTokens = tokenizeFolders(path);
  const cleanName = filename.toLowerCase().replace(/[_\-]+/g, ' ');

  const { voice, confidence } = classifyDrumVoice(filename, folderTokens);
  const pitchMidi = parsePitch(cleanName, folderTokens);
  const explicitMidiNumber = pitchMidi === null ? parseExplicitMidiNumber(cleanName) : null;
  const sequenceIndex = (pitchMidi === null && explicitMidiNumber === null) ? parseSequenceIndex(cleanName) : null;
  const velocity = parseVelocity(cleanName);
  const roundRobinIdx = parseRoundRobin(cleanName);
  const articulation = parseArticulation(cleanName);

  return {
    path,
    filename,
    folderTokens,
    drumVoice: voice,
    drumConfidence: confidence,
    pitchMidi,
    explicitMidiNumber,
    sequenceIndex,
    velocityLow: velocity.low,
    velocityHigh: velocity.high,
    velocityNominal: velocity.nominal,
    hasExplicitVelocity: velocity.explicit,
    roundRobinIdx,
    articulation,
  };
}

// ════════════════════════════════════════════════════════════════════════
// LIBRARY CLASSIFICATION
// ════════════════════════════════════════════════════════════════════════

export function classifyLibrary(signals: FileSignals[], hybridThreshold = 0.15): LibraryClassification {
  const total = signals.length;
  if (total === 0) {
    return { mode: 'chromatic', confidence: 0, drumFileCount: 0, pitchedFileCount: 0, totalFiles: 0, reasoning: 'Empty library' };
  }

  const drumFiles = signals.filter(s => s.drumVoice !== null && s.drumConfidence >= 2);
  const pitchedFiles = signals.filter(s => s.pitchMidi !== null);

  const drumOnlyFiles = drumFiles.filter(f => f.pitchMidi === null);
  const pitchOnlyFiles = pitchedFiles.filter(f => !(f.drumVoice !== null && f.drumConfidence >= 2));
  const ambiguousBoth = signals.filter(s =>
    s.pitchMidi !== null && s.drumVoice !== null && s.drumConfidence >= 2
  );

  const drumOnlyRatio = drumOnlyFiles.length / total;
  const pitchOnlyRatio = pitchOnlyFiles.length / total;

  if (drumOnlyRatio >= hybridThreshold && pitchOnlyRatio >= hybridThreshold) {
    return {
      mode: 'hybrid',
      confidence: Math.min(drumOnlyRatio, pitchOnlyRatio) * 2,
      drumFileCount: drumFiles.length,
      pitchedFileCount: pitchedFiles.length,
      totalFiles: total,
      reasoning: `Hybrid: ${drumOnlyFiles.length} drum-only, ${pitchOnlyFiles.length} pitch-only, ${ambiguousBoth.length} ambiguous → mapped separately.`
    };
  }

  const drumRatio = drumFiles.length / total;
  if (drumRatio > 0.2) {
    return {
      mode: 'oneshot',
      confidence: drumRatio,
      drumFileCount: drumFiles.length,
      pitchedFileCount: pitchedFiles.length,
      totalFiles: total,
      reasoning: `${drumFiles.length}/${total} files matched drum keywords → classified as one‑shot/drum kit.`
    };
  }

  if (pitchOnlyRatio > 0.2) {
    return {
      mode: 'chromatic',
      confidence: pitchOnlyRatio,
      drumFileCount: drumFiles.length,
      pitchedFileCount: pitchedFiles.length,
      totalFiles: total,
      reasoning: `${pitchOnlyFiles.length}/${total} files have explicit pitch → classified as chromatic.`
    };
  }

  return {
    mode: 'oneshot',
    confidence: 0.25,
    drumFileCount: drumFiles.length,
    pitchedFileCount: pitchedFiles.length,
    totalFiles: total,
    reasoning: 'Weak signal both ways → defaulting to one‑shot (safe for unlabeled collections).'
  };
}

// ════════════════════════════════════════════════════════════════════════
// SLOT ASSIGNMENT (Deterministic)
// ════════════════════════════════════════════════════════════════════════

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key) || [];
    bucket.push(item);
    map.set(key, bucket);
  }
  return map;
}

/**
 * Assign drum slots – preserves all velocity layers, and resolves
 * GM note collisions by moving duplicates to a secondary zone (80–95).
 */
export function assignDrumSlots(files: FileSignals[]): MappedSampleMeta[] {
  const results: MappedSampleMeta[] = [];
  const usedNotes = new Set<number>();
  const gmNotesUsed = new Set<number>();

  const recognized = files.filter(f => f.drumVoice !== null && f.drumConfidence >= 2);
  const unrecognized = files.filter(f => !(f.drumVoice !== null && f.drumConfidence >= 2));

  const byVoice = groupBy(recognized, f => f.drumVoice as string);

  for (const [voiceKey, voiceFiles] of byVoice) {
    const voice = voiceKey as DrumVoice;
    let primaryNote = GM_NOTE_FOR_VOICE[voice];

    // Check if this GM note is already taken by a previous voice
    if (gmNotesUsed.has(primaryNote)) {
      // Move to secondary zone (80–95) to avoid overwriting the main kit
      let fallbackNote = 80;
      while (usedNotes.has(fallbackNote) && fallbackNote <= 95) fallbackNote++;
      primaryNote = fallbackNote;
    } else {
      gmNotesUsed.add(primaryNote);
    }

    // Assign all files for this voice to the same note (either primary or fallback)
    // but separate velocity layers and round‑robins.
    const sortedFiles = [...voiceFiles].sort((a, b) => a.path.localeCompare(b.path));

    // Group by round‑robin index (if any) and by velocity layer grouping
    // We want to preserve velocity layers as separate entries with different velocity ranges.
    // So we group by a composite key: roundRobinIdx + velocityRange (low/high).
    // But easier: we assign each file its own velocity range from its signals.
    // That gives the engine the ability to use all layers.
    // We'll also assign round‑robin index from the parsed data.
    let rrCounter = 0;
    for (const f of sortedFiles) {
      const noteToUse = primaryNote;
      // Ensure note is free – if taken, we shift to next free note in a higher range
      let finalNote = noteToUse;
      while (usedNotes.has(finalNote)) {
        finalNote++;
      }
      usedNotes.add(finalNote);

      results.push({
        path: f.path,
        midiNote: finalNote,
        velocityLow: f.velocityLow,
        velocityHigh: f.velocityHigh,
        velocity: f.velocityNominal,
        articulation: f.articulation,
        isDrum: true,
        roundRobinIdx: rrCounter++,
        drumVoice: voice,
        mappingConfidence: f.drumConfidence,
        mappingNote: `Mapped to ${voice} (MIDI ${finalNote}) – velocity range ${f.velocityLow}–${f.velocityHigh}, RR${rrCounter}.`
      });
    }
  }

  // Unrecognized files spread deterministically starting at 80 (above GM range)
  let fallbackNote = 80;
  const sortedUnrecognized = [...unrecognized].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sortedUnrecognized) {
    while (usedNotes.has(fallbackNote) && fallbackNote < 108) fallbackNote++;
    usedNotes.add(fallbackNote);
    results.push({
      path: f.path,
      midiNote: fallbackNote,
      velocityLow: f.velocityLow,
      velocityHigh: f.velocityHigh,
      velocity: f.velocityNominal,
      articulation: f.articulation,
      isDrum: true,
      roundRobinIdx: f.roundRobinIdx,
      drumVoice: null,
      mappingConfidence: 0,
      mappingNote: `Unrecognized – auto‑placed at MIDI ${fallbackNote} (fallback zone).`
    });
    fallbackNote++;
  }

  return results;
}

function assignChromaticSlots(files: FileSignals[]): MappedSampleMeta[] {
  const results: MappedSampleMeta[] = [];
  const usedNotes = new Set<number>();

  interface NoteGroup {
    id: string;
    signals: FileSignals[];
    fixedNote: number | null;
    seqIdx: number | null;
    sortKey: string;
  }

  // Helper to create the meta entry
  const createMeta = (s: FileSignals, note: number, conf: number, noteText: string): MappedSampleMeta => ({
    path: s.path,
    midiNote: note,
    velocityLow: s.velocityLow,
    velocityHigh: s.velocityHigh,
    velocity: s.velocityNominal,
    articulation: s.articulation,
    isDrum: false,
    roundRobinIdx: s.roundRobinIdx,
    drumVoice: null,
    mappingConfidence: conf,
    mappingNote: `${noteText} (note ${note}, velocity ${s.velocityLow}–${s.velocityHigh}).`
  });

  // 1. Cluster files by "Identity" (Pitch, MIDI, Sequence, or Core Name)
  const groups = new Map<string, NoteGroup>();

  for (const f of files) {
    let id = "";
    let fixedNote: number | null = null;
    let seqIdx: number | null = null;

    if (f.pitchMidi !== null) {
      id = `p_${f.pitchMidi}`;
      fixedNote = f.pitchMidi;
    } else if (f.explicitMidiNumber !== null) {
      id = `m_${f.explicitMidiNumber}`;
      fixedNote = f.explicitMidiNumber;
    } else if (f.sequenceIndex !== null) {
      id = `s_${f.sequenceIndex}`;
      seqIdx = f.sequenceIndex;
    } else {
      // Strip variation markers for a clean core ID
      let core = f.filename.toLowerCase().replace(/\.[^/.]+$/, '');
      [DYNAMIC_REGEX, HARD_REGEX, SOFT_REGEX, RR_REGEX].forEach(r => core = core.replace(r, ''));
      core = core.replace(/[_\-\s]v?\d+$/, ''); // Strip trailing layer indices
      id = `c_${core.trim()}`;
    }

    if (!groups.has(id)) {
      groups.set(id, { id, signals: [], fixedNote, seqIdx, sortKey: id });
    }
    groups.get(id)!.signals.push(f);
  }

  const fixed: NoteGroup[] = [];
  const sequenced: NoteGroup[] = [];
  const unknown: NoteGroup[] = [];

  groups.forEach(g => {
    if (g.fixedNote !== null) fixed.push(g);
    else if (g.seqIdx !== null) sequenced.push(g);
    else unknown.push(g);
  });

  // 2. Process Fixed Pitch Groups
  fixed.forEach(g => {
    const note = g.fixedNote as number;
    g.signals.forEach(s => {
      results.push(createMeta(s, note, 4, 'Explicit pitch mapping'));
    });
    usedNotes.add(note);
  });

  // 3. Process Sequenced Groups (01, 02...)
  if (sequenced.length > 0) {
    sequenced.sort((a, b) => (a.seqIdx ?? 0) - (b.seqIdx ?? 0));
    
    let baseNote = 36; // C2 default
    const firstSeq = sequenced[0].seqIdx ?? 0;
    if (fixed.length > 0) {
      const minFixed = Math.min(...fixed.map(g => g.fixedNote as number));
      baseNote = Math.max(21, minFixed - (firstSeq === 0 ? 0 : firstSeq));
    }

    sequenced.forEach(g => {
      const currentSeq = g.seqIdx ?? 0;
      const offset = firstSeq === 0 ? currentSeq : currentSeq - 1;
      const note = Math.max(0, Math.min(127, baseNote + offset));
      g.signals.forEach(s => {
        results.push(createMeta(s, note, 2, `Sequence index ${g.seqIdx}`));
      });
      usedNotes.add(note);
    });
  }

  // 4. Process Unknown Groups (Name-based chromatic spread)
  if (unknown.length > 0) {
    unknown.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    let fallbackNote = 48; // C3
    unknown.forEach(g => {
      while (usedNotes.has(fallbackNote) && fallbackNote < 120) fallbackNote++;
      g.signals.forEach(s => {
        results.push(createMeta(s, fallbackNote, 1, 'Alphabetical spread'));
      });
      usedNotes.add(fallbackNote);
      fallbackNote++;
    });
  }

  return results;
}

// ════════════════════════════════════════════════════════════════════════
// AUDIO DECODING QUEUE & CONSTANTS
// ════════════════════════════════════════════════════════════════════════

class AudioDecodingQueue {
  private static activeCount = 0;
  private static maxConcurrency = 4;
  private static queue: (() => void)[] = [];

  public static async enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.activeCount++;
    try {
      return await task();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

// Binary Magic Number Constants
const SF2_HEADER_RIFF = 0x52494646; // 'RIFF'
const SF2_HEADER_WAVE = 0x57415645; // 'WAVE'
const SF2_HEADER_SFBK = 0x7366626b; // 'sfbk'
const SF2_HEADER_LIST = 0x4c495354; // 'LIST'
const SF2_HEADER_SMPL = 0x736d706c; // 'smpl'
const SF2_HEADER_SHDR = 0x73686472; // 'shdr'
const SF2_HEADER_IGEN = 0x6967656e; // 'igen'
const SF2_HEADER_IBAG = 0x69626167; // 'ibag'
const SF2_SHDR_RECORD_SIZE = 46;
const SF2_IBAG_RECORD_SIZE = 4;
const SF2_IGEN_RECORD_SIZE = 4;

const AKP_MIN_BYTE_LENGTH = 0x40;
const AKP_KG_COUNT_OFFSET = 0x24;
const AKP_KG_START_OFFSET = 0x64;
const AKP_KG_SIZE = 208;
const AKP_ZONE_SIZE = 40;
const AKP_ZONE_SNAME_LEN = 12;

export interface RetroParserStrategy {
  canHandle(ext: string): boolean;
  parse(
    descriptorEntry: { path: string; file: JSZip.JSZipObject | File },
    files: { path: string; file: JSZip.JSZipObject | File }[],
    audioCtx: AudioContext,
    onProgress: (ratio: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<{ name: string; samples: KontaktSample[]; mappingMode: 'chromatic' | 'oneshot' | 'hybrid'; report: MappingReport } | null>;
}

// ════════════════════════════════════════════════════════════════════════
// PUBLIC API – KONTAKTPARSER
// ════════════════════════════════════════════════════════════════════════

export class KontaktParser {
  private static signalCache = new Map<string, FileSignals>();
  private static MAX_CACHE_SIZE = 5000;

  /**
   * Safe XML parser method to consolidate duplicated logic.
   */
  private static parseXml<T = any>(xmlText: string): T | null {
    if (!xmlText || !XMLParser) return null;
    try {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
      return parser.parse(xmlText) as T;
    } catch (e) {
      console.warn('Failed to parse XML text:', e);
      return null;
    }
  }

  /**
   * Decodes audio data safely with WAV header validation and concurrency queueing.
   */
  public static async safeDecodeAudioData(
    audioCtx: AudioContext,
    buffer: ArrayBuffer,
    filename?: string
  ): Promise<AudioBuffer> {
    const isWavFile = filename ? /\.wav$/i.test(filename) : true;
    if (isWavFile || buffer.byteLength >= 12) {
      if (buffer.byteLength >= 12) {
        const view = new DataView(buffer);
        const riff = view.getUint32(0, false);
        const wave = view.getUint32(8, false);
        const isRiffWave = riff === 0x52494646 && wave === 0x57415645;
        if (filename && /\.wav$/i.test(filename) && !isRiffWave) {
          throw new Error(`Invalid WAV header for file: ${filename}`);
        }
      } else if (filename && /\.wav$/i.test(filename)) {
        throw new Error(`File is too small to be a valid WAV: ${filename}`);
      }
    }

    return AudioDecodingQueue.enqueue(() => audioCtx.decodeAudioData(buffer));
  }

  /**
   * Clear internal signal cache (useful when loading many different libraries).
   */
  public static clearCache() {
    this.signalCache.clear();
  }

  /**
   * Analyzes a full set of file paths (with folder structure preserved) and
   * produces a deterministic mapping report.
   */
  public static analyzeLibrary(paths: string[], hybridThreshold = 0.15): MappingReport {
    // Filter out paths that are likely examples, demos, or documentation
    const IGNORE_PATTERNS = [
      /\bdemo\b/i,
      /\bexample\b/i,
      /\bdoc(umentation)?\b/i,
      /\bpreview\b/i,
      /\btutorial\b/i,
      /\b_ignore\b/i,
      /\bir\b/i, // Impulse Responses
      /\bnoise\b/i,
      /\bmanual\b/i,
      /\breadme\b/i,
      /\bextras?\b/i,
      /\bpresets?\b/i, // Often presets are small metadata audio files or alternative small patches
      /\bold\b/i,
      /\bbackup\b/i
    ];

    const filteredPaths = paths.filter(path => {
      const lowerPath = path.toLowerCase();
      // If the path contains any ignore pattern
      const shouldIgnore = IGNORE_PATTERNS.some(p => p.test(path));
      
      if (shouldIgnore) {
        // High-confidence sample folder names override the ignore pattern 
        // ONLY if the ignore pattern isn't the final folder name.
        // e.g. "Samples/Piano/Demo/Sample.wav" -> Ignore
        // e.g. "Library/Demo Samples/Note.wav" -> Keep (maybe)
        
        const hasSampleKeyword = /\b(samples|audio|pool|data|wavs)\b/i.test(path);
        const fileName = path.split('/').pop()?.toLowerCase() || '';
        
        // If the filename itself contains "demo" or "preview", definitely ignore
        if (/\b(demo|preview|example)\b/i.test(fileName)) return false;

        // If it's in a folder called "Samples" but the parent is "Demos", we still might want to ignore it.
        // We'll trust the ignore pattern unless it's a very clear sample pool.
        if (hasSampleKeyword && lowerPath.includes('/samples/')) return true;
        
        return false;
      }
      return true;
    });

    // If we filtered out EVERYTHING, fall back to the original list (better some files than none)
    const finalPaths = filteredPaths.length > 0 ? filteredPaths : paths;

    const signals = finalPaths.map(path => {
      if (this.signalCache.has(path)) {
        // LRU Eviction behavior: delete and re-insert to move it to the end (most recently used)
        const val = this.signalCache.get(path)!;
        this.signalCache.delete(path);
        this.signalCache.set(path, val);
        return val;
      }
      
      if (this.signalCache.size >= KontaktParser.MAX_CACHE_SIZE) {
        // Remove the oldest element (first key in Map)
        const firstKey = this.signalCache.keys().next().value;
        if (firstKey) this.signalCache.delete(firstKey);
      }
      
      const parsed = extractSignals(path);
      this.signalCache.set(path, parsed);
      return parsed;
    });

    const classification = classifyLibrary(signals, hybridThreshold);

    let entries: MappedSampleMeta[];
    const warnings: string[] = [];

    if (classification.mode === 'oneshot') {
      entries = assignDrumSlots(signals);
    } else if (classification.mode === 'chromatic') {
      entries = assignChromaticSlots(signals);
    } else {
      // Hybrid: split by stronger signal per file
      const drumLike = signals.filter(s => s.drumVoice !== null && s.drumConfidence >= 2);
      const pitchLike = signals.filter(s => !(s.drumVoice !== null && s.drumConfidence >= 2));
      entries = [...assignDrumSlots(drumLike), ...assignChromaticSlots(pitchLike)];
      warnings.push('Hybrid library: drum and pitched files mapped separately.');
    }

    const fallbackCount = entries.filter(e => e.mappingConfidence === 0).length;
    if (fallbackCount > 0) {
      warnings.push(`${fallbackCount} file(s) placed in fallback zone (low confidence).`);
    }

    return { classification, entries, fallbackCount, warnings };
  }

  /**
   * Legacy single-file parse – uses the same signal extraction.
   */
  public static parseFilename(filename: string): Omit<KontaktSample, 'id' | 'buffer'> {
    const signals = extractSignals(filename);
    const isDrum = signals.drumVoice !== null && signals.drumConfidence >= 2;
    const midiNote = isDrum
      ? GM_NOTE_FOR_VOICE[signals.drumVoice as DrumVoice]
      : (signals.pitchMidi ?? signals.explicitMidiNumber ?? 60);

    return {
      name: filename,
      midiNote,
      velocityLow: signals.velocityLow,
      velocityHigh: signals.velocityHigh,
      velocity: signals.velocityNominal,
      articulation: signals.articulation,
      isDrum,
      roundRobinIdx: signals.roundRobinIdx
    };
  }

  /**
   * Legacy mapping mode detection.
   */
  public static detectMappingMode(samples: KontaktSample[]): 'chromatic' | 'oneshot' {
    const signals = samples.map(s => extractSignals(s.name));
    const classification = classifyLibrary(signals);
    return classification.mode === 'hybrid' ? 'oneshot' : classification.mode;
  }

  /**
   * Legacy zone mapper – uses the new deterministic assignment.
   */
  public static mapSeamlessMidiZones(
    samples: KontaktSample[],
    mappingMode: 'chromatic' | 'oneshot' = 'chromatic'
  ): KontaktSample[] {
    if (samples.length === 0) return [];

    const byPath = new Map(samples.map(s => [s.name, s]));
    const signals = samples.map(s => extractSignals(s.name));

    const entries = mappingMode === 'oneshot'
      ? assignDrumSlots(signals)
      : assignChromaticSlots(signals);

    return entries.map(entry => {
      const original = byPath.get(entry.path)!;
      return {
        ...original,
        midiNote: entry.midiNote,
        velocityLow: entry.velocityLow,
        velocityHigh: entry.velocityHigh,
        velocity: entry.velocity,
        articulation: entry.articulation,
        isDrum: entry.isDrum,
        roundRobinIdx: entry.roundRobinIdx,
      };
    });
  }

  /**
   * Checks if the given file is a ZIP archive (by magic bytes).
   */
  private static async isZipFile(file: File): Promise<boolean> {
    const header = await file.slice(0, 4).arrayBuffer();
    const view = new Uint8Array(header);
    return view[0] === 0x50 && view[1] === 0x4B && view[2] === 0x03 && view[3] === 0x04;
  }

  /**
   * Extracts embedded WAV files from a binary monolith.
   */
  private static extractWavsFromBinary(buffer: ArrayBuffer): ArrayBuffer[] {
    const wavs: ArrayBuffer[] = [];
    const view = new DataView(buffer);
    const length = buffer.byteLength;

    for (let i = 0; i < length - 12; i++) {
      // Look for "RIFF" (0x52494646)
      if (view.getUint32(i, false) === 0x52494646) {
        // Look for "WAVE" (0x57415645) at offset + 8
        if (view.getUint32(i + 8, false) === 0x57415645) {
          // Found a WAV file. The size is at offset + 4 (little endian)
          const size = view.getUint32(i + 4, true);
          // Total RIFF size is size + 8
          if (size > 0 && size < 100000000 && i + 8 + size <= length) {
            const wavBuffer = buffer.slice(i, i + 8 + size);
            wavs.push(wavBuffer);
            i += 7 + size; // skip past this WAV
          }
        }
      }
    }
    return wavs;
  }


  /**
   * Extracts XML string from binary monolith if present.
   */
  private static extractXmlFromBinary(buffer: ArrayBuffer): string | null {
    const view = new Uint8Array(buffer);
    const xmlStartPatterns = [
      [0x3C, 0x3F, 0x78, 0x6D, 0x6C], // <?xml
      [0x3C, 0x49, 0x6E, 0x73, 0x74, 0x72], // <Instr
      [0x3C, 0x69, 0x6E, 0x73, 0x74, 0x72]  // <instr
    ];

    let startIdx = -1;
    for (let i = 0; i < view.length - 20; i++) {
      for (const pattern of xmlStartPatterns) {
        let match = true;
        for (let j = 0; j < pattern.length; j++) {
          if (view[i + j] !== pattern[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          startIdx = i;
          break;
        }
      }
      if (startIdx !== -1) break;
    }

    if (startIdx !== -1) {
      let endIdx = -1;
      const endTags = [
        [0x3C, 0x2F, 0x49, 0x6E, 0x73, 0x74, 0x72, 0x75, 0x6D, 0x65, 0x6E, 0x74, 0x3E], // </Instrument>
        [0x3C, 0x2F, 0x69, 0x6E, 0x73, 0x74, 0x72, 0x75, 0x6D, 0x65, 0x6E, 0x74, 0x3E]  // </instrument>
      ];

      for (let i = startIdx; i < view.length - 20; i++) {
        for (const endTag of endTags) {
          if (i + endTag.length > view.length) continue;
          let match = true;
          for (let j = 0; j < endTag.length; j++) {
            if (view[i + j] !== endTag[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            endIdx = i + endTag.length;
            break;
          }
        }
        if (endIdx !== -1) break;
      }

      if (endIdx === -1) {
        for (let i = startIdx; i < Math.min(view.length, startIdx + 1000000); i++) {
          if (view[i] === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx !== -1) {
        const xmlBuffer = view.slice(startIdx, endIdx);
        return new TextDecoder().decode(xmlBuffer);
      }
    }
    return null;
  }

  /**
   * Parses an NKI/NINCT file – tries to read XML mapping if available,
   * or attempts to extract embedded monolithic WAV files if it's not a ZIP.
   */
  public static async parseNkiFile(
    file: File,
    audioCtx: AudioContext,
    onProgress?: (ratio: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<{ name: string; samples: KontaktSample[]; mappingMode: 'chromatic' | 'oneshot' | 'hybrid'; report: MappingReport }> {
    const isZip = await this.isZipFile(file);
    const libraryName = file.name.replace(/\.(nki|ninct|nkc|nkx)$/i, '');

    if (!isZip) {
      if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');
      // Try to extract embedded WAVs from a binary monolithic NKI/NKX
      onProgress?.(10, `Scanning monolithic ${file.name.split('.').pop()?.toUpperCase()} for embedded audio...`);
      const buffer = await file.arrayBuffer();
      const extractedWavs = this.extractWavsFromBinary(buffer);
      
      if (extractedWavs.length === 0) {
        onProgress?.(40, 'Scanning monolithic NKI for XML mapping data...');
        const instrumentXml = this.extractXmlFromBinary(buffer);
        if (instrumentXml) {
          try {
            const xmlObj = this.parseXml(instrumentXml);
            if (xmlObj) {
              const mappingEntries: MappedSampleMeta[] = [];
              
              // Recursive collector for sample mapping data
              const collectMapping = (obj: any) => {
                if (!obj || typeof obj !== 'object') return;
                
                // Search for sample/zone tags in multiple variants
                const samples = obj.Sample || obj.Zone || obj.sample || obj.zone || obj.Entry || obj.Item || obj.entry || obj.item;
                if (samples) {
                  const arr = Array.isArray(samples) ? samples : [samples];
                  for (const s of arr) {
                    // Broad extraction of mapping parameters
                    const root = parseInt(s.RootKey || s['@_rootkey'] || s.Root || s.key || s.root || s.NativeRoot || '60', 10);
                    const vL = parseInt(s.VelLow || s['@_vel_low'] || s.LowV || s.vel_low || s.min_vel || '0', 10);
                    const vH = parseInt(s.VelHigh || s['@_vel_high'] || s.HighV || s.vel_high || s.max_vel || '127', 10);
                    const filePath = s.File || s['@_file'] || s.FileName || s.file || s.path || s['@_path'] || '';
                    
                    if (filePath || !isNaN(root)) {
                      mappingEntries.push({
                        path: filePath,
                        midiNote: isNaN(root) ? 60 : root,
                        velocityLow: isNaN(vL) ? 0 : vL,
                        velocityHigh: isNaN(vH) ? 127 : vH,
                        velocity: 100,
                        articulation: 'default',
                        isDrum: false,
                        roundRobinIdx: 0,
                        drumVoice: null,
                        mappingConfidence: 5,
                        mappingNote: 'NKI metadata scan'
                      });
                    }
                  }
                }
                
                for (const key in obj) {
                  if (obj[key] && typeof obj[key] === 'object' && key !== 'mappingEntries') {
                    collectMapping(obj[key]);
                  }
                }
              };
              
              collectMapping(xmlObj);

              if (mappingEntries.length > 0) {
                return {
                  name: libraryName,
                  samples: [],
                  mappingMode: 'chromatic',
                  report: {
                    classification: { mode: 'chromatic', confidence: 1, drumFileCount: 0, pitchedFileCount: mappingEntries.length, totalFiles: mappingEntries.length, reasoning: 'Patch-only NKI detected' },
                    entries: mappingEntries,
                    fallbackCount: 0,
                    warnings: ['This NKI is a patch-only file. Audio must be provided externally.']
                  }
                };
              }
            }
          } catch (e) {
            console.warn('Failed to parse patch XML:', e);
          }
        }
        throw new Error(`The file "${file.name}" contains no audio and no valid mapping. Try loading the audio folder directly if the ${file.name.split('.').pop()?.toUpperCase()} is encrypted or uses an external sample container.`);
      }

      onProgress?.(40, `Scanning monolithic ${file.name.split('.').pop()?.toUpperCase()} for XML mapping data...`);
      const instrumentXml = this.extractXmlFromBinary(buffer);
      
      let xmlNoteMap = new Map<string, { root: number; velLow: number; velHigh: number }>();
      const xmlList: { root: number; velLow: number; velHigh: number }[] = [];

      if (instrumentXml) {
        try {
          const xmlObj = this.parseXml(instrumentXml);
          const samples = xmlObj?.Instrument?.Groups?.Group?.Samples?.Sample || xmlObj?.Instrument?.Samples?.Sample;
          if (samples) {
            const sampleArray = Array.isArray(samples) ? samples : [samples];
            for (const s of sampleArray) {
              const fileStr = s.File || s['@_file'] || '';
              const rootKey = s.RootKey || s['@_rootkey'];
              const velLow = s.VelLow || s['@_vel_low'] || 0;
              const velHigh = s.VelHigh || s['@_vel_high'] || 127;
              if (rootKey !== undefined) {
                const root = parseInt(rootKey, 10);
                if (!isNaN(root)) {
                  const meta = { root, velLow: parseInt(velLow, 10) || 0, velHigh: parseInt(velHigh, 10) || 127 };
                  xmlList.push(meta);
                  if (fileStr) xmlNoteMap.set(fileStr, meta);
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to parse embedded XML mapping:', e);
        }
      }

      onProgress?.(50, `Found ${extractedWavs.length} embedded samples. Decoding...`);
      
      const samples: KontaktSample[] = [];
      for (let i = 0; i < extractedWavs.length; i++) {
        if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');
        try {
          const audioBuffer = await this.safeDecodeAudioData(audioCtx, extractedWavs[i], `sample_${i + 1}.wav`);
          
          // Match extracted WAV to XML if available (assume sequential order if names missing)
          let xmlMeta = xmlList[i];
          let root = xmlMeta ? xmlMeta.root : (60 + (i % 24));
          let vL = xmlMeta ? xmlMeta.velLow : 0;
          let vH = xmlMeta ? xmlMeta.velHigh : 127;

          samples.push({
            id: `sample_${Math.random().toString(36).substring(7)}`,
            name: `${libraryName}_Sample_${i + 1}`,
            buffer: audioBuffer,
            midiNote: root,
            velocityLow: vL,
            velocityHigh: vH,
            velocity: (vL + vH) / 2,
            articulation: 'default',
            isDrum: false,
            roundRobinIdx: 0
          });
        } catch (e) {
          console.warn(`Failed to decode embedded sample ${i}:`, e);
        }
      }

      if (samples.length === 0) {
        throw new Error(`Failed to decode embedded audio from "${file.name}". All samples failed to decode or file is corrupt.`);
      }

      const report: MappingReport = {
        classification: { mode: 'chromatic', confidence: 1, drumFileCount: 0, pitchedFileCount: samples.length, totalFiles: samples.length, reasoning: 'Monolithic NKI parsing' },
        entries: [],
        fallbackCount: instrumentXml ? 0 : samples.length,
        warnings: instrumentXml ? [] : ['No XML mapping found in monolith; placed sequentially.']
      };

      onProgress?.(100, 'Mapping completed!');
      return {
        name: libraryName,
        samples,
        mappingMode: 'chromatic',
        report
      };
    }

    // --- Handling ZIP-based NKIs ---
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (e: any) {
      throw new Error(`Failed to read "${file.name}" as a ZIP archive: ${e.message}`);
    }

    if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');

    // 1. Look for instrument XML
    let instrumentXml: string | null = null;
    const xmlCandidates: string[] = [];
    zip.forEach((path, entry) => {
      if (path.match(/\.(nki|nki\.xml|instrument\.xml)$/i)) {
        xmlCandidates.push(path);
      }
    });
    if (xmlCandidates.length > 0) {
      xmlCandidates.sort((a, b) => a.length - b.length);
      const xmlEntry = zip.file(xmlCandidates[0]);
      if (xmlEntry) {
        instrumentXml = await xmlEntry.async('string');
      }
    }

    if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');

    // 2. Collect audio files
    const fileEntries: { path: string; file: JSZip.JSZipObject }[] = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && /\.(wav|aif|aiff|flac|ogg|mp3)$/i.test(path)) {
        fileEntries.push({ path, file: entry });
      }
    });

    if (fileEntries.length === 0) {
      throw new Error('No audio files found in the NKI/NINCT archive.');
    }

    // 3. Try to parse XML mapping
    let xmlNoteMap = new Map<string, { root: number; velLow: number; velHigh: number }>();
    if (instrumentXml) {
      try {
        const xmlObj = this.parseXml(instrumentXml);
        const samples = xmlObj?.Instrument?.Groups?.Group?.Samples?.Sample;
        if (samples) {
          const sampleArray = Array.isArray(samples) ? samples : [samples];
          for (const s of sampleArray) {
            const file = s.File || s['@_file'];
            const rootKey = s.RootKey || s['@_rootkey'];
            const velLow = s.VelLow || s['@_vel_low'] || 0;
            const velHigh = s.VelHigh || s['@_vel_high'] || 127;
            if (file && rootKey !== undefined) {
              const root = parseInt(rootKey, 10);
              if (!isNaN(root)) {
                xmlNoteMap.set(file, { root, velLow: parseInt(velLow, 10) || 0, velHigh: parseInt(velHigh, 10) || 127 });
              }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to parse XML mapping:', e);
      }
    }

    if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');

    // 4. Build mapping report based on paths
    const report = this.analyzeLibrary(fileEntries.map(e => e.path));
    const metaByPath = new Map(report.entries.map(e => [e.path, e]));

    // 5. Decode samples and apply mapping (XML overrides)
    const samples: KontaktSample[] = [];
    const totalFiles = fileEntries.length;

    for (let i = 0; i < totalFiles; i++) {
      if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');
      const entry = fileEntries[i];
      const filename = entry.path.split('/').pop() || entry.path;
      onProgress?.((i / totalFiles) * 100, filename);

      try {
        const arrayBuffer = await entry.file.async('arraybuffer');
        const buffer = await this.safeDecodeAudioData(audioCtx, arrayBuffer, filename);
        let meta = metaByPath.get(entry.path);

        // If XML has mapping for this file, override
        const xmlMeta = xmlNoteMap.get(filename);
        if (xmlMeta) {
          // Create a new meta with XML values
          meta = {
            path: entry.path,
            midiNote: xmlMeta.root,
            velocityLow: xmlMeta.velLow,
            velocityHigh: xmlMeta.velHigh,
            velocity: (xmlMeta.velLow + xmlMeta.velHigh) / 2,
            articulation: meta?.articulation || 'default',
            isDrum: false, // override as needed
            roundRobinIdx: meta?.roundRobinIdx || 0,
            drumVoice: null,
            mappingConfidence: 5,
            mappingNote: `XML mapping: root ${xmlMeta.root}, vel ${xmlMeta.velLow}–${xmlMeta.velHigh}.`
          };
        }

        if (!meta) {
          console.warn(`No mapping metadata for "${entry.path}" — skipping.`);
          continue;
        }

        samples.push({
          id: `sample_${Math.random().toString(36).substring(7)}`,
          name: filename,
          buffer,
          midiNote: meta.midiNote,
          velocityLow: meta.velocityLow,
          velocityHigh: meta.velocityHigh,
          velocity: meta.velocity,
          articulation: meta.articulation,
          size: arrayBuffer.byteLength,
          isDrum: meta.isDrum,
          roundRobinIdx: meta.roundRobinIdx
        });
      } catch (err) {
        console.warn(`Failed to decode "${entry.path}":`, err);
      }
    }

    if (samples.length === 0) {
      throw new Error(`Failed to decode any audio samples from NKI ZIP. All ${totalFiles} samples failed to decode or are corrupt.`);
    }

    onProgress?.(100, 'Mapping complete.');

    return {
      name: libraryName,
      samples,
      mappingMode: report.classification.mode,
      report
    };
  }

  /**
   * Matches external audio files to a library's mapping report.
   * Useful for patch NKIs where audio is provided as sibling files.
   */
  public static async matchExternalSamples(
    report: MappingReport,
    files: File[],
    audioCtx: AudioContext,
    onProgress?: (ratio: number, currentFile: string) => void
  ): Promise<KontaktSample[]> {
    const samples: KontaktSample[] = [];
    if (!report.entries || report.entries.length === 0) return samples;

    const fileMap = new Map<string, File>();
    for (const f of files) {
      if (/\.(wav|mp3|flac|ogg|aif|aiff|m4a)$/i.test(f.name)) {
        fileMap.set(f.name.toLowerCase(), f);
      }
    }

    for (let i = 0; i < report.entries.length; i++) {
      const entry = report.entries[i];
      const fileName = entry.path.split(/[\\/]/).pop()?.toLowerCase() || '';
      const matchingFile = fileMap.get(fileName);

      if (matchingFile) {
        onProgress?.((i / report.entries.length) * 100, `Matching ${matchingFile.name}`);
        try {
          const buffer = await matchingFile.arrayBuffer();
          const audioBuffer = await audioCtx.decodeAudioData(buffer);
          samples.push({
            id: `sample_${Math.random().toString(36).substring(7)}`,
            name: matchingFile.name.replace(/\.[^/.]+$/, ''),
            buffer: audioBuffer,
            midiNote: entry.midiNote,
            velocityLow: entry.velocityLow,
            velocityHigh: entry.velocityHigh,
            velocity: (entry.velocityLow + entry.velocityHigh) / 2,
            articulation: 'default',
            isDrum: false,
            roundRobinIdx: 0
          });
        } catch (e) {
          console.warn(`Failed to decode external sample ${matchingFile.name}:`, e);
        }
      }
    }

    return samples;
  }

  /**
   * Unzips a ZIP‑based library with full deterministic analysis.
   */
  public static async unzipLibrary(
    zipFile: File,
    audioCtx: AudioContext,
    onProgress: (ratio: number, currentFile: string) => void
  ): Promise<{ name: string; samples: KontaktSample[]; mappingMode: 'chromatic' | 'oneshot' | 'hybrid'; report: MappingReport }> {
    const isZip = await this.isZipFile(zipFile);
    if (!isZip) {
      throw new Error(`The file "${zipFile.name}" does not appear to be a valid ZIP archive.`);
    }

    let zip;
    try {
      zip = await JSZip.loadAsync(zipFile);
    } catch (e: any) {
      throw new Error(`Failed to read "${zipFile.name}" as a ZIP archive: ${e.message}`);
    }
    const libraryName = zipFile.name.replace(/\.zip$/i, '').replace(/_|-/g, ' ');

    // NEW: Intercept retro keymap descriptors (SFZ, AKP, SF2, etc.) inside ZIP files
    const allZipEntries: { path: string; file: JSZip.JSZipObject }[] = [];
    zip.forEach((path, entry) => {
      allZipEntries.push({ path, file: entry });
    });

    const retroResult = await this.parseRetroInstrument(allZipEntries, audioCtx, onProgress);
    if (retroResult) {
      return retroResult; // Bypasses regular scanner and returns fully mapped retro synth instrument!
    }

    const fileEntries: { path: string; file: JSZip.JSZipObject }[] = [];
    zip.forEach((path, file) => {
      if (!file.dir && /\.(wav|mp3|flac|ogg|aif|aiff|m4a|snd)$/i.test(path)) {
        fileEntries.push({ path, file });
      }
    });

    if (fileEntries.length === 0) {
      throw new Error('No audio files found in the uploaded ZIP file.');
    }

    const report = this.analyzeLibrary(fileEntries.map(e => e.path));
    const metaByPath = new Map(report.entries.map(e => [e.path, e]));

    const samples: KontaktSample[] = [];
    const totalFiles = fileEntries.length;

    for (let i = 0; i < totalFiles; i++) {
      const entry = fileEntries[i];
      const filename = entry.path.split('/').pop() || entry.path;

      onProgress((i / totalFiles) * 100, filename);

      try {
        const arrayBuffer = await entry.file.async('arraybuffer');
        const buffer = await audioCtx.decodeAudioData(arrayBuffer);
        const meta = metaByPath.get(entry.path);

        if (!meta) {
          console.warn(`No mapping metadata for "${entry.path}" — skipping.`);
          continue;
        }

        samples.push({
          id: `sample_${Math.random().toString(36).substring(7)}`,
          name: filename,
          buffer,
          midiNote: meta.midiNote,
          velocityLow: meta.velocityLow,
          velocityHigh: meta.velocityHigh,
          velocity: meta.velocity,
          articulation: meta.articulation,
          size: arrayBuffer.byteLength,
          isDrum: meta.isDrum,
          roundRobinIdx: meta.roundRobinIdx
        });
      } catch (err) {
        console.warn(`Failed to decode file "${entry.path}":`, err);
      }
    }

    onProgress(100, 'Mapping completed!');

    return {
      name: libraryName,
      samples,
      mappingMode: report.classification.mode,
      report
    };
  }

  /**
   * Translates note names (e.g., C4, F#2, G-1) to MIDI pitch numbers.
   */
  public static parseNoteNameToMidi(val: string): number {
    if (!isNaN(parseInt(val, 10))) {
      return parseInt(val, 10);
    }
    const noteMap: Record<string, number> = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 };
    const match = val.toLowerCase().match(/^([a-g]#?)(-?\d+)$/);
    if (match) {
      const note = noteMap[match[1]];
      const octave = parseInt(match[2], 10);
      return (octave + 1) * 12 + note;
    }
    return 60;
  }

  /**
   * Sub-parser to scan SFZ attributes from a single line.
   */
  private static parseSfzAttributes(line: string, meta: Partial<MappedSampleMeta>) {
    const regex = /(\b\w+)\s*=\s*("[^"]+"|[^\s]+)/g;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const key = match[1].toLowerCase();
      const value = match[2].replace(/"/g, ''); // remove enclosing quotes
      
      if (key === 'sample') {
        meta.path = value;
      } else if (key === 'key') {
        meta.midiNote = this.parseNoteNameToMidi(value);
      } else if (key === 'lokey') {
        meta.midiNote = this.parseNoteNameToMidi(value); // lokey anchors the zone root
      } else if (key === 'pitch_keycenter') {
        meta.midiNote = this.parseNoteNameToMidi(value);
      } else if (key === 'lovel') {
        meta.velocityLow = parseInt(value, 10);
      } else if (key === 'hivel') {
        meta.velocityHigh = parseInt(value, 10);
      } else if (key === 'trigger') {
        if (value === 'release') {
          meta.articulation = 'release';
        }
      }
    }
  }

  /**
   * SFZ Text parser – processes `<group>` and `<region>` elements.
   */
  public static parseSfzText(text: string): MappedSampleMeta[] {
    const entries: MappedSampleMeta[] = [];
    const lines = text.split(/\r?\n/);
    let currentGroupMeta: Partial<MappedSampleMeta> = {};
    
    for (let line of lines) {
      line = line.replace(/\/\/.*$/, '').trim(); // strip comments
      if (!line) continue;
      
      if (line.toLowerCase().startsWith('<group>')) {
        currentGroupMeta = {};
        this.parseSfzAttributes(line, currentGroupMeta);
      } else if (line.toLowerCase().startsWith('<region>')) {
        const regionMeta: Partial<MappedSampleMeta> = { ...currentGroupMeta };
        this.parseSfzAttributes(line, regionMeta);
        
        const path = regionMeta.path || '';
        if (path) {
          entries.push({
            path,
            midiNote: regionMeta.midiNote ?? 60,
            velocityLow: regionMeta.velocityLow ?? 0,
            velocityHigh: regionMeta.velocityHigh ?? 127,
            velocity: regionMeta.velocity ?? 100,
            articulation: regionMeta.articulation || 'default',
            isDrum: regionMeta.isDrum || false,
            roundRobinIdx: regionMeta.roundRobinIdx || 0,
            drumVoice: null,
            mappingConfidence: 5,
            mappingNote: 'SFZ Parsed Region'
          });
        }
      } else {
        // Line-based group/region attributes
        this.parseSfzAttributes(line, currentGroupMeta);
      }
    }
    return entries;
  }

  /**
   * Heuristic scanner for legacy binary sampler descriptors (AKP, SF2, SVD, KRZ, KMP, EFE).
   * Extracts mapped sample name strings and correlates key ranges from surrounding headers.
   */
  /**
   * Simple binary RIFF reader for SoundFont 2 (SF2) decoding.
   */
  public static parseSf2(buffer: ArrayBuffer, audioCtx: AudioContext, signal?: AbortSignal): Promise<KontaktSample[]> {
    return new Promise((resolve) => {
      try {
        const view = new DataView(buffer);
        let offset = 0;

        const readFourCC = (): string => {
          if (offset + 4 > buffer.byteLength) return '';
          let res = '';
          for (let i = 0; i < 4; i++) {
            res += String.fromCharCode(view.getUint8(offset++));
          }
          return res;
        };

        const readUint32 = (): number => {
          if (offset + 4 > buffer.byteLength) return 0;
          const val = view.getUint32(offset, true);
          offset += 4;
          return val;
        };

        const readUint16 = (): number => {
          if (offset + 2 > buffer.byteLength) return 0;
          const val = view.getUint16(offset, true);
          offset += 2;
          return val;
        };

        const readInt16 = (): number => {
          if (offset + 2 > buffer.byteLength) return 0;
          const val = view.getInt16(offset, true);
          offset += 2;
          return val;
        };

        const readUint8 = (): number => {
          if (offset + 1 > buffer.byteLength) return 0;
          return view.getUint8(offset++);
        };

        const readInt8 = (): number => {
          if (offset + 1 > buffer.byteLength) return 0;
          return view.getInt8(offset++);
        };

        const riffId = readFourCC();
        if (riffId !== 'RIFF') {
          resolve([]);
          return;
        }

        const riffLen = readUint32();
        const riffType = readFourCC();
        if (riffType !== 'sfbk') {
          resolve([]);
          return;
        }

        let smplBuffer: Int16Array | null = null;
        let shdrBuffer: ArrayBuffer | null = null;
        let igenBuffer: ArrayBuffer | null = null;
        let ibagBuffer: ArrayBuffer | null = null;

        while (offset < buffer.byteLength - 8) {
          if (signal?.aborted) {
            resolve([]);
            return;
          }
          const listId = readFourCC();
          const listLen = readUint32();
          const listEnd = offset + listLen;

          if (listId === 'LIST') {
            const listType = readFourCC();
            while (offset < listEnd - 8) {
              if (signal?.aborted) {
                resolve([]);
                return;
              }
              const subId = readFourCC();
              const subLen = readUint32();
              const subEnd = offset + subLen;

              // Bounds check list item boundaries defensively
              if (subEnd > buffer.byteLength) {
                break;
              }

              if (subId === 'smpl') {
                smplBuffer = new Int16Array(buffer.slice(offset, subEnd));
              } else if (subId === 'shdr') {
                shdrBuffer = buffer.slice(offset, subEnd);
              } else if (subId === 'igen') {
                igenBuffer = buffer.slice(offset, subEnd);
              } else if (subId === 'ibag') {
                ibagBuffer = buffer.slice(offset, subEnd);
              }
              offset = subEnd;
            }
          } else {
            offset = listEnd;
          }
        }

        interface SF2SampleHeader {
          name: string;
          start: number;
          end: number;
          startLoop: number;
          endLoop: number;
          sampleRate: number;
          originalPitch: number;
          pitchCorrection: number;
          sampleLink: number;
          sampleType: number;
        }

        const shdrs: SF2SampleHeader[] = [];
        if (shdrBuffer) {
          const shView = new DataView(shdrBuffer);
          const shCount = Math.floor(shdrBuffer.byteLength / SF2_SHDR_RECORD_SIZE);
          for (let i = 0; i < shCount - 1; i++) {
            const base = i * SF2_SHDR_RECORD_SIZE;
            if (base + SF2_SHDR_RECORD_SIZE > shdrBuffer.byteLength) break;
            let nameStr = '';
            for (let c = 0; c < 20; c++) {
              const charCode = shView.getUint8(base + c);
              if (charCode !== 0) nameStr += String.fromCharCode(charCode);
            }
            nameStr = nameStr.trim();
            shdrs.push({
              name: nameStr,
              start: shView.getUint32(base + 20, true),
              end: shView.getUint32(base + 24, true),
              startLoop: shView.getUint32(base + 28, true),
              endLoop: shView.getUint32(base + 32, true),
              sampleRate: shView.getUint32(base + 36, true),
              originalPitch: shView.getUint8(base + 40),
              pitchCorrection: shView.getInt8(base + 41),
              sampleLink: shView.getUint16(base + 42, true),
              sampleType: shView.getUint16(base + 44, true),
            });
          }
        }

        interface SF2Zone {
          sampleID: number;
          lowKey: number;
          highKey: number;
          lowVel: number;
          highVel: number;
          coarseTune: number;
          fineTune: number;
          overridingRootKey: number;
        }

        const zones: SF2Zone[] = [];
        if (ibagBuffer && igenBuffer) {
          const ibagView = new DataView(ibagBuffer);
          const igenView = new DataView(igenBuffer);
          const ibagCount = Math.floor(ibagBuffer.byteLength / SF2_IBAG_RECORD_SIZE);

          for (let i = 0; i < ibagCount - 1; i++) {
            const baseIbag = i * SF2_IBAG_RECORD_SIZE;
            if (baseIbag + 4 > ibagBuffer.byteLength) break;
            const genStart = ibagView.getUint16(baseIbag, true);
            const genEnd = ibagView.getUint16(baseIbag + 4, true);

            let sampleID = -1;
            let lowKey = 0;
            let highKey = 127;
            let lowVel = 0;
            let highVel = 127;
            let coarseTune = 0;
            let fineTune = 0;
            let overridingRootKey = -1;

            const maxG = Math.floor(igenBuffer.byteLength / SF2_IGEN_RECORD_SIZE);
            const limitedGenEnd = Math.min(genEnd, maxG);

            for (let g = genStart; g < limitedGenEnd; g++) {
              const baseIgen = g * SF2_IGEN_RECORD_SIZE;
              if (baseIgen + 4 > igenBuffer.byteLength) break;
              const oper = igenView.getUint16(baseIgen, true);
              const amount = igenView.getInt16(baseIgen + 2, true);

              if (oper === 53) {
                sampleID = amount;
              } else if (oper === 43) {
                lowKey = amount & 0xFF;
                highKey = (amount >> 8) & 0xFF;
              } else if (oper === 44) {
                lowVel = amount & 0xFF;
                highVel = (amount >> 8) & 0xFF;
              } else if (oper === 8) {
                fineTune = amount;
              } else if (oper === 58) {
                overridingRootKey = amount;
              }
            }

            if (sampleID !== -1) {
              zones.push({
                sampleID,
                lowKey,
                highKey,
                lowVel,
                highVel,
                coarseTune,
                fineTune,
                overridingRootKey
              });
            }
          }
        }

        const samples: KontaktSample[] = [];
        if (smplBuffer) {
          zones.forEach((zone, idx) => {
            if (signal?.aborted) return;
            if (zone.sampleID >= 0 && zone.sampleID < shdrs.length) {
              const sh = shdrs[zone.sampleID];
              const startIdx = sh.start;
              const endIdx = sh.end;
              const len = endIdx - startIdx;
              if (len <= 0 || startIdx < 0 || endIdx > smplBuffer!.length) return;

              const rawSamples = smplBuffer!.subarray(startIdx, endIdx);
              const floatData = new Float32Array(rawSamples.length);
              for (let s = 0; s < rawSamples.length; s++) {
                floatData[s] = rawSamples[s] / 32768.0;
              }

              const audioBuffer = audioCtx.createBuffer(1, floatData.length, sh.sampleRate || 44100);
              audioBuffer.copyToChannel(floatData, 0);

              const rootKey = zone.overridingRootKey !== -1 ? zone.overridingRootKey : sh.originalPitch;
              const loopStart = sh.startLoop - startIdx;
              const loopEnd = sh.endLoop - startIdx;
              const loopEnabled = loopEnd > loopStart && loopStart >= 0;

              samples.push({
                id: `sf2_${idx}_${Math.random().toString(36).substring(7)}`,
                name: sh.name || `sf2_sample_${zone.sampleID}`,
                buffer: audioBuffer,
                midiNote: rootKey,
                velocityLow: zone.lowVel,
                velocityHigh: zone.highVel,
                velocity: 100,
                articulation: 'default',
                size: len * 2,
                isDrum: false,
                roundRobinIdx: 0,
                formatDetected: 'SF2',
                loopPoints: {
                  start: loopStart,
                  end: loopEnd,
                  enabled: loopEnabled
                }
              });
            }
          });
        }

        if (samples.length === 0 && smplBuffer) {
          shdrs.forEach((sh, idx) => {
            if (signal?.aborted) return;
            const startIdx = sh.start;
            const endIdx = sh.end;
            const len = endIdx - startIdx;
            if (len <= 0 || startIdx < 0 || endIdx > smplBuffer!.length) return;

            const rawSamples = smplBuffer!.subarray(startIdx, endIdx);
            const floatData = new Float32Array(rawSamples.length);
            for (let s = 0; s < rawSamples.length; s++) {
              floatData[s] = rawSamples[s] / 32768.0;
            }

            const audioBuffer = audioCtx.createBuffer(1, floatData.length, sh.sampleRate || 44100);
            audioBuffer.copyToChannel(floatData, 0);

            const loopStart = sh.startLoop - startIdx;
            const loopEnd = sh.endLoop - startIdx;
            const loopEnabled = loopEnd > loopStart && loopStart >= 0;

            samples.push({
              id: `sf2_fallback_${idx}_${Math.random().toString(36).substring(7)}`,
              name: sh.name || `sf2_fallback_${idx}`,
              buffer: audioBuffer,
              midiNote: sh.originalPitch,
              velocityLow: 0,
              velocityHigh: 127,
              velocity: 100,
              articulation: 'default',
              size: len * 2,
              isDrum: false,
              roundRobinIdx: 0,
              formatDetected: 'SF2',
              loopPoints: {
                start: loopStart,
                end: loopEnd,
                enabled: loopEnabled
              }
            });
          });
        }

        resolve(samples);
      } catch (err) {
        console.warn("SF2 parsing failed:", err);
        resolve([]);
      }
    });
  }

  /**
   * Detailed AKP Akai keygroup/envelope parser.
   */
  public static parseAkpBinary(buffer: ArrayBuffer): MappedSampleMeta[] {
    const entries: MappedSampleMeta[] = [];
    const view = new DataView(buffer);
    if (buffer.byteLength < AKP_MIN_BYTE_LENGTH) return [];

    let numKGs = view.getUint8(AKP_KG_COUNT_OFFSET);
    if (numKGs === 0 || numKGs > 99) {
      numKGs = 12; // Scans more keygroups if count not at standard location
    }

    let kgOffset = AKP_KG_START_OFFSET;

    for (let kg = 0; kg < numKGs; kg++) {
      if (kgOffset + AKP_KG_SIZE > buffer.byteLength) break;

      const highKey = view.getUint8(kgOffset + 4) || 127;
      const lowKey = view.getUint8(kgOffset + 5) || 0;

      // Extract up to 4 zones per keygroup
      for (let z = 0; z < 4; z++) {
        const zoneOffset = kgOffset + 12 + z * AKP_ZONE_SIZE;
        if (zoneOffset + AKP_ZONE_SIZE > buffer.byteLength) break;

        let sName = '';
        for (let i = 0; i < AKP_ZONE_SNAME_LEN; i++) {
          if (zoneOffset + i >= buffer.byteLength) break;
          const c = view.getUint8(zoneOffset + i);
          if (c >= 32 && c <= 126) sName += String.fromCharCode(c);
        }
        sName = sName.trim();
        if (sName.length > 2) {
          const coarse = view.getInt8(zoneOffset + 16);
          const fine = view.getInt8(zoneOffset + 17);
          const lowVel = view.getUint8(zoneOffset + 18) || 0;
          const highVel = view.getUint8(zoneOffset + 19) || 127;

          let rootKey = Math.floor((lowKey + highKey) / 2);
          if (rootKey <= 0 || rootKey > 127) rootKey = 60;

          let samplePath = sName;
          if (!/\.(wav|snd|aif|aiff|mp3)$/i.test(samplePath)) {
            samplePath += '.wav';
          }

          entries.push({
            path: samplePath,
            midiNote: rootKey,
            velocityLow: lowVel,
            velocityHigh: highVel,
            velocity: 100,
            articulation: 'default',
            isDrum: false,
            roundRobinIdx: z,
            drumVoice: null,
            mappingConfidence: 5,
            mappingNote: `Akai AKP Keygroup ${kg + 1} (Coarse Tuning: ${coarse}, Fine: ${fine})`
          });
        }
      }
      kgOffset += AKP_KG_SIZE;
    }
    return entries;
  }

  /**
   * Proprietary Akai S1000/S3000 SND Decoder.
   */
  public static decodeAkaiSnd(buffer: ArrayBuffer, audioCtx: AudioContext): { name: string; buffer: AudioBuffer; loopPoints: { start: number; end: number; enabled: boolean } } | null {
    if (buffer.byteLength < 512) return null;
    const view = new DataView(buffer);

    let name = '';
    for (let i = 0; i < 12; i++) {
      const c = view.getUint8(12 + i);
      if (c >= 32 && c <= 126) name += String.fromCharCode(c);
    }
    name = name.trim() || 'Akai Sample';

    const sampleLength = view.getUint32(24, true);
    const loopStart = view.getUint32(28, true);
    const loopLength = view.getUint32(32, true);
    const sampleRate = view.getUint32(36, true) || 44100;
    const loopFlag = view.getUint8(40);

    const pcmDataStart = 512;
    const pcmDataBytes = buffer.byteLength - pcmDataStart;
    const pcmDataSamples = Math.floor(pcmDataBytes / 2);
    const finalSamplesCount = Math.min(sampleLength, pcmDataSamples);

    if (finalSamplesCount <= 0) return null;

    const pcmArray = new Int16Array(buffer, pcmDataStart, finalSamplesCount);
    const floatData = new Float32Array(finalSamplesCount);
    for (let i = 0; i < finalSamplesCount; i++) {
      floatData[i] = pcmArray[i] / 32768.0;
    }

    const audioBuffer = audioCtx.createBuffer(1, finalSamplesCount, sampleRate);
    audioBuffer.copyToChannel(floatData, 0);

    const loopEnd = loopStart + loopLength;
    const loopEnabled = loopFlag > 0 && loopLength > 0;

    return {
      name,
      buffer: audioBuffer,
      loopPoints: {
        start: loopStart,
        end: loopEnd,
        enabled: loopEnabled
      }
    };
  }

  /**
   * Korg Triton KMP Text Parser.
   */
  public static parseKmpText(text: string): MappedSampleMeta[] {
    const entries: MappedSampleMeta[] = [];
    const lines = text.split(/\r?\n/);

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith('#')) continue;

      const ksfMatch = line.match(/([a-zA-Z0-9_\-]+\.ksf)/i);
      if (ksfMatch) {
        const ksfName = ksfMatch[1];
        const nums = line.match(/\d+/g);
        let rootKey = 60;
        let lowKey = 0;
        let highKey = 127;

        if (nums && nums.length >= 1) {
          rootKey = parseInt(nums[0], 10);
        }
        if (nums && nums.length >= 3) {
          lowKey = parseInt(nums[1], 10);
          highKey = parseInt(nums[2], 10);
        }

        entries.push({
          path: ksfName,
          midiNote: rootKey,
          velocityLow: 0,
          velocityHigh: 127,
          velocity: 100,
          articulation: 'default',
          isDrum: false,
          roundRobinIdx: 0,
          drumVoice: null,
          mappingConfidence: 5,
          mappingNote: `Korg KMP Mapped: ${ksfName} (Key range: ${lowKey}-${highKey})`
        });
      }
    }
    return entries;
  }

  /**
   * Korg Triton KMP Binary Parser.
   */
  public static parseKmpBinary(buffer: ArrayBuffer): MappedSampleMeta[] {
    const entries: MappedSampleMeta[] = [];
    const view = new Uint8Array(buffer);

    for (let i = 0; i < view.length - 8; i++) {
      if (
        view[i] === 46 && 
        (view[i+1] === 75 || view[i+1] === 107) && 
        (view[i+2] === 83 || view[i+2] === 115) && 
        (view[i+3] === 70 || view[i+3] === 102)
      ) {
        let start = i;
        while (start > 0 && view[start-1] >= 32 && view[start-1] <= 126 && view[start-1] !== 44 && view[start-1] !== 32) {
          start--;
        }
        let fileName = '';
        for (let j = start; j < i + 4; j++) {
          fileName += String.fromCharCode(view[j]);
        }
        fileName = fileName.trim();

        if (fileName.length > 4) {
          let rootKey = 60;
          for (let b = Math.max(0, start - 16); b < start; b++) {
            const v = view[b];
            if (v >= 24 && v <= 108 && v !== 60) {
              rootKey = v;
              break;
            }
          }

          entries.push({
            path: fileName,
            midiNote: rootKey,
            velocityLow: 0,
            velocityHigh: 127,
            velocity: 100,
            articulation: 'default',
            isDrum: false,
            roundRobinIdx: 0,
            drumVoice: null,
            mappingConfidence: 5,
            mappingNote: `Binary Korg KMP Mapped: ${fileName}`
          });
        }
      }
    }
    return entries;
  }

  /**
   * Proprietary Korg Triton KSF Sample File Decoder.
   */
  public static decodeKorgKsf(buffer: ArrayBuffer, audioCtx: AudioContext): { name: string; buffer: AudioBuffer; loopPoints: { start: number; end: number; enabled: boolean } } | null {
    if (buffer.byteLength < 80) return null;
    const view = new DataView(buffer);

    const sig = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (sig !== 'KSF ' && sig !== 'KSFP') return null;

    let name = '';
    for (let i = 0; i < 16; i++) {
      const c = view.getUint8(12 + i);
      if (c >= 32 && c <= 126) name += String.fromCharCode(c);
    }
    name = name.trim() || 'Korg Sample';

    const sampleRate = view.getUint32(32, true) || 44100;
    const sampleLength = view.getUint32(36, true);
    const loopStart = view.getUint32(40, true);
    const loopEnd = view.getUint32(44, true);

    const headerSize = sig === 'KSFP' ? 96 : 80;
    if (buffer.byteLength < headerSize) return null;
    const pcmDataStart = headerSize;
    const pcmDataBytes = buffer.byteLength - pcmDataStart;
    const pcmDataSamples = Math.floor(pcmDataBytes / 2);
    const finalSamplesCount = Math.min(sampleLength, pcmDataSamples);

    if (finalSamplesCount <= 0) return null;

    const pcmArray = new Int16Array(buffer, pcmDataStart, finalSamplesCount);
    const floatData = new Float32Array(finalSamplesCount);
    for (let i = 0; i < finalSamplesCount; i++) {
      floatData[i] = pcmArray[i] / 32768.0;
    }

    const audioBuffer = audioCtx.createBuffer(1, finalSamplesCount, sampleRate);
    audioBuffer.copyToChannel(floatData, 0);

    const loopEnabled = loopEnd > loopStart && loopStart > 0;

    return {
      name,
      buffer: audioBuffer,
      loopPoints: {
        start: loopStart,
        end: loopEnd,
        enabled: loopEnabled
      }
    };
  }

  /**
   * Ensoniq EPS/ASR-10 EFE/EDM wavesample extractor & nonlinear decompressor.
   */
  public static parseEnsoniqEfe(buffer: ArrayBuffer, audioCtx: AudioContext): KontaktSample[] {
    const samples: KontaktSample[] = [];
    const view = new DataView(buffer);
    if (buffer.byteLength < 256) return [];

    let wavesampleCount = 0;

    for (let offset = 0; offset < buffer.byteLength - 128; offset += 32) {
      let validName = true;
      let name = '';
      for (let i = 0; i < 8; i++) {
        const c = view.getUint8(offset + i);
        if (c < 32 || c > 126) {
          validName = false;
          break;
        }
        if (c !== 0) name += String.fromCharCode(c);
      }
      name = name.trim();

      if (validName && name.length >= 3 && /^[A-Z0-9_\-\s]+$/i.test(name)) {
        const sr = view.getUint16(offset + 12, true);
        const rootKey = view.getUint8(offset + 16);
        const loopStart = view.getUint32(offset + 20, true);
        const loopEnd = view.getUint32(offset + 24, true);
        const sampleLength = view.getUint32(offset + 28, true);

        if (sr >= 4000 && sr <= 50000 && rootKey >= 12 && rootKey <= 112 && sampleLength > 100 && sampleLength < 1000000) {
          const pcmDataStart = offset + 128;
          if (pcmDataStart + sampleLength * 2 <= buffer.byteLength) {
            const pcmArray = new Int16Array(buffer, pcmDataStart, sampleLength);
            const floatData = new Float32Array(sampleLength);

            const isCompressed = (sr % 10 === 0);
            for (let i = 0; i < sampleLength; i++) {
              if (isCompressed) {
                // Expanded curve mapping (Ensoniq non-linear)
                const s = pcmArray[i] / 32768.0;
                floatData[i] = Math.sign(s) * Math.pow(Math.abs(s), 1.25);
              } else {
                floatData[i] = pcmArray[i] / 32768.0;
              }
            }

            const audioBuffer = audioCtx.createBuffer(1, sampleLength, sr);
            audioBuffer.copyToChannel(floatData, 0);

            const loopEnabled = loopEnd > loopStart && loopStart > 0;

            samples.push({
              id: `ensoniq_${wavesampleCount}_${Math.random().toString(36).substring(7)}`,
              name: `${name}.wav`,
              buffer: audioBuffer,
              midiNote: rootKey,
              velocityLow: 0,
              velocityHigh: 127,
              velocity: 100,
              articulation: 'default',
              size: sampleLength * 2,
              isDrum: false,
              roundRobinIdx: 0,
              formatDetected: 'EFE',
              loopPoints: {
                start: loopStart,
                end: loopEnd,
                enabled: loopEnabled
              }
            });
            wavesampleCount++;
            offset += 128 + sampleLength * 2;
          }
        }
      }
    }
    return samples;
  }

  /**
   * Kurzweil K2000 KRZ/K25 multisample reference extractor.
   */
  public static parseKurzweilKrz(buffer: ArrayBuffer, audioCtx: AudioContext): KontaktSample[] {
    const samples: KontaktSample[] = [];
    const view = new DataView(buffer);
    if (buffer.byteLength < 512) return [];

    let sampleCount = 0;

    for (let offset = 0; offset < buffer.byteLength - 256; offset += 32) {
      let name = '';
      let isName = true;
      for (let i = 0; i < 16; i++) {
        const c = view.getUint8(offset + i);
        if (c !== 0 && (c < 32 || c > 126)) {
          isName = false;
          break;
        }
        if (c !== 0) name += String.fromCharCode(c);
      }
      name = name.trim();

      if (isName && name.length >= 3 && /^[A-Z0-9_\-\s]+$/i.test(name)) {
        const sampleRate = view.getUint32(offset + 24, true);
        const sampleLength = view.getUint32(offset + 28, true);
        const loopStart = view.getUint32(offset + 32, true);
        const loopEnd = view.getUint32(offset + 36, true);
        const rootKey = view.getUint16(offset + 40, true);

        if (sampleRate >= 8000 && sampleRate <= 48000 && rootKey >= 12 && rootKey <= 112 && sampleLength > 100 && sampleLength < 1000000) {
          const pcmDataStart = offset + 128;
          if (pcmDataStart + sampleLength * 2 <= buffer.byteLength) {
            const pcmArray = new Int16Array(buffer, pcmDataStart, sampleLength);
            const floatData = new Float32Array(sampleLength);
            for (let i = 0; i < sampleLength; i++) {
              floatData[i] = pcmArray[i] / 32768.0;
            }

            const audioBuffer = audioCtx.createBuffer(1, sampleLength, sampleRate);
            audioBuffer.copyToChannel(floatData, 0);

            const loopEnabled = loopEnd > loopStart && loopStart > 0;

            samples.push({
              id: `krz_${sampleCount}_${Math.random().toString(36).substring(7)}`,
              name: `${name}.wav`,
              buffer: audioBuffer,
              midiNote: rootKey,
              velocityLow: 0,
              velocityHigh: 127,
              velocity: 100,
              articulation: 'default',
              size: sampleLength * 2,
              isDrum: false,
              roundRobinIdx: 0,
              formatDetected: 'KRZ',
              loopPoints: {
                start: loopStart,
                end: loopEnd,
                enabled: loopEnabled
              }
            });
            sampleCount++;
            offset += 128 + sampleLength * 2;
          }
        }
      }
    }
    return samples;
  }

  /**
   * Heuristic scanner for legacy binary sampler descriptors.
   */
  public static parseBinaryHardwareDescriptor(buffer: ArrayBuffer, ext: string): MappedSampleMeta[] {
    const entries: MappedSampleMeta[] = [];
    const view = new Uint8Array(buffer);

    const strings: { text: string; offset: number }[] = [];
    let currentStr = '';
    let startOffset = -1;

    for (let i = 0; i < view.length; i++) {
      const char = view[i];
      if (char >= 32 && char <= 126) {
        if (currentStr === '') startOffset = i;
        currentStr += String.fromCharCode(char);
      } else {
        if (currentStr.length >= 4) {
          strings.push({ text: currentStr, offset: startOffset });
        }
        currentStr = '';
      }
    }
    if (currentStr.length >= 4) {
      strings.push({ text: currentStr, offset: startOffset });
    }

    const sampleNames = strings.filter(s => {
      const text = s.text.toLowerCase();
      return /\.(wav|snd|aif|aiff|mp3)$/i.test(text) || 
             (s.text.length >= 6 && s.text.length <= 16 && !/[^a-zA-Z0-9_\-\s]/.test(text));
    });

    if (sampleNames.length > 0) {
      sampleNames.forEach((s, idx) => {
        let rootKey = 60 + (idx % 24);
        const searchRange = 64;
        const startSearch = Math.max(0, s.offset - searchRange);
        const endSearch = Math.min(view.length, s.offset + s.text.length + searchRange);

        for (let b = startSearch; b < endSearch; b++) {
          const val = view[b];
          if (val >= 24 && val <= 108 && val % 12 === 0 && val !== 60) {
            rootKey = val;
            break;
          }
        }

        let samplePath = s.text;
        if (!/\.(wav|snd|aif|aiff|mp3)$/i.test(samplePath.toLowerCase())) {
          samplePath += '.wav';
        }

        entries.push({
          path: samplePath,
          midiNote: rootKey,
          velocityLow: 0,
          velocityHigh: 127,
          velocity: 100,
          articulation: 'default',
          isDrum: false,
          roundRobinIdx: 0,
          drumVoice: null,
          mappingConfidence: 4,
          mappingNote: `Parsed from classic hardware ${ext.toUpperCase()} header`
        });
      });
    }

    if (entries.length === 0) {
      for (let i = 0; i < 16; i++) {
        entries.push({
          path: `sample_${i + 1}.wav`,
          midiNote: 36 + i,
          velocityLow: 0,
          velocityHigh: 127,
          velocity: 100,
          articulation: 'default',
          isDrum: false,
          roundRobinIdx: 0,
          drumVoice: null,
          mappingConfidence: 1,
          mappingNote: 'Hardware fallback chromatic mapping'
        });
      }
    }
    return entries;
  }

  /**
   * Helper to decode and map external samples associated with retro descriptors.
   */
  public static async decodeAndMapExternalSamples(
    mappingEntries: MappedSampleMeta[],
    files: { path: string; file: JSZip.JSZipObject | File }[],
    audioCtx: AudioContext,
    ext: string,
    onProgress: (ratio: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<KontaktSample[]> {
    const audioFilesMap = new Map<string, { path: string; file: JSZip.JSZipObject | File }>();
    files.forEach(f => {
      if (/\.(wav|mp3|flac|ogg|aif|aiff|m4a|snd|ksf)$/i.test(f.path)) {
        const nameOnly = f.path.split('/').pop()?.toLowerCase() || '';
        audioFilesMap.set(nameOnly, f);
      }
    });

    const samples: KontaktSample[] = [];
    const totalEntries = mappingEntries.length;

    for (let i = 0; i < totalEntries; i++) {
      if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');
      const entry = mappingEntries[i];
      const entryFileName = entry.path.split(/[\\/]/).pop()?.toLowerCase() || '';

      let match = audioFilesMap.get(entryFileName);
      if (!match) {
        for (const [k, v] of audioFilesMap.entries()) {
          if (k.includes(entryFileName) || entryFileName.includes(k)) {
            match = v;
            break;
          }
        }
      }

      if (match) {
        onProgress(20 + (i / totalEntries) * 80, `Decoding ${entry.path.split('/').pop()}`);
        try {
          const isZipObj = 'async' in match.file;
          const bufferData = isZipObj
            ? await (match.file as any).async('arraybuffer')
            : await (match.file as File).arrayBuffer();

          let audioBuffer: AudioBuffer | null = null;
          let loopPoints = entry.loopPoints;

          if (match.path.toLowerCase().endsWith('.snd')) {
            const sndDecoded = KontaktParser.decodeAkaiSnd(bufferData, audioCtx);
            if (sndDecoded) {
              audioBuffer = sndDecoded.buffer;
              if (sndDecoded.loopPoints.enabled) {
                loopPoints = sndDecoded.loopPoints;
              }
            }
          } else if (match.path.toLowerCase().endsWith('.ksf')) {
            const ksfDecoded = KontaktParser.decodeKorgKsf(bufferData, audioCtx);
            if (ksfDecoded) {
              audioBuffer = ksfDecoded.buffer;
              if (ksfDecoded.loopPoints.enabled) {
                loopPoints = ksfDecoded.loopPoints;
              }
            }
          }

          if (!audioBuffer) {
            audioBuffer = await this.safeDecodeAudioData(audioCtx, bufferData, match.path.split('/').pop());
          }

          samples.push({
            id: `sample_${Math.random().toString(36).substring(7)}`,
            name: match.path.split('/').pop() || entry.path,
            buffer: audioBuffer,
            midiNote: entry.midiNote,
            velocityLow: entry.velocityLow,
            velocityHigh: entry.velocityHigh,
            velocity: entry.velocity,
            articulation: entry.articulation,
            size: bufferData.byteLength,
            isDrum: entry.isDrum,
            roundRobinIdx: entry.roundRobinIdx,
            formatDetected: ext.toUpperCase(),
            loopPoints
          });
        } catch (e) {
          console.warn(`Failed to decode sample ${entry.path}:`, e);
        }
      }
    }

    if (samples.length === 0 && totalEntries > 0) {
      throw new Error(`Failed to decode any samples for ${ext.toUpperCase()} keymap. All matching audio files failed to decode or were missing.`);
    }

    return samples;
  }

  /**
   * High-level entry point to parse a retro instrument (SF2, AKP, KMP, etc.)
   */
  public static async parseRetroInstrument(
    files: { path: string; file: JSZip.JSZipObject | File }[],
    audioCtx: AudioContext,
    onProgress: (ratio: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<{ name: string; samples: KontaktSample[]; mappingMode: 'chromatic' | 'oneshot' | 'hybrid'; report: MappingReport } | null> {
    const descriptorEntry = files.find(f => /\.(sfz|sf2|akp|kmp|svd|krz|efe|edm)$/i.test(f.path));
    if (!descriptorEntry) return null;

    const ext = descriptorEntry.path.split('.').pop()?.toLowerCase() || '';
    const name = descriptorEntry.path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Retro Instrument';

    // Strategy Pattern Registration
    const strategies: RetroParserStrategy[] = [
      new Sf2ParserStrategy(),
      new EnsoniqParserStrategy(),
      new KurzweilParserStrategy(),
      new DescriptorParserStrategy()
    ];

    for (const strategy of strategies) {
      if (strategy.canHandle(ext)) {
        onProgress(10, `Parsing vintage ${ext.toUpperCase()} keymap descriptor...`);
        const result = await strategy.parse(descriptorEntry, files, audioCtx, onProgress, signal);
        if (result) return result;
      }
    }

    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════
// STRATEGY PATTERN IMPLEMENTATIONS
// ════════════════════════════════════════════════════════════════════════

abstract class MonolithicParserStrategy implements RetroParserStrategy {
  public abstract canHandle(ext: string): boolean;
  protected abstract parseBuffer(buffer: ArrayBuffer, audioCtx: AudioContext, signal?: AbortSignal): Promise<KontaktSample[]> | KontaktSample[];
  protected abstract getExtractionNote(): string;
  protected abstract getDefaultName(): string;

  public async parse(
    descriptorEntry: { path: string; file: JSZip.JSZipObject | File },
    _files: { path: string; file: JSZip.JSZipObject | File }[],
    audioCtx: AudioContext,
    _onProgress: (ratio: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<{ name: string; samples: KontaktSample[]; mappingMode: 'chromatic' | 'oneshot' | 'hybrid'; report: MappingReport } | null> {
    const name = descriptorEntry.path.split('/').pop()?.replace(/\.[^/.]+$/, '') || this.getDefaultName();
    
    if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');

    const isZipObj = 'async' in descriptorEntry.file;
    const buffer = isZipObj
      ? await (descriptorEntry.file as any).async('arraybuffer')
      : await (descriptorEntry.file as File).arrayBuffer();

    const extractedSamples = await this.parseBuffer(buffer, audioCtx, signal);
    
    if (extractedSamples.length > 0) {
      const report: MappingReport = {
        classification: { 
          mode: 'chromatic', 
          confidence: 5, 
          drumFileCount: 0, 
          pitchedFileCount: extractedSamples.length, 
          totalFiles: extractedSamples.length, 
          reasoning: this.getExtractionNote() 
        },
        entries: extractedSamples.map(s => ({
          path: s.name,
          midiNote: s.midiNote,
          velocityLow: s.velocityLow,
          velocityHigh: s.velocityHigh,
          velocity: s.velocity,
          articulation: s.articulation,
          isDrum: s.isDrum || false,
          roundRobinIdx: s.roundRobinIdx || 0,
          drumVoice: null,
          mappingConfidence: 5,
          mappingNote: this.getExtractionNote(),
          loopPoints: s.loopPoints
        })),
        fallbackCount: 0,
        warnings: []
      };

      return {
        name,
        samples: extractedSamples,
        mappingMode: 'chromatic',
        report
      };
    }
    return null;
  }
}

export class Sf2ParserStrategy extends MonolithicParserStrategy {
  public canHandle(ext: string): boolean { return ext === 'sf2'; }
  protected getDefaultName(): string { return 'SoundFont'; }
  protected getExtractionNote(): string { return 'SoundFont2 Direct Extraction'; }
  protected parseBuffer(buffer: ArrayBuffer, audioCtx: AudioContext, signal?: AbortSignal) {
    return KontaktParser.parseSf2(buffer, audioCtx, signal);
  }
}

export class EnsoniqParserStrategy extends MonolithicParserStrategy {
  public canHandle(ext: string): boolean { return ext === 'efe' || ext === 'edm'; }
  protected getDefaultName(): string { return 'Ensoniq Instrument'; }
  protected getExtractionNote(): string { return 'Ensoniq EPS/ASR Direct Extraction'; }
  protected parseBuffer(buffer: ArrayBuffer, audioCtx: AudioContext) {
    return KontaktParser.parseEnsoniqEfe(buffer, audioCtx);
  }
}

export class KurzweilParserStrategy extends MonolithicParserStrategy {
  public canHandle(ext: string): boolean { return ext === 'krz' || ext === 'k25'; }
  protected getDefaultName(): string { return 'Kurzweil Instrument'; }
  protected getExtractionNote(): string { return 'Kurzweil Direct Extraction'; }
  protected parseBuffer(buffer: ArrayBuffer, audioCtx: AudioContext) {
    return KontaktParser.parseKurzweilKrz(buffer, audioCtx);
  }
}

export class DescriptorParserStrategy implements RetroParserStrategy {
  public canHandle(ext: string): boolean {
    return ext === 'sfz' || ext === 'akp' || ext === 'kmp' || ext === 'svd';
  }

  public async parse(
    descriptorEntry: { path: string; file: JSZip.JSZipObject | File },
    files: { path: string; file: JSZip.JSZipObject | File }[],
    audioCtx: AudioContext,
    onProgress: (ratio: number, currentFile: string) => void,
    signal?: AbortSignal
  ): Promise<{ name: string; samples: KontaktSample[]; mappingMode: 'chromatic' | 'oneshot' | 'hybrid'; report: MappingReport } | null> {
    const ext = descriptorEntry.path.split('.').pop()?.toLowerCase() || '';
    const name = descriptorEntry.path.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'Retro Instrument';

    if (signal?.aborted) throw new DOMException('Parsing aborted', 'AbortError');

    let mappingEntries: MappedSampleMeta[] = [];
    const warnings: string[] = [];

    if (ext === 'sfz') {
      const isZipObj = 'async' in descriptorEntry.file;
      const text = isZipObj 
        ? await (descriptorEntry.file as any).async('string') 
        : await (descriptorEntry.file as File).text();

      mappingEntries = KontaktParser.parseSfzText(text);
      warnings.push(`SFZ descriptor loaded: ${mappingEntries.length} zones mapped.`);
    } else if (ext === 'akp') {
      const isZipObj = 'async' in descriptorEntry.file;
      const buffer = isZipObj
        ? await (descriptorEntry.file as any).async('arraybuffer')
        : await (descriptorEntry.file as File).arrayBuffer();

      mappingEntries = KontaktParser.parseAkpBinary(buffer);
      warnings.push(`Akai AKP program loaded: ${mappingEntries.length} zones mapped.`);
    } else if (ext === 'kmp') {
      const isZipObj = 'async' in descriptorEntry.file;
      let text = '';
      let buffer: ArrayBuffer | null = null;
      if (isZipObj) {
        buffer = await (descriptorEntry.file as any).async('arraybuffer');
        try {
          text = await (descriptorEntry.file as any).async('string');
        } catch (_) {}
      } else {
        buffer = await (descriptorEntry.file as File).arrayBuffer();
        try {
          text = await (descriptorEntry.file as File).text();
        } catch (_) {}
      }

      if (text && text.toLowerCase().includes('multisample')) {
        mappingEntries = KontaktParser.parseKmpText(text);
      } else if (buffer) {
        mappingEntries = KontaktParser.parseKmpBinary(buffer);
      }
      warnings.push(`Korg KMP multisample loaded: ${mappingEntries.length} zones mapped.`);
    } else {
      const isZipObj = 'async' in descriptorEntry.file;
      const buffer = isZipObj
        ? await (descriptorEntry.file as any).async('arraybuffer')
        : await (descriptorEntry.file as File).arrayBuffer();

      mappingEntries = KontaktParser.parseBinaryHardwareDescriptor(buffer, ext);
      warnings.push(`Legacy hardware ${ext.toUpperCase()} keymap parsed: ${mappingEntries.length} zones extracted.`);
    }

    const samples = await KontaktParser.decodeAndMapExternalSamples(
      mappingEntries,
      files,
      audioCtx,
      ext,
      onProgress,
      signal
    );

    const report: MappingReport = {
      classification: { 
        mode: 'chromatic', 
        confidence: 5, 
        drumFileCount: 0, 
        pitchedFileCount: mappingEntries.length, 
        totalFiles: mappingEntries.length, 
        reasoning: `Hardware descriptor (${ext.toUpperCase()}) parsing` 
      },
      entries: mappingEntries,
      fallbackCount: 0,
      warnings
    };

    return {
      name,
      samples,
      mappingMode: 'chromatic',
      report
    };
  }
}