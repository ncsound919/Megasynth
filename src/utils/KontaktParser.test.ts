import { describe, it, expect } from 'vitest';
import { extractSignals, classifyLibrary, assignDrumSlots, parsePitch } from './KontaktParser';

describe('KontaktParser Logic', () => {
  describe('parsePitch', () => {
    it('extracts pitch from simple note names', () => {
      expect(parsePitch('piano_C4')).toBe(60);
      expect(parsePitch('synth_d#3')).toBe(51);
      expect(parsePitch('bass_G-1')).toBe(7); // Note: MIDI note G-1 is 7
      expect(parsePitch('string_F#4')).toBe(66);
    });

    it('returns null when no pitch is found', () => {
      expect(parsePitch('kick_drum_01')).toBeNull();
      expect(parsePitch('snare_hit')).toBeNull();
    });
  });

  describe('extractSignals', () => {
    it('extracts signals accurately for a pitched sample', () => {
      const signals = extractSignals('samples/piano_C4_f_RR2.wav');
      expect(signals.pitchMidi).toBe(60);
      expect(signals.velocityNominal).toBe(98); // 'f' corresponds to 98
      expect(signals.roundRobinIdx).toBe(1); // RR2 is 0-indexed as 1 (since parseRoundRobin parses the match and subtracts 1)
      expect(signals.drumVoice).toBeNull();
    });

    it('extracts signals accurately for a drum sample', () => {
      const signals = extractSignals('drums/kick_01_hard.wav');
      expect(signals.drumVoice).toBe('kick');
      expect(signals.velocityNominal).toBe(115); // 'hard' corresponds to 115
      expect(signals.pitchMidi).toBeNull();
    });
  });

  describe('classifyLibrary', () => {
    it('classifies a library with only drums as oneshot', () => {
      const signals = [
        extractSignals('kick.wav'),
        extractSignals('snare.wav'),
        extractSignals('hihat.wav')
      ];
      const classification = classifyLibrary(signals);
      expect(classification.mode).toBe('oneshot');
    });

    it('classifies a library with pitched notes as chromatic', () => {
      const signals = [
        extractSignals('piano_C3.wav'),
        extractSignals('piano_E3.wav'),
        extractSignals('piano_G3.wav')
      ];
      const classification = classifyLibrary(signals);
      expect(classification.mode).toBe('chromatic');
    });

    it('classifies a mixed library as hybrid', () => {
      const signals = [
        extractSignals('piano_C3.wav'),
        extractSignals('piano_E3.wav'),
        extractSignals('kick.wav'),
        extractSignals('snare.wav')
      ];
      const classification = classifyLibrary(signals, 0.15); // standard threshold
      expect(classification.mode).toBe('hybrid');
    });
  });

  describe('assignDrumSlots', () => {
    it('assigns GM standard notes to recognized drum voices', () => {
      const signals = [
        extractSignals('kick_drum.wav'),
        extractSignals('snare_drum.wav'),
      ];
      const slots = assignDrumSlots(signals);
      expect(slots.find(s => s.path === 'kick_drum.wav')?.midiNote).toBe(36);
      expect(slots.find(s => s.path === 'snare_drum.wav')?.midiNote).toBe(38);
    });

    it('assigns fallbacks for unrecognized percussion', () => {
      const signals = [
        extractSignals('weird_zap_01.wav'),
        extractSignals('laser_pew.wav'),
      ];
      const slots = assignDrumSlots(signals);
      const note1 = slots.find(s => s.path === 'weird_zap_01.wav')?.midiNote;
      const note2 = slots.find(s => s.path === 'laser_pew.wav')?.midiNote;
      
      expect(note1).toBeDefined();
      expect(note2).toBeDefined();
      expect(note1).not.toBe(note2);
      expect(note1).toBeGreaterThanOrEqual(60); // Unrecognized drums start mapping at C3 (60)
    });
  });
});
