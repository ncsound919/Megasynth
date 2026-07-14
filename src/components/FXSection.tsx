import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Zap, 
  Waves, 
  Activity, 
  Timer, 
  Wind, 
  Settings2, 
  GripVertical,
  Power,
  ChevronRight,
  Sparkles,
  Cpu,
  FolderOpen
} from 'lucide-react';
import { FXChainState, DistortionFX, ChorusFX, FlangerFX, DelayFX, ReverbFX, ChipFX } from '../types';
import JSZip from 'jszip';
import { Knob } from './Knob';
import { CHIP_PROFILES } from '../engine/chipProfiles';

interface FXSectionProps {
  state: FXChainState;
  bpm: number;
  onStateChange: (state: FXChainState) => void;
  onBpmChange: (bpm: number) => void;
  onLoadIR?: (buffer: ArrayBuffer, name: string) => void;
}

type StageKey = Exclude<keyof FXChainState, 'order'>;

const updateFXStage = <K extends StageKey>(
  state: FXChainState,
  stage: K,
  data: Partial<FXChainState[K]>
): FXChainState => ({
  ...state,
  [stage]: { ...state[stage], ...data }
});

export const FXSection: React.FC<FXSectionProps> = ({ state, bpm, onStateChange, onBpmChange, onLoadIR }) => {
  const [activeStage, setActiveStage] = useState<StageKey>(state.order[0] as StageKey);

  const updateStage = React.useCallback(<K extends StageKey>(stage: K, data: Partial<FXChainState[K]>) => {
    onStateChange(updateFXStage(state, stage, data));
  }, [state, onStateChange]);

  const toggleStage = React.useCallback((stage: StageKey) => {
    const current = state[stage] as any;
    updateStage(stage, { enabled: !current.enabled } as any);
  }, [state, updateStage]);

  const getIcon = (stage: string) => {
    switch (stage) {
      case 'chip': return <Cpu className="w-4 h-4" />;
      case 'distortion': return <Activity className="w-4 h-4" />;
      case 'chorus': return <Waves className="w-4 h-4" />;
      case 'flanger': return <Wind className="w-4 h-4" />;
      case 'delay': return <Timer className="w-4 h-4" />;
      case 'reverb': return <Sparkles className="w-4 h-4" />;
      default: return <Zap className="w-4 h-4" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#080808] text-white rounded-lg border border-[#222] overflow-hidden">
      {/* FX Chain Header / Order Ribbon */}
      <div className="flex items-center gap-2 p-3 bg-[#111] border-b border-[#222]">
        <div className="flex items-center gap-1.5 px-3 py-1 bg-[#1a1a1a] rounded-full border border-[#333]">
          <Settings2 className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-[10px] font-bold font-mono tracking-widest text-[#888] uppercase">Signal Chain</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 bg-[#1a1a1a] rounded-full border border-[#333] ml-2">
          <Timer className="w-3.5 h-3.5 text-amber-500" />
          <input 
            type="number"
            value={bpm}
            onChange={(e) => onBpmChange(Number(e.target.value))}
            className="w-10 bg-transparent text-[10px] font-bold font-mono text-amber-500 outline-none"
          />
          <span className="text-[8px] font-bold font-mono text-[#555] uppercase">BPM</span>
        </div>
        
        <div className="flex items-center gap-1 flex-1 overflow-x-auto no-scrollbar ml-4">
          {state.order.map((stage, idx) => (
            <React.Fragment key={stage}>
              <motion.button
                layoutId={`stage-${stage}`}
                onClick={() => setActiveStage(stage)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border transition-all ${
                  activeStage === stage 
                    ? 'bg-blue-600/20 border-blue-500/50 text-blue-400' 
                    : 'bg-[#151515] border-[#222] text-[#555] hover:text-[#888]'
                }`}
              >
                <div className={`${(state[stage] as any).enabled ? 'text-blue-500' : 'text-[#333]'}`}>
                  {getIcon(stage)}
                </div>
                <span className="text-[9px] font-bold font-mono uppercase tracking-tighter">{stage}</span>
              </motion.button>
              {idx < state.order.length - 1 && <ChevronRight className="w-3 h-3 text-[#222]" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Editor Stage */}
      <div className="flex-1 p-8 grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-4 flex flex-col justify-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStage}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20">
                  {React.cloneElement(getIcon(activeStage) as React.ReactElement, { className: "w-8 h-8 text-blue-500" })}
                </div>
                <div>
                  <h2 className="text-2xl font-bold font-mono uppercase tracking-tighter leading-none">{activeStage}</h2>
                  <p className="text-[10px] text-[#555] font-mono mt-1">Professional DSP processing module</p>
                </div>
              </div>

              <button
                onClick={() => toggleStage(activeStage as any)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all ${
                  (state[activeStage] as any).enabled 
                    ? 'bg-blue-600/10 border-blue-500/30 text-blue-400 shadow-[0_0_20px_rgba(59,130,246,0.1)]' 
                    : 'bg-[#111] border-[#222] text-[#444]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Power className={`w-4 h-4 ${ (state[activeStage] as any).enabled ? 'text-blue-500' : 'text-[#333]'}`} />
                  <span className="text-xs font-bold font-mono uppercase tracking-widest">
                    { (state[activeStage] as any).enabled ? 'MODULE ACTIVE' : 'BYPASSED' }
                  </span>
                </div>
                <div className={`w-2 h-2 rounded-full ${(state[activeStage] as any).enabled ? 'bg-blue-500 animate-pulse' : 'bg-[#222]'}`} />
              </button>

              <div className="pt-6 border-t border-[#222]">
                <div className="flex items-center gap-4">
                  <Knob 
                    label="Mix" 
                    min={0} max={100} 
                    value={(state[activeStage] as any).mix} 
                    onChange={(v) => updateStage(activeStage as any, { mix: v })} 
                    unit="%"
                    color="rgb(59,130,246)"
                  />
                  <div className="flex-1 text-[9px] font-mono text-[#444] uppercase leading-relaxed">
                    Controls the dry/wet ratio of the signal path. At 100%, the signal is fully processed.
                  </div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="lg:col-span-8 bg-[#0a0a0c] border border-[#222] rounded-2xl p-10 flex items-center justify-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] pointer-events-none bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500 via-transparent to-transparent" />
          
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStage}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="w-full h-full flex flex-wrap gap-x-12 gap-y-10 justify-center items-center content-center"
            >
              {activeStage === 'chip' && (
                <ChipEditor state={state.chip} onChange={(c) => updateStage('chip', c)} />
              )}
              {activeStage === 'distortion' && (
                <DistortionEditor state={state.distortion} onChange={(d) => updateStage('distortion', d)} />
              )}
              {activeStage === 'chorus' && (
                <ChorusEditor state={state.chorus} onChange={(c) => updateStage('chorus', c)} />
              )}
              {activeStage === 'flanger' && (
                <FlangerEditor state={state.flanger} onChange={(f) => updateStage('flanger', f)} />
              )}
              {activeStage === 'delay' && (
                <DelayEditor state={state.delay} onChange={(d) => updateStage('delay', d)} />
              )}
              {activeStage === 'reverb' && (
                <ReverbEditor state={state.reverb} onChange={(r) => updateStage('reverb', r)} onLoadIR={onLoadIR} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

const ChipEditor = ({ state, onChange }: { state: ChipFX, onChange: (c: any) => void }) => (
  <div className="flex flex-col gap-6 w-full">
    <div className="flex flex-wrap gap-2 justify-center">
      {Object.values(CHIP_PROFILES).map((p) => (
        <button
          key={p.id}
          onClick={() => onChange({
            bitDepth: p.bitDepth,
            targetSR: p.targetSampleRate,
            antiAliasHz: p.antiAliasHz,
            dither: p.ditherLevel,
            driveCurve: p.driveCurve,
            quantStyle: p.quantStyle,
            wowHz: p.wowFlutter?.wowHz ?? 0.5,
            wowDepth: p.wowFlutter?.wowDepth ?? 0,
            flutterHz: p.wowFlutter?.flutterHz ?? 12,
            flutterDepth: p.wowFlutter?.flutterDepth ?? 0,
            jitter: p.jitterHz ? p.jitterHz / 100 : 0,
            hiss: Math.max(0, (120 + p.hissFloorDb) / 120),
          })}
          className="px-3 py-1.5 text-[9px] font-mono font-bold uppercase tracking-widest bg-[#111] text-[#777] border border-[#222] rounded hover:bg-[#222] transition-colors"
        >
          {p.label}
        </button>
      ))}
    </div>
    
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10 w-full">
      <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#555] uppercase font-mono">D/A Resolution</label>
              <div className="flex gap-1 bg-[#111] p-1 rounded border border-[#222]">
                  {[8, 12, 16, 24].map(v => (
                      <button key={v} onClick={() => onChange({ bitDepth: v })} className={`flex-1 py-1 text-[9px] font-mono font-bold rounded ${state.bitDepth === v ? 'bg-amber-600 text-white' : 'text-[#444]'}`}>{v}b</button>
                  ))}
              </div>
          </div>
          <Knob label="Sample Rate" min={400} max={48000} value={state.targetSR} onChange={(v) => onChange({ targetSR: v })} unit="Hz" color="#f59e0b" />
      </div>

      <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#555] uppercase font-mono">Quantize Style</label>
              <select value={state.quantStyle} onChange={(e) => onChange({ quantStyle: e.target.value })} className="bg-[#111] border border-[#222] text-[#aaa] text-[9px] font-mono px-2 py-1 rounded outline-none uppercase">
                  <option value="linear">Linear</option>
                  <option value="stepped">Stepped (Vintage)</option>
                  <option value="muLikeSoft">Soft-Knee (Tape)</option>
              </select>
          </div>
          <Knob label="Anti-Alias" min={0} max={20000} value={state.antiAliasHz} onChange={(v) => onChange({ antiAliasHz: v })} unit="Hz" color="#3b82f6" />
      </div>

      <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-4">
              <Knob label="Dither" min={0} max={1} value={state.dither} onChange={(v) => onChange({ dither: v })} decimals={2} color="#10b981" />
              <Knob label="Jitter" min={0} max={1} value={state.jitter} onChange={(v) => onChange({ jitter: v })} decimals={2} color="#f43f5e" />
          </div>
          <div className="grid grid-cols-2 gap-4">
              <Knob label="Hiss" min={0} max={1} value={state.hiss} onChange={(v) => onChange({ hiss: v })} decimals={2} color="#6366f1" />
              <Knob label="Drive" min={0} max={1} value={state.drive} onChange={(v) => onChange({ drive: v })} decimals={2} color="#ef4444" />
          </div>
      </div>

      <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
              <label className="text-[9px] font-bold text-[#555] uppercase font-mono">Wow & Flutter</label>
              <div className="grid grid-cols-2 gap-4 mt-1">
                  <Knob label="Wow Rate" min={0.1} max={5} value={state.wowHz} onChange={(v) => onChange({ wowHz: v })} unit="Hz" decimals={1} color="#a855f7" />
                  <Knob label="Wow Dpt" min={0} max={50} value={state.wowDepth} onChange={(v) => onChange({ wowDepth: v })} unit="c" color="#a855f7" />
              </div>
              <div className="grid grid-cols-2 gap-4 mt-2">
                  <Knob label="Flut Rate" min={5} max={30} value={state.flutterHz} onChange={(v) => onChange({ flutterHz: v })} unit="Hz" decimals={0} color="#ec4899" />
                  <Knob label="Flut Dpt" min={0} max={20} value={state.flutterDepth} onChange={(v) => onChange({ flutterDepth: v })} unit="c" color="#ec4899" />
              </div>
          </div>
      </div>
    </div>
  </div>
);

const DistortionEditor = ({ state, onChange }: { state: DistortionFX, onChange: (d: any) => void }) => (
  <div className="flex flex-col gap-8 w-full max-w-4xl">
    <div className="flex justify-center gap-12 items-end">
      <Knob label="DRIVE" min={0} max={100} value={state.drive} onChange={(v) => onChange({ drive: v })} unit="%" color="#ef4444" size="large" />
      
      <div className="flex flex-col gap-4 items-center">
        <label className="text-[10px] font-bold text-[#555] uppercase tracking-[0.3em] font-mono">Style</label>
        <div className="flex gap-2 bg-[#050505] p-2 rounded-xl border border-[#222] shadow-inner">
          {(['A', 'E', 'N', 'T', 'P'] as const).map(s => (
            <button 
              key={s}
              onClick={() => onChange({ style: s })}
              className={`w-10 h-10 rounded-lg font-mono font-black text-sm transition-all border ${
                state.style === s 
                  ? 'bg-red-600 border-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' 
                  : 'bg-[#111] border-[#222] text-[#444] hover:text-[#666]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <Knob label="OUTPUT" min={-24} max={12} value={state.outputTrim} onChange={(v) => onChange({ outputTrim: v })} unit="dB" color="#8b5cf6" size="large" />
    </div>

    <div className="grid grid-cols-3 gap-12 items-center border-t border-[#222]/30 pt-8">
      <Knob label="TONE" min={-100} max={100} value={state.tone} onChange={(v) => onChange({ tone: v })} decimals={0} color="#f59e0b" />
      
      <div className="flex flex-col items-center gap-2">
        <button 
          onClick={() => onChange({ punish: !state.punish })}
          className={`px-8 py-3 rounded-full font-mono font-black text-[10px] tracking-[0.3em] uppercase transition-all border-2 ${
            state.punish 
              ? 'bg-red-600 border-red-400 text-white shadow-[0_0_25px_rgba(239,68,68,0.6)] scale-105' 
              : 'bg-[#111] border-[#222] text-[#333]'
          }`}
        >
          PUNISH
        </button>
      </div>

      <div className="flex flex-col gap-1 text-center">
         <span className="text-[9px] font-mono text-[#444] uppercase leading-tight">Decapitator Modeling</span>
         <span className="text-[8px] font-mono text-[#222] uppercase tracking-tighter">Nonlinear Analog Saturation</span>
      </div>
    </div>
  </div>
);

const ChorusEditor = ({ state, onChange }: { state: ChorusFX, onChange: (c: any) => void }) => (
  <div className="flex flex-col gap-10 items-center">
    <div className="flex items-center gap-12">
      <div className="flex flex-col gap-3">
        <label className="text-[10px] font-bold text-[#555] uppercase tracking-[0.3em] font-mono text-center">Juno Modes</label>
        <div className="flex gap-4 bg-[#050505] p-3 rounded-2xl border border-[#222]">
          {(['I', 'II', 'I+II'] as const).map(m => (
            <button 
              key={m}
              onClick={() => onChange({ mode: m })}
              className={`w-14 h-14 rounded-full font-mono font-black text-xs transition-all border-2 flex items-center justify-center ${
                state.mode === m 
                  ? 'bg-blue-600 border-blue-400 text-white shadow-[0_0_20px_rgba(59,130,246,0.5)]' 
                  : 'bg-[#111] border-[#222] text-[#444]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      
      <div className="w-px h-24 bg-[#222]" />

      <div className="grid grid-cols-2 gap-10">
        <Knob label="SPREAD" min={0} max={100} value={state.spread} onChange={(v) => onChange({ spread: v })} unit="%" color="#3b82f6" />
        <div className="flex flex-col justify-center text-center max-w-[120px]">
           <span className="text-[10px] font-mono text-blue-500 font-black uppercase">Classic Chorus</span>
           <span className="text-[8px] font-mono text-[#444] uppercase mt-1 leading-tight">Modeled on 1984 BBD Modulation</span>
        </div>
      </div>
    </div>
  </div>
);

const FlangerEditor = ({ state, onChange }: { state: FlangerFX, onChange: (f: any) => void }) => (
  <div className="grid grid-cols-4 gap-12 items-center">
    <div className="flex flex-col gap-4">
      <label className="text-[10px] font-bold text-[#555] uppercase tracking-widest font-mono">BBD Type</label>
      <div className="flex flex-col gap-2">
        {(['classic', 'modern'] as const).map(t => (
          <button 
            key={t}
            onClick={() => onChange({ bbdType: t })}
            className={`px-4 py-2 rounded-lg font-mono font-bold text-[9px] uppercase transition-all border ${
              state.bbdType === t ? 'bg-pink-600 text-white border-pink-400 shadow-lg' : 'bg-[#111] border-[#222] text-[#444]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
    
    <Knob label="RATE" min={0.01} max={10} value={state.rateHz} onChange={(v) => onChange({ rateHz: v })} unit="Hz" decimals={2} color="#ec4899" />
    <Knob label="FEEDBACK" min={0} max={95} value={state.feedback} onChange={(v) => onChange({ feedback: v })} unit="%" color="#ec4899" />
    <Knob label="MIST" min={0} max={100} value={state.mist} onChange={(v) => onChange({ mist: v })} unit="%" color="#ec4899" />
  </div>
);

const DelayEditor = ({ state, onChange }: { state: DelayFX, onChange: (d: any) => void }) => (
  <div className="flex flex-col gap-10 w-full max-w-5xl">
    <div className="grid grid-cols-4 gap-12 items-end">
      <div className="flex flex-col gap-4">
        <label className="text-[10px] font-bold text-[#555] uppercase tracking-widest font-mono">Echo Mode</label>
        <select 
          value={state.style}
          onChange={(e) => onChange({ style: e.target.value })}
          className="bg-[#050505] border border-[#222] text-white text-[10px] font-mono font-bold px-4 py-3 rounded-xl outline-none focus:border-amber-500/50 transition-all uppercase"
        >
          <option value="studio">Studio Tape</option>
          <option value="magnetic">Magnetic Drum</option>
          <option value="analog">BBD Analog</option>
          <option value="telephone">Lo-Fi Radio</option>
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex bg-[#050505] p-1 rounded-lg border border-[#222] mb-3">
          <button onClick={() => onChange({ timeMode: 'free' })} className={`flex-1 py-1.5 text-[8px] font-mono font-bold rounded ${state.timeMode === 'free' ? 'bg-amber-600 text-white shadow-md' : 'text-[#444]'}`}>FREE</button>
          <button onClick={() => onChange({ timeMode: 'synced' })} className={`flex-1 py-1.5 text-[8px] font-mono font-bold rounded ${state.timeMode === 'synced' ? 'bg-amber-600 text-white shadow-md' : 'text-[#444]'}`}>SYNC</button>
        </div>
        {state.timeMode === 'free' ? (
          <Knob label="TIME" min={1} max={2000} value={state.timeMs} onChange={(v) => onChange({ timeMs: v })} unit="ms" color="#f59e0b" />
        ) : (
          <select 
            value={state.syncDivision}
            onChange={(e) => onChange({ syncDivision: e.target.value })}
            className="bg-[#050505] border border-[#222] text-amber-500 text-sm font-mono font-black px-2 py-3 rounded-xl outline-none uppercase text-center"
          >
            {['1/1', '1/2', '1/4', '1/4D', '1/8', '1/8D', '1/16', '1/32'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
      </div>

      <Knob label="FEEDBACK" min={0} max={110} value={state.feedback} onChange={(v) => onChange({ feedback: v })} unit="%" color="#f59e0b" />
      <Knob label="DUCKING" min={0} max={100} value={state.ducking} onChange={(v) => onChange({ ducking: v })} unit="%" color="#3b82f6" />
    </div>

    <div className="grid grid-cols-4 gap-12 border-t border-[#222]/30 pt-8">
      <Knob label="LOW CUT" min={20} max={2000} value={state.lowCut} onChange={(v) => onChange({ lowCut: v })} unit="Hz" color="#666" />
      <Knob label="HIGH CUT" min={500} max={15000} value={state.highCut} onChange={(v) => onChange({ highCut: v })} unit="Hz" color="#666" />
      
      <div className="flex flex-col justify-center items-center gap-3">
        <button 
          onClick={() => onChange({ pingPong: !state.pingPong })}
          className={`w-full py-3 rounded-xl border font-mono font-black text-[10px] tracking-widest transition-all ${state.pingPong ? 'bg-amber-600 border-amber-400 text-white shadow-xl' : 'bg-[#111] border-[#222] text-[#333]'}`}
        >
          PING-PONG
        </button>
      </div>

      <div className="flex flex-col justify-center text-center">
         <span className="text-[10px] font-mono text-amber-500 font-black uppercase">EchoBoy Modeling</span>
         <span className="text-[8px] font-mono text-[#444] uppercase mt-1 leading-tight">Multi-Style Delay with Sidechain Ducking</span>
      </div>
    </div>
  </div>
);

const ReverbEditor = ({ state, onChange, onLoadIR }: { state: ReverbFX, onChange: (r: any) => void, onLoadIR?: (buffer: ArrayBuffer, name: string) => void }) => {
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        const wavFiles = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith('.wav'));
        if (wavFiles.length > 0) {
          // Just grab the first WAV file in the zip for now
          const irFile = zip.files[wavFiles[0]];
          const buffer = await irFile.async('arraybuffer');
          onLoadIR?.(buffer, wavFiles[0]);
          onChange({ irName: wavFiles[0] });
        }
      } else if (file.name.toLowerCase().endsWith('.wav')) {
        const buffer = await file.arrayBuffer();
        onLoadIR?.(buffer, file.name);
        onChange({ irName: file.name });
      }
    } catch (err) {
      console.error('Failed to load IR:', err);
    }
  };

  return (
  <div className="flex flex-col gap-10 w-full max-w-4xl">
    <div className="flex justify-center gap-12 items-end">
      <div className="flex flex-col gap-4">
        <label className="text-[10px] font-bold text-[#555] uppercase tracking-widest font-mono">Reverb Mode</label>
        <div className="flex flex-col gap-2">
          {(['algorithmic', 'convolution'] as const).map(m => (
            <button 
              key={m}
              onClick={() => onChange({ mode: m })}
              className={`px-6 py-2 rounded-xl font-mono font-black text-[9px] uppercase transition-all border ${
                state.mode === m ? 'bg-emerald-600 text-white border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-[#111] border-[#222] text-[#444]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <label className="text-[10px] font-bold text-[#555] uppercase tracking-widest font-mono">Bricasti Preset</label>
        {state.mode === 'convolution' ? (
          <div className="flex flex-col gap-1 relative">
            <label className="bg-emerald-900/20 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded-xl font-mono text-[9px] font-bold flex items-center gap-2 cursor-pointer hover:bg-emerald-800/30 transition-colors">
              <FolderOpen className="w-3 h-3" /> {state.irName || 'LOAD M7 IR (Samplicity)'}
              <input type="file" accept=".zip,.wav" className="hidden" onChange={handleFileUpload} />
            </label>
            <span className="text-[7px] text-[#444] font-mono uppercase mt-1">M7 V2 IR Pack - 2023.10 Edition</span>
          </div>
        ) : (
          <select 
            value={state.type}
            onChange={(e) => onChange({ type: e.target.value })}
            className="bg-[#050505] border border-[#222] text-[#888] text-[10px] font-mono font-bold px-4 py-3 rounded-xl outline-none uppercase"
          >
            <option value="room">Small Room</option>
            <option value="hall">Large Concert Hall</option>
            <option value="plate">Lexicon Plate</option>
            <option value="ambient">Space Ambient</option>
          </select>
        )}
      </div>

      <Knob label="DECAY" min={0.1} max={10} value={state.decay / 10} onChange={(v) => onChange({ decay: v * 10 })} unit="s" decimals={1} color="#10b981" size="large" />
    </div>

    <div className="grid grid-cols-3 gap-12 border-t border-[#222]/30 pt-8">
      <Knob label="SIZE" min={1} max={100} value={state.size} onChange={(v) => onChange({ size: v })} unit="%" color="#10b981" />
      <Knob label="PRE-DELAY" min={0} max={250} value={state.preDelayMs} onChange={(v) => onChange({ preDelayMs: v })} unit="ms" color="#10b981" />
      <Knob label="DAMPING" min={0} max={100} value={state.damping} onChange={(v) => onChange({ damping: v })} unit="%" color="#10b981" />
    </div>
  </div>
  );
};
