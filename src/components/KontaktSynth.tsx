import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Music, HelpCircle, RefreshCw, Layers, Sliders, Volume2, 
  Trash2, Play, Circle, Settings2, Edit3, ChevronRight, Check,
  FolderOpen, SlidersHorizontal, Settings, Radio, HelpCircle as GuideIcon,
  Flame, Sparkles, FolderUp, CheckCircle2, Grid3X3, Zap, Activity
} from 'lucide-react';
import { 
  KontaktSample, SynthParams, ChannelState, MasterState, EQBand, 
  DEFAULT_FX_STATE, FXChainState 
} from '../types';
import { FXSection } from './FXSection';
import { KontaktParser } from '../utils/KontaktParser';
import { Library } from '../App';
import { KontaktEngine } from '../audio/KontaktEngine';
import { Knob } from './Knob';
import { TactileButton } from './TactileButton';
import { ProMixerConsole } from './ProMixerConsole';
import { useMixerEngine } from '../hooks/useMixerEngine';

const midiToNoteName = (midi: number): string => {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const note = notes[midi % 12];
  return `${note}${octave}`;
};

const KEY_MAP: Record<string, number> = {
  'a': 60, 'w': 61, 's': 62, 'e': 63, 'd': 64, 'f': 65, 't': 66, 'g': 67, 'y': 68,
  'h': 69, 'u': 70, 'j': 71, 'k': 72, 'o': 73, 'l': 74, 'p': 75, ';': 76,
};

interface KontaktSynthProps {
  engine: KontaktEngine | null;
  libraries: Library[];
  setLibraries: React.Dispatch<React.SetStateAction<Library[]>>;
  activeLibId: string;
  setActiveLibId: (id: string) => void;
  activeKeys: Set<number>;
  onPlayNote: (midi: number, velocity?: number) => void;
  onNoteOff: (midi: number) => void;
}

const OscillatorPanel: React.FC<{ params: SynthParams, handleParamChange: (k: keyof SynthParams, v: any) => void }> = ({ params, handleParamChange }) => {
  const [activeOsc, setActiveOsc] = useState<'osc1' | 'osc2' | 'noise'>('osc1');

  return (
    <div className="p-5 bg-[#0a0a0c] border border-[#222]/50 rounded-lg shadow-inner">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b border-[#222]/30 pb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-bold font-mono tracking-widest text-[#888] uppercase">
            01. Dual Oscillator Stage & Noise
          </span>
        </div>
        <div className="flex bg-[#111] border border-[#222] p-0.5 rounded text-[10px] font-mono font-bold uppercase">
          <button
            onClick={() => setActiveOsc('osc1')}
            className={`px-4 py-1.5 rounded transition ${activeOsc === 'osc1' ? 'bg-[#1a1a1a] text-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'text-[#666] hover:text-[#999]'}`}
          >
            OSC 1
          </button>
          <button
            onClick={() => setActiveOsc('osc2')}
            className={`px-4 py-1.5 rounded transition ${activeOsc === 'osc2' ? 'bg-[#1a1a1a] text-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'text-[#666] hover:text-[#999]'}`}
          >
            OSC 2
          </button>
          <button
            onClick={() => setActiveOsc('noise')}
            className={`px-4 py-1.5 rounded transition ${activeOsc === 'noise' ? 'bg-[#1a1a1a] text-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'text-[#666] hover:text-[#999]'}`}
          >
            NOISE
          </button>
        </div>
      </div>

      <div className="min-h-[140px] flex items-center justify-center">
        {activeOsc === 'osc1' && (
          <div className="flex flex-col items-center gap-6 w-full max-w-md">
            <span className="text-[10px] font-bold font-mono text-[#555] uppercase tracking-widest block mb-1">Primary Oscillator</span>
            <div className="flex items-center justify-center gap-8 w-full">
              <div className="flex flex-col gap-2">
                <select 
                  value={params.oscType1} 
                  onChange={(e) => handleParamChange('oscType1', e.target.value)}
                  className="bg-[#0c0c0c] border border-[#222] text-emerald-500 text-xs rounded p-2 w-48 font-mono uppercase font-bold text-center"
                >
                  <option value="sawtooth">SAWTOOTH</option>
                  <option value="square">SQUARE</option>
                  <option value="triangle">TRIANGLE</option>
                  <option value="sine">SINE</option>
                  <option value="pwm">PWM PULSE</option>
                  <option value="sid_pulse">C64 SID</option>
                  <option value="nes_pulse">NES APU</option>
                </select>
              </div>
              <Knob label="Fine Tune" min={-100} max={100} value={params.fineTune} onChange={(v) => handleParamChange('fineTune', v)} unit="c" decimals={0} color="rgb(16,185,129)" />
            </div>
          </div>
        )}

        {activeOsc === 'osc2' && (
          <div className="flex flex-col items-center gap-6 w-full max-w-xl">
            <span className="text-[10px] font-bold font-mono text-[#555] uppercase tracking-widest block mb-1">Sub / Stack Oscillator</span>
            <div className="flex items-center justify-center gap-8 w-full">
              <select 
                value={params.oscType2} 
                onChange={(e) => handleParamChange('oscType2', e.target.value)}
                className="bg-[#0c0c0c] border border-[#222] text-emerald-500 text-xs rounded p-2 w-48 font-mono uppercase font-bold text-center"
              >
                <option value="none">OFF</option>
                <option value="sawtooth">SAW STACK</option>
                <option value="square">SQR STACK</option>
                <option value="sub_oct">SUB-OCTAVE</option>
                <option value="triangle">TRIANGLE</option>
                <option value="sine">SINE</option>
              </select>
              
              <div className="flex gap-6">
                <Knob label="Detune" min={0} max={100} value={params.oscDetune ?? 15} onChange={(v) => handleParamChange('oscDetune', v)} unit="c" decimals={0} color="rgb(16,185,129)" />
                <Knob label="OSC Mix" min={0} max={1.0} value={params.osc2Volume ?? 0.5} onChange={(v) => handleParamChange('osc2Volume', v)} unit="%" decimals={1} color="rgb(16,185,129)" />
              </div>
              
              <div className="flex flex-col gap-3 border-l border-[#222] pl-6">
                <button 
                  onClick={() => handleParamChange('syncMode', !params.syncMode)}
                  className={`px-3 py-1.5 rounded text-[9px] font-mono font-bold uppercase transition-all tracking-widest ${params.syncMode ? 'bg-orange-500 text-white shadow-[0_0_12px_rgba(249,115,22,0.4)]' : 'bg-[#151515] text-[#555] border border-[#222] hover:text-[#888]'}`}
                >
                  Hard Sync
                </button>
                <button 
                  onClick={() => handleParamChange('ringMod', !params.ringMod)}
                  className={`px-3 py-1.5 rounded text-[9px] font-mono font-bold uppercase transition-all tracking-widest ${params.ringMod ? 'bg-emerald-500 text-white shadow-[0_0_12px_rgba(16,185,129,0.4)]' : 'bg-[#151515] text-[#555] border border-[#222] hover:text-[#888]'}`}
                >
                  Ring Mod
                </button>
              </div>
            </div>
          </div>
        )}

        {activeOsc === 'noise' && (
          <div className="flex flex-col items-center gap-6 w-full max-w-md">
            <span className="text-[10px] font-bold font-mono text-[#555] uppercase tracking-widest block mb-1">Noise Floor</span>
            <div className="flex items-center justify-center gap-8 w-full">
              <Knob label="Noise Level" min={0} max={1.0} value={params.noiseVolume ?? 0} onChange={(v) => handleParamChange('noiseVolume', v)} unit="%" decimals={1} color="rgb(16,185,129)" />
              <div className="text-[10px] font-mono text-[#666] uppercase leading-relaxed max-w-[200px] border-l border-[#222] pl-6">
                Authentic analog floor emulation. Inject grit into the filter stage.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const initialEQBand = (id: string, type: 'peaking' | 'lowshelf' | 'highshelf' | 'lowpass' | 'highpass', freq: number, q: number, color: string): EQBand => ({
  id,
  enabled: true,
  type,
  freq,
  gain: 0,
  q,
  color
});

const initialChannelState = (id: string, label: string): ChannelState => ({
  id,
  label,
  volume: 0.8,
  pan: 0,
  muted: false,
  soloed: false,
  outputRoute: 'master',
  eq: [
    initialEQBand('lc', 'highpass', 40, 0.71, '#ef4444'),
    initialEQBand('ls', 'lowshelf', 100, 0.71, '#f59e0b'),
    initialEQBand('p1', 'peaking', 800, 1.0, '#3b82f6'),
    initialEQBand('p2', 'peaking', 2500, 1.0, '#10b981'),
    initialEQBand('hs', 'highshelf', 8000, 0.71, '#8b5cf6'),
    initialEQBand('hc', 'lowpass', 18000, 0.71, '#ec4899')
  ],
  compressor: {
    enabled: false,
    threshold: -20,
    ratio: 4,
    attack: 10,
    release: 100,
    makeupGain: 0
  },
  bus1: false, bus2: false, bus3: false, bus4: false
});

export const KontaktSynth: React.FC<KontaktSynthProps> = ({
  engine,
  libraries,
  setLibraries,
  activeLibId,
  setActiveLibId,
  activeKeys,
  onPlayNote,
  onNoteOff,
}) => {
  const [activeTab, setActiveTab] = useState<'synth' | 'mixer' | 'samples' | 'map' | 'fx'>('synth');
  const [editingSampleId, setEditingSampleId] = useState<string | null>(null);

  // Peak LED state indicators that flash on audio triggers
  // peakLEDs is now replaced by real-time meters from useMixerEngine
  const activeLib = libraries.find(l => l.id === activeLibId) || libraries[0];
  const params = activeLib.params;

  const [mixerChannels, setMixerChannels] = useState<ChannelState[]>([
    initialChannelState('rompler', 'ROMPLER'),
    initialChannelState('synth', 'SYNTH'),
    initialChannelState('sub', 'SUB'),
    initialChannelState('noise', 'NOISE'),
    initialChannelState('ambient', 'AMBIENT')
  ]);

  const [masterState, setMasterState] = useState<MasterState>({
    volume: 1,
    neveDrive: 20,
    stereoWidth: 100,
    busCompEnabled: false,
    busCompThreshold: -15,
    busCompRatio: 2,
    busCompAttack: 30,
    busCompRelease: 200,
    busCompMakeup: 0,
    sidechainSource: 'none',
    fx: DEFAULT_FX_STATE,
    bpm: 120
  });

  // Collect channel output nodes from engine
  const [channelSources, setChannelSources] = useState<Record<string, AudioNode>>({});

  useEffect(() => {
    if (engine) {
      try {
        const sources: Record<string, AudioNode> = {};
        ['rompler', 'synth', 'sub', 'noise', 'ambient'].forEach(ch => {
          const node = engine.getChannelOutput(ch);
          if (node) {
            sources[ch] = node;
          }
        });
        setChannelSources(sources);
        // Disconnect internal engine routing to favor external mixer
        engine.disconnectInternalRouting();
      } catch (err) {
        console.error('Error setting up engine routing:', err);
      }
    }
  }, [engine]);

  const { peakLevels, peakLEDs, masterGrDb, masterOutput, analysers } = useMixerEngine({
    audioContext: engine?.ctx as AudioContext,
    channelSources,
    channels: mixerChannels,
    master: masterState,
    destination: engine?.ctx?.destination as AudioNode
  });

  const handleParamChange = useCallback((key: keyof SynthParams, val: any) => {
    setLibraries(prev => prev.map(lib => {
      if (lib.id === activeLibId) {
        return {
          ...lib,
          params: {
            ...lib.params,
            [key]: val
          }
        };
      }
      return lib;
    }));
  }, [activeLibId, setLibraries]);

  const handleParamsChange = useCallback((updates: Partial<SynthParams>) => {
    setLibraries(prev => prev.map(lib => {
      if (lib.id === activeLibId) {
        return {
          ...lib,
          params: {
            ...lib.params,
            ...updates
          }
        };
      }
      return lib;
    }));
  }, [activeLibId, setLibraries]);

  const handleMixerChange = useCallback((chId: string, field: string, val: any) => {
    setMixerChannels(prev => prev.map(ch => {
      if (ch.id !== chId) return ch;
      if (field === 'eq') {
        return { ...ch, eq: val };
      }
      return { ...ch, [field]: val };
    }));
  }, []);

  const handleMasterChange = useCallback((field: string, val: any) => {
    setMasterState(prev => ({ ...prev, [field]: val }));
  }, []);

  useEffect(() => {
    if (engine) {
      try {
        engine.updateMasterFX(masterState.fx, masterState.bpm);
      } catch (err) {
        console.error('Error updating master FX:', err);
      }
    }
  }, [engine, masterState.fx, masterState.bpm]);

  // Keyboard mapping listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined && note > 0) {
        onPlayNote(note, 100);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      const note = KEY_MAP[e.key.toLowerCase()];
      if (note !== undefined && note > 0) {
        onNoteOff(note);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [onPlayNote, onNoteOff]);

  const auditionSample = useCallback((sample: KontaktSample) => {
    onPlayNote(sample.midiNote, 100);
    const timer = setTimeout(() => onNoteOff(sample.midiNote), 500);
    return () => clearTimeout(timer);
  }, [onPlayNote, onNoteOff]);

  const handleUpdateSampleField = useCallback((sampleId: string, field: keyof KontaktSample, value: any) => {
    setLibraries(prev => prev.map(lib => {
      if (lib.id === activeLibId) {
        const updated = lib.samples.map(s => {
          if (s.id === sampleId) return { ...s, [field]: value };
          return s;
        });
        const remapped = field === 'midiNote' ? KontaktParser.mapSeamlessMidiZones(updated) : updated;
        return { ...lib, samples: remapped };
      }
      return lib;
    }));
  }, [activeLibId, setLibraries]);

  const removeSample = useCallback((sampleId: string) => {
    setLibraries(prev => prev.map(lib => {
      if (lib.id === activeLibId) {
        const filtered = lib.samples.filter(s => s.id !== sampleId);
        const remapped = KontaktParser.mapSeamlessMidiZones(filtered);
        return { ...lib, samples: remapped };
      }
      return lib;
    }));
  }, [activeLibId, setLibraries]);

  const deleteCustomLibrary = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this custom loaded library?")) {
      setLibraries(prev => {
        const next = prev.filter(l => l.id !== id);
        if (activeLibId === id && next.length > 0) {
          setActiveLibId(next[0].id);
        }
        return next;
      });
    }
  }, [activeLibId, setActiveLibId, setLibraries]);

  const startMidi = 36;
  const endMidi = 84;

  const isBlackKey = useCallback((midi: number) => {
    const mod = midi % 12;
    return [1, 3, 6, 8, 10].includes(mod);
  }, []);

  const { whiteKeys, blackKeys } = React.useMemo(() => {
    const w: number[] = [];
    const b: number[] = [];
    const isBlack = (midi: number) => {
      const mod = midi % 12;
      return [1, 3, 6, 8, 10].includes(mod);
    };
    for (let m = startMidi; m <= endMidi; m++) {
      if (isBlack(m)) b.push(m);
      else w.push(m);
    }
    return { whiteKeys: w, blackKeys: b };
  }, []);

  const sortedSamples = React.useMemo(() => {
    return [...activeLib.samples].sort((a, b) => a.midiNote - b.midiNote);
  }, [activeLib.samples]);

  const hasSampleRoot = React.useCallback((midi: number) => {
    return activeLib.samples.some(s => s.midiNote === midi);
  }, [activeLib.samples]);

  const getLibraryThemeColor = () => {
    if (!activeLib) return 'rgb(59,130,246)'; // Blue
    if (activeLib.id === 'custom_init') return 'rgb(249, 115, 22)'; // Amber/Orange
    if (activeLib.params.chipEmulation && activeLib.params.chipEmulation !== 'none') {
      switch (activeLib.params.chipEmulation) {
        case 'emu_sp1200': return 'rgb(234, 179, 8)'; // Gold/Yellow
        case 'ensoniq_asr10': return 'rgb(239, 68, 68)'; // Red
        case 'akai_s1000': return 'rgb(168, 85, 247)'; // Purple
        default: return 'rgb(236, 72, 153)'; // Pink
      }
    }
    if (activeLib.type === 'custom') {
      return 'rgb(34, 197, 94)'; // Emerald Green for custom folder/uploads
    }
    return 'rgb(59,130,246)'; // Default blue
  };

  const getLibrarySkinBg = () => {
    if (!activeLib) return 'bg-gradient-to-b from-[#0f141d] to-[#07090d] border-blue-950/20';
    if (activeLib.id === 'custom_init') {
      return 'bg-gradient-to-b from-[#1c140e] to-[#070503] border-amber-950/20';
    }
    if (activeLib.params.chipEmulation && activeLib.params.chipEmulation !== 'none') {
      return 'bg-gradient-to-b from-[#180f1e] to-[#08050a] border-purple-950/20';
    }
    if (activeLib.type === 'custom') {
      return 'bg-gradient-to-b from-[#0e1c14] to-[#030705] border-emerald-950/20';
    }
    return 'bg-gradient-to-b from-[#0f141d] to-[#07090d] border-blue-950/20';
  };

  const activeColor = getLibraryThemeColor();

  return (
    <div className="bg-[#0c0c0c] border border-[#222] rounded-xl flex flex-col overflow-hidden shadow-2xl relative" id="synth-console-panel">
      
      {/* Wooden Side-Cheeks */}
      <div className="absolute top-0 bottom-0 left-0 w-1.5 bg-gradient-to-r from-[#5c2d12] to-[#3a1a05] border-r border-[#2a1202]"></div>
      <div className="absolute top-0 bottom-0 right-0 w-1.5 bg-gradient-to-l from-[#5c2d12] to-[#3a1a05] border-l border-[#2a1202]"></div>
      
      {/* Sound Library Top Bar */}
      <div className="px-6 py-3 bg-[#0d0d0d] border-b border-[#222] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#666] font-mono tracking-widest font-bold uppercase mr-2">SOUND LIBRARIES:</span>
          <div className="flex flex-wrap gap-1.5">
            {libraries.map((lib) => {
              const isActive = lib.id === activeLibId;
              const isPreset = lib.type === 'preset';
              return (
                <div 
                  key={lib.id} 
                  onClick={() => setActiveLibId(lib.id)}
                  className={`px-3 py-1.5 rounded text-[10px] font-mono font-bold uppercase transition-all duration-200 cursor-pointer flex items-center gap-2 border shadow-sm relative ${
                    isActive ? 'bg-[#151515] text-white' : 'bg-[#111] border-[#222] text-[#666] hover:text-white hover:border-[#333]'
                  }`}
                  style={{
                    borderColor: isActive ? getLibraryThemeColor() : '#222',
                    boxShadow: isActive ? `0 0 10px ${getLibraryThemeColor()}20` : ''
                  }}
                >
                  <Music className="w-3.5 h-3.5" style={{ color: isActive ? getLibraryThemeColor() : '#555' }} />
                  <span>{lib.name}</span>
                  {!isPreset && (
                    <Trash2 
                      onClick={(e) => deleteCustomLibrary(lib.id, e)}
                      className="w-3 h-3 text-red-500 hover:text-red-400 cursor-pointer transition ml-1"
                    />
                  )}
                  <div 
                    className="w-1.5 h-1.5 rounded-full" 
                    style={{
                      backgroundColor: isActive ? getLibraryThemeColor() : '#1e1e1e',
                      boxShadow: isActive ? `0 0 8px ${getLibraryThemeColor()}` : 'none'
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-[#111] border border-[#222] p-0.5 rounded text-[10px] font-mono font-bold uppercase">
          <button
            onClick={() => setActiveTab('synth')}
            className={`px-3 py-1 rounded flex items-center gap-1 transition ${activeTab === 'synth' ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:text-white'}`}
            style={{ color: activeTab === 'synth' ? activeColor : '' }}
          >
            <SlidersHorizontal className="w-3 h-3" />
            Bespoke Panel
          </button>
          
          <button
            onClick={() => setActiveTab('mixer')}
            className={`px-3 py-1 rounded flex items-center gap-1 transition ${activeTab === 'mixer' ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:text-white'}`}
            style={{ color: activeTab === 'mixer' ? activeColor : '' }}
          >
            <Sliders className="w-3 h-3" />
            Outputs Mixer
          </button>

          {activeLib.type === 'custom' && (
            <button
              onClick={() => setActiveTab('samples')}
              className={`px-3 py-1 rounded flex items-center gap-1 transition ${activeTab === 'samples' ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:text-white'}`}
              style={{ color: activeTab === 'samples' ? activeColor : '' }}
            >
              <Layers className="w-3 h-3" />
              Audio Slots
            </button>
          )}

          <button
            onClick={() => setActiveTab('map')}
            className={`px-3 py-1 rounded flex items-center gap-1 transition ${activeTab === 'map' ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:text-white'}`}
            style={{ color: activeTab === 'map' ? activeColor : '' }}
          >
            <Settings className="w-3 h-3" />
            Keys Zones
          </button>

          <button
            onClick={() => setActiveTab('fx')}
            className={`px-3 py-1 rounded flex items-center gap-1 transition ${activeTab === 'fx' ? 'bg-[#1a1a1a] text-white' : 'text-[#666] hover:text-white'}`}
            style={{ color: activeTab === 'fx' ? activeColor : '' }}
          >
            <Zap className="w-3 h-3" />
            FX Chain
          </button>
        </div>
      </div>

      {/* Main Faceplate */}
      <div className={`p-6 flex-1 flex flex-col justify-between transition-all duration-300 ${getLibrarySkinBg()}`}>
        
        {/* Tab 1: Bespoke controls */}
        {activeTab === 'synth' && (
          <div className="flex-1 flex flex-col">
            
            {/* Header Title */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#222]/30 pb-4 mb-5 gap-3">
              <div>
                <h3 className="text-white text-md font-mono font-extrabold uppercase flex items-center gap-2 tracking-wide">
                  {activeLib.name} Parameters
                </h3>
                <p className="text-[#666] text-[10px] font-mono tracking-wider uppercase mt-1">
                  {activeLib.type === 'custom' ? `Custom multi-sample library - ${activeLib.samples.length} mapped channels with ADSR and LFO` : "Library Parameters"}
                </p>
              </div>
              
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-[#090909]/80 border border-[#222]/40 rounded text-[9px] font-mono text-[#555] uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Routing: Stereo Master Out
              </div>
            </div>

            {/* Main parameters layout - Modular Sections */}
            <div className="flex-1 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
              
              {/* SECTION: Oscillators */}
              <OscillatorPanel params={params} handleParamChange={handleParamChange} />

              {/* SECTION: Filters & Modulation */}
              <div className="p-5 bg-[#0a0a0c] border border-[#222]/50 rounded-lg shadow-inner">
                <div className="flex items-center gap-2 mb-4 border-b border-[#222]/30 pb-3">
                  <Zap className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold font-mono tracking-widest text-[#888] uppercase">
                    02. Filter Shapers & LFO Modulation
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
                  <div className="md:col-span-6 border-r border-[#222]/20 pr-6">
                    <span className="text-[9px] font-bold font-mono text-[#555] uppercase block mb-3">Hardware Filter Models</span>
                    <div className="flex items-center gap-6">
                      <Knob label="Cutoff" min={80} max={12000} value={params.filterCutoff} onChange={(v) => handleParamChange('filterCutoff', v)} unit="Hz" decimals={0} color="rgb(59,130,246)" />
                      <Knob label="Reso Q" min={0.1} max={15.0} value={params.filterReso} onChange={(v) => handleParamChange('filterReso', v)} decimals={1} color="rgb(59,130,246)" />
                      <select
                        value={params.filterType}
                        onChange={(e) => handleParamChange('filterType', e.target.value)}
                        className="bg-[#0c0c0c] border border-[#222] text-[#888] text-[10px] rounded p-1.5 w-40 font-mono font-bold uppercase"
                      >
                        <option value="lowpass">24dB LOWPASS</option>
                        <option value="highpass">12dB HIGHPASS</option>
                        <option value="bandpass">12dB BANDPASS</option>
                        <option value="moog_ladder">MOOG LADDER</option>
                        <option value="curtis_sem">CURTIS SEM</option>
                        <option value="oberheim">OB-BANDPASS</option>
                        <option value="ms20">KORG MS-20</option>
                      </select>
                    </div>
                  </div>
                  <div className="md:col-span-6 pl-6">
                    <span className="text-[9px] font-bold font-mono text-[#555] uppercase block mb-3">LFO Routing</span>
                    <div className="flex items-center gap-6">
                      <Knob label="Rate" min={0.1} max={20} value={params.lfoRate} onChange={(v) => handleParamChange('lfoRate', v)} unit="Hz" decimals={1} color="rgb(59,130,246)" />
                      <Knob label="Depth" min={0} max={1.0} value={params.lfoDepth} onChange={(v) => handleParamChange('lfoDepth', v)} unit="%" decimals={1} color="rgb(59,130,246)" />
                      <select
                        value={params.lfoTarget}
                        onChange={(e) => handleParamChange('lfoTarget', e.target.value)}
                        className="bg-[#0c0c0c] border border-[#222] text-[#888] text-[10px] rounded p-1.5 w-40 font-mono font-bold uppercase"
                      >
                        <option value="none">NO TARGET</option>
                        <option value="pitch">PITCH MOD</option>
                        <option value="cutoff">FILTER MOD</option>
                        <option value="volume">TREMOLO</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: Envelopes */}
              <div className="p-5 bg-[#0a0a0c] border border-[#222]/50 rounded-lg shadow-inner">
                <div className="flex items-center gap-2 mb-4 border-b border-[#222]/30 pb-3">
                  <Activity className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-bold font-mono tracking-widest text-[#888] uppercase">
                    03. Contour & Pitch Envelopes
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  <div className="space-y-4">
                    <span className="text-[9px] font-bold font-mono text-[#555] uppercase block">Amplitude ADSR</span>
                    <div className="flex items-center gap-6">
                      <Knob label="Attack" min={0.005} max={2.0} value={params.attack} onChange={(v) => handleParamChange('attack', v)} unit="s" decimals={2} color="rgb(245,158,11)" />
                      <Knob label="Decay" min={0.01} max={2.0} value={params.decay} onChange={(v) => handleParamChange('decay', v)} unit="s" decimals={2} color="rgb(245,158,11)" />
                      <Knob label="Sustain" min={0.0} max={1.0} value={params.sustain} onChange={(v) => handleParamChange('sustain', v)} unit="%" decimals={1} color="rgb(245,158,11)" />
                      <Knob label="Release" min={0.01} max={4.0} value={params.release} onChange={(v) => handleParamChange('release', v)} unit="s" decimals={2} color="rgb(245,158,11)" />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <span className="text-[9px] font-bold font-mono text-[#555] uppercase block">Pitch Envelope</span>
                    <div className="flex items-center gap-6">
                      <Knob label="P.Attack" min={0.005} max={2.0} value={params.pitchEnvAttack ?? 0.1} onChange={(v) => handleParamChange('pitchEnvAttack', v)} unit="s" decimals={2} color="rgb(245,158,11)" />
                      <Knob label="P.Decay" min={0.01} max={2.0} value={params.pitchEnvDecay ?? 0.3} onChange={(v) => handleParamChange('pitchEnvDecay', v)} unit="s" decimals={2} color="rgb(245,158,11)" />
                      <Knob label="P.Depth" min={-12} max={12} value={params.pitchEnvDepth ?? 0} onChange={(v) => handleParamChange('pitchEnvDepth', v)} unit="st" decimals={0} color="rgb(245,158,11)" />
                      <div className="flex-1 text-[8px] font-mono text-[#444] uppercase leading-tight pl-4 border-l border-[#222]">
                        Dynamic pitch drift on trigger.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Vintage Hardware Emulator Section removed as requested */}
            </div>
          </div>
        )}

        {/* Tab 2: Outputs Mixing Console */}
        {activeTab === 'mixer' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            <ProMixerConsole
              channels={mixerChannels}
              onChannelChange={handleMixerChange}
              master={masterState}
              onMasterChange={handleMasterChange}
              peakLevels={peakLevels}
              peakLEDs={peakLEDs}
              masterGainReductionDb={masterGrDb}
              analysers={analysers}
              audioContext={engine?.ctx as AudioContext}
            />
          </div>
        )}

        {/* Tab 3: Decoded Library Multi-Sample Channels */}
        {activeTab === 'samples' && activeLib.type === 'custom' && (
          <div className="flex-1 flex flex-col bg-[#090909]/60 border border-[#222]/30 p-4 rounded-xl">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[#888] text-[10px] font-bold font-mono tracking-widest uppercase">Decoded Library Multi-Sample Channels</span>
              <span className="text-[9px] text-[#555] font-mono font-semibold uppercase">Total Channels: {activeLib.samples.length} slots loaded</span>
            </div>

            {activeLib.samples.length === 0 ? (
              <div className="flex-1 min-h-[140px] flex flex-col items-center justify-center p-8 border border-dashed border-[#222] rounded-lg">
                <Music className="w-8 h-8 text-[#444] mb-2" />
                <span className="text-[#666] text-xs font-mono uppercase text-center">Your uploaded multi-sample tracks will appear here.</span>
              </div>
            ) : (
              <div className="overflow-y-auto max-h-[170px] border border-[#222]/60 rounded-lg bg-[#0c0c0c]">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-[#222] bg-[#111] text-[#666] uppercase text-[9px] tracking-wider font-bold">
                      <th className="py-2 px-3">Slot ID</th>
                      <th className="py-2 px-3">Filename</th>
                      <th className="py-2 px-3 text-center">Root Midi</th>
                      <th className="py-2 px-3 text-center">Vel Limit Low</th>
                      <th className="py-2 px-3 text-center">Vel Limit High</th>
                      <th className="py-2 px-3 text-center">Size</th>
                      <th className="py-2 px-3 text-center">Audition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#222]/50 text-[#888]">
                    {sortedSamples.map((sample) => (
                      <tr key={sample.id} className="hover:bg-[#151515]/30 group transition">
                        <td className="py-1 px-3 text-[9px] font-bold text-[#555]">{sample.id.substring(0, 10)}</td>
                        <td className="py-1 px-3 truncate max-w-[160px] text-white font-semibold" title={sample.name}>
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{sample.name}</span>
                            {sample.formatDetected && (
                              <span className="shrink-0 px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/30 text-orange-400 text-[7.5px] font-extrabold rounded uppercase tracking-wider">
                                {sample.formatDetected}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-1 px-3 text-center">
                          {editingSampleId === sample.id ? (
                            <div className="flex items-center justify-center gap-1">
                              <input
                                type="number" min="0" max="127"
                                value={sample.midiNote}
                                onChange={(e) => handleUpdateSampleField(sample.id, 'midiNote', parseInt(e.target.value, 10) || 60)}
                                className="w-12 bg-[#0c0c0c] border border-orange-500 text-white rounded p-0.5 text-center font-mono text-xs"
                              />
                              <CheckCircle2 
                                onClick={() => setEditingSampleId(null)}
                                className="w-4 h-4 text-emerald-500 cursor-pointer hover:text-white"
                              />
                            </div>
                          ) : (
                            <span 
                              onClick={() => setEditingSampleId(sample.id)}
                              className="bg-[#151515] border border-[#222] px-2 py-0.5 rounded text-white text-[10px] font-bold cursor-pointer hover:border-orange-500 transition"
                            >
                              {sample.midiNote} ({midiToNoteName(sample.midiNote)})
                            </span>
                          )}
                        </td>
                        <td className="py-1 px-3 text-center">
                          <input
                            type="number" min="0" max="127"
                            value={sample.velocityLow}
                            onChange={(e) => handleUpdateSampleField(sample.id, 'velocityLow', parseInt(e.target.value, 10) || 0)}
                            className="w-12 bg-[#0c0c0c] border border-[#222]/80 text-[#888] rounded p-0.5 text-center font-mono text-[10px]"
                          />
                        </td>
                        <td className="py-1 px-3 text-center">
                          <input
                            type="number" min="0" max="127"
                            value={sample.velocityHigh}
                            onChange={(e) => handleUpdateSampleField(sample.id, 'velocityHigh', parseInt(e.target.value, 10) || 127)}
                            className="w-12 bg-[#0c0c0c] border border-[#222]/80 text-[#888] rounded p-0.5 text-center font-mono text-[10px]"
                          />
                        </td>
                        <td className="py-1 px-3 text-center text-[10px] text-[#555]">
                          {sample.size ? `${(sample.size / 1024).toFixed(0)} KB` : "N/A"}
                        </td>
                        <td className="py-1 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => auditionSample(sample)}
                              className="p-1 hover:bg-orange-500/10 rounded text-orange-400 transition cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => removeSample(sample.id)}
                              className="p-1 hover:bg-red-500/10 rounded text-red-400 transition cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Keys Zones Map */}
        {activeTab === 'map' && (
          <div className="flex-1 flex flex-col bg-[#090909]/60 border border-[#222]/30 p-4 rounded-xl">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[#888] text-[10px] font-bold font-mono tracking-widest uppercase">Midi Zone stretching layout</span>
              <span className="text-[9px] text-orange-400 font-mono font-bold flex items-center gap-1">
                <Circle className="w-2 h-2 fill-orange-500 animate-pulse" /> auto-stretch routing enabled
              </span>
            </div>

            {/* Keyboard Mapping Algorithm Selection */}
            <div className="bg-[#0f0f0f] border border-[#222] rounded-lg p-3.5 mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-white text-xs font-mono font-black uppercase tracking-wider block">KEYBOARD MAPPING ALGORITHM</span>
                <p className="text-[10px] text-[#666] font-mono leading-normal uppercase">
                  Select how individual samples are laid out across keys. Oneshots should map 1:1 to dedicated keys without pitch warp.
                </p>
              </div>
              
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] font-mono font-bold text-[#555] uppercase">ALGORITHM:</span>
                {activeLib.type === 'custom' ? (
                  <select
                    value={activeLib.mappingMode || 'chromatic'}
                    onChange={(e) => {
                      const mode = e.target.value as 'chromatic' | 'oneshot';
                      setLibraries(prev => prev.map(lib => {
                        if (lib.id === activeLibId) {
                          const remapped = KontaktParser.mapSeamlessMidiZones(lib.samples, mode);
                          return {
                            ...lib,
                            mappingMode: mode,
                            samples: remapped
                          };
                        }
                        return lib;
                      }));
                    }}
                    className="bg-[#050505] border border-[#222] text-white hover:text-orange-400 text-[10px] font-mono rounded px-2 py-1.5 focus:border-orange-500/50 focus:outline-none transition cursor-pointer font-bold"
                  >
                    <option value="chromatic">CHROMATIC STRETCH (PITCH TRANSPOSE)</option>
                    <option value="oneshot">ONESHOT DISPERSAL (1:1 ORIGINAL PITCH)</option>
                  </select>
                ) : (
                  <span className="text-[10px] font-mono font-bold bg-[#1a1a1a] text-orange-400 px-2 py-1 border border-[#222] rounded">
                    {activeLib.mappingMode === 'oneshot' ? 'ONESHOT TRIGGER DISPERSAL' : 'CHROMATIC STRETCH'}
                  </span>
                )}
              </div>
            </div>

            <div className="bg-[#0c0c0c] p-4 rounded-lg border border-[#222]/60 text-xs space-y-3">
              <p className="text-[#666] font-mono text-[11px] uppercase leading-relaxed">
                THE SAMPLER AUTOMATICALLY PINPOINTS THE PHYSICALLY CLOSEST RECORDED ROOT SAMPLE AND INTERPOLATES SPEED VALUES ON THE FLY. SHOWN BELOW ARE TRIGGER RANGES DETECTED BY OUR MAPPER:
              </p>

              {activeLib.samples.length === 0 ? (
                <div className="h-28 flex flex-col items-center justify-center text-[#555] border border-[#222] rounded border-dashed font-mono uppercase text-[10px] tracking-wider bg-[#060606] p-6 text-center">
                  <span className="text-white font-bold mb-1">COMPREHENSIVE REAL-TIME OSCS IN ACTION</span>
                  <span>Currently playing fallbacks. Import raw multi-sample directories or ZIPs to chart zones!</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2.5 max-h-[160px] overflow-y-auto">
                    {[...activeLib.samples].sort((a, b) => a.midiNote - b.midiNote).map((sample) => (
                      <div 
                        key={sample.id} 
                        onClick={() => auditionSample(sample)}
                        className="flex-1 min-w-[130px] bg-[#121212] border border-[#222] hover:border-orange-500/40 rounded p-2.5 cursor-pointer transition flex flex-col justify-between shadow-md"
                      >
                        <div className="flex justify-between items-start mb-1.5 border-b border-[#222] pb-1">
                          <span className="text-white font-bold font-mono text-[10px] truncate max-w-[90px] uppercase">{sample.name}</span>
                          <span className="bg-orange-500/10 text-orange-400 px-1 py-0.5 rounded text-[9px] font-bold font-mono">{midiToNoteName(sample.midiNote)}</span>
                        </div>
                        <div className="text-[9px] text-[#555] font-mono space-y-0.5">
                          <div>MIDI DETECTED: <span className="text-[#888] font-bold">{sample.midiNote}</span></div>
                          <div>TRIGGER STRETCH: <span className="text-[#888]">
                            {(activeLib.mappingMode || 'chromatic') === 'oneshot' ? (
                              <span className="text-orange-400 font-bold uppercase text-[9px]">EXACT TRIGGER ONLY</span>
                            ) : (
                              `${sample.midiNote - 12} to ${sample.midiNote + 12}`
                            )}
                          </span></div>
                          <div>VEL TRIGGER LAYER: <span className="text-[#888]">{sample.velocityLow}-{sample.velocityHigh}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'fx' && (
          <FXSection 
            state={masterState.fx} 
            bpm={masterState.bpm}
            onStateChange={(fx) => handleMasterChange('fx', fx)} 
            onBpmChange={(bpm) => handleMasterChange('bpm', bpm)}
            onLoadIR={(buffer, name) => engine?.loadImpulseResponse(buffer)}
          />
        )}

      </div>

      {/* Piano Keyboard (Fallback) */}
      <div className="bg-[#0e0e0e] border-t border-[#222] p-4 pt-2 shadow-[inset_0_4px_10px_rgba(0,0,0,0.8)]">
        <div className="flex justify-between items-center mb-2 px-1 text-[#666] text-xs font-mono">
          <span className="flex items-center gap-1.5 uppercase text-[9px] font-bold">
            <Volume2 className="w-3.5 h-3.5 text-orange-500" />
            Keys layout <kbd className="bg-[#0c0c0c] border border-[#222] px-1 py-0.5 rounded text-[8px] text-orange-400">A-W-S-E-D-F-T-G-Y-H-U-J-K</kbd> actively triggers
          </span>
          <span className="text-[#555] text-[9px] uppercase tracking-wider font-bold">
            Full-stretching range: C3 to C7 MIDI
          </span>
        </div>

        {/* Piano Keys render block */}
        <div className="relative h-28 flex select-none bg-[#090909] border border-[#1a1a1a] rounded overflow-hidden">
          {whiteKeys.map((midi) => {
            const isPressed = activeKeys.has(midi);
            const hasSample = hasSampleRoot(midi);
            return (
              <div
                key={midi}
                role="button"
                tabIndex={0}
                aria-label={`White Piano Key ${midiToNoteName(midi)}`}
                onKeyDown={(e) => {
                  if (e.repeat) return;
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onPlayNote(midi, 100);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onNoteOff(midi);
                  }
                }}
                onMouseDown={() => onPlayNote(midi, 100)}
                onMouseUp={() => onNoteOff(midi)}
                onMouseLeave={() => { if (activeKeys.has(midi)) onNoteOff(midi); }}
                className={`flex-1 border-r border-[#1a1a1a] flex flex-col justify-end pb-3 items-center relative transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-orange-500/50 ${
                  isPressed 
                    ? 'bg-gradient-to-b from-[#eee] to-[#ccc] shadow-inner pt-2' 
                    : 'bg-gradient-to-b from-white to-[#e5e5e5] hover:to-[#dadada]'
                }`}
              >
                {/* Micro LED to display sample mapping on piano keys */}
                {hasSample && (
                  <div className="absolute top-1.5 w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)]" />
                )}
                <span className="text-[8px] font-mono text-black font-extrabold select-none pointer-events-none">
                  {midiToNoteName(midi)}
                </span>
              </div>
            );
          })}

          {/* Black Keys */}
          <div className="absolute inset-y-0 left-0 right-0 h-[62%] pointer-events-none flex">
            {whiteKeys.map((whiteMidi, index) => {
              const blackMidi = whiteMidi + 1;
              const drawBlack = isBlackKey(blackMidi) && blackMidi <= endMidi;
              
              if (!drawBlack) return <div key={whiteMidi} className="flex-1 pointer-events-none" />;

              const isPressed = activeKeys.has(blackMidi);
              const hasSample = hasSampleRoot(blackMidi);

              return (
                <div key={whiteMidi} className="flex-1 relative pointer-events-none">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Black Piano Key ${midiToNoteName(blackMidi)}`}
                    onKeyDown={(e) => {
                      if (e.repeat) return;
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        onPlayNote(blackMidi, 100);
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        onNoteOff(blackMidi);
                      }
                    }}
                    onMouseDown={(e) => { e.stopPropagation(); onPlayNote(blackMidi, 100); }}
                    onMouseUp={(e) => { e.stopPropagation(); onNoteOff(blackMidi); }}
                    className={`absolute w-7 h-full -right-3.5 z-10 rounded-b border border-black shadow-[0_3px_5px_rgba(0,0,0,0.5)] flex flex-col justify-end pb-2 items-center cursor-pointer pointer-events-auto transition-all focus:outline-none focus:ring-1 focus:ring-orange-500/50 ${
                      isPressed 
                        ? 'bg-gradient-to-b from-[#444] to-[#111] h-[96%]' 
                        : 'bg-gradient-to-b from-[#222] to-black hover:from-[#333]'
                    }`}
                  >
                    {hasSample && (
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500 shadow-[0_0_5px_rgba(249,115,22,0.6)] mb-1" />
                    )}
                    <span className="text-[7px] font-mono text-[#777] font-bold pointer-events-none select-none">
                      {midiToNoteName(blackMidi)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
    </div>
    </div>
  );
};
