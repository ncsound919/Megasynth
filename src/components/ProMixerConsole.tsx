import React, { useMemo, useState } from 'react';
import { Radio, Waves, Settings2, Target, Activity } from 'lucide-react';
import { Knob } from './Knob';
import { TactileButton } from './TactileButton';
import { ChannelState, MasterState } from '../types';
import { ParametricEQ } from './ParametricEQ';

// ──────────────────────────────────────────────
// Real dB conversion
// ──────────────────────────────────────────────
const linearToDb = (v: number) => (20 * Math.log10(Math.max(v, 1e-6))).toFixed(1);

export interface ProMixerConsoleProps {
  channels: ChannelState[];
  master: MasterState;
  peakLevels: Record<string, number>;
  peakLEDs: Record<string, boolean>;
  masterGainReductionDb: number;
  analysers: Record<string, AnalyserNode>;
  audioContext: AudioContext | null;
  onChannelChange: (chId: string, path: string, value: any) => void;
  onMasterChange: (path: string, value: any) => void;
  activeColor?: string;
}

const VUMeter: React.FC<{ level: number; peak: boolean }> = ({ level, peak }) => {
  // BUG FIX: `level` can arrive as NaN (see masterPeak fix below for how this happens
  // upstream); Math.log10(NaN) -> NaN -> parseFloat(NaN.toFixed(1)) -> NaN -> an invalid
  // "NaN%" CSS height, which the browser silently ignores, freezing the bar at its last
  // rendered value instead of showing silence. Guard here too so this component is safe
  // regardless of what any caller passes in.
  const safeLevel = Number.isFinite(level) ? level : 0;
  const db = linearToDb(safeLevel);
  const pct = Math.min(100, Math.max(0, (parseFloat(db) + 60) * (100 / 60)));
  return (
    <div className="flex flex-col items-center w-8">
      <div className="w-6 h-20 bg-[#0a0a0a] border border-[#222] rounded-sm relative overflow-hidden">
        <div
          className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 transition-all duration-75"
          style={{ height: `${pct}%` }}
        />
        {peak && (
          <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_6px_red]" />
        )}
      </div>
    </div>
  );
};

const GRMeter: React.FC<{ gainReductionDb: number }> = ({ gainReductionDb }) => {
  const pct = Math.max(0, Math.min(100, (gainReductionDb / 20) * 100));
  return (
    <div className="bg-[#070707] border border-[#1a1a1a] p-2 rounded">
      <div className="flex justify-between text-[7px] font-mono text-[#444]">
        <span>-20</span><span>-10</span><span>-3</span><span>0</span>
      </div>
      <div className="w-full h-2 bg-[#151515] rounded overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-400 via-yellow-500 to-red-500 transition-all duration-75"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[7px] font-mono text-amber-500/80 text-center block mt-1">
        GR -{gainReductionDb.toFixed(1)}dB
      </span>
    </div>
  );
};

const VerticalFader: React.FC<{
  value: number; min: number; max: number; onChange: (v: number) => void; label: string;
}> = ({ value, min, max, onChange, label }) => (
  <div className="flex flex-col items-center h-full justify-center relative w-10">
    <div className="absolute inset-y-2 w-2 bg-gradient-to-b from-[#0a0a0a] to-[#151515] border border-[#2a2a2a] rounded-full shadow-inner pointer-events-none" />
    <input
      type="range" min={min} max={max} step={(max - min) / 100} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      aria-label={label}
      className="w-32 h-10 appearance-none bg-transparent outline-none cursor-ns-resize transform -rotate-90"
      style={{
        WebkitAppearance: 'slider-vertical',
      } as React.CSSProperties}
    />
  </div>
);

const ChannelStrip: React.FC<{
  ch: ChannelState;
  peakLevel: number;
  peakLED: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onChannelChange: (chId: string, path: string, value: any) => void;
  activeColor: string;
}> = React.memo(({ ch, peakLevel, peakLED, isSelected, onSelect, onChannelChange, activeColor }) => {
  return (
    <div 
      className={`
        flex flex-col items-center border rounded-lg p-3 w-32 transition-all
        ${isSelected ? 'bg-slate-900 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'bg-[#0b0b0b] border-[#1a1a1a]'}
      `}
      onClick={onSelect}
    >
      <div className="flex items-center gap-1.5 mb-3 w-full justify-center border-b border-[#222] pb-2">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: peakLED ? '#f59e0b' : '#1a110a', boxShadow: peakLED ? '0 0 8px #f59e0b' : 'none' }} />
        <span className="text-[10px] font-mono font-black text-[#888] uppercase truncate max-w-[80px]">{ch.label}</span>
      </div>

      <div className="flex gap-4 mb-2">
        <VUMeter level={peakLevel} peak={peakLED} />
        <div className="h-32 flex items-center justify-center">
          <VerticalFader min={0} max={1.2} value={ch.volume} onChange={(v) => onChannelChange(ch.id, 'volume', v)} label={`${ch.label} volume`} />
        </div>
      </div>

      <div className="w-full flex flex-col gap-3 mt-2">
        <div className="flex gap-2">
          <TactileButton active={ch.soloed} onClick={(e) => { e.stopPropagation(); onChannelChange(ch.id, 'soloed', !ch.soloed); }} label="" icon={<span className="text-[9px] font-bold">S</span>} color="#f59e0b" className="h-6 flex-1" />
          <TactileButton active={ch.muted} onClick={(e) => { e.stopPropagation(); onChannelChange(ch.id, 'muted', !ch.muted); }} label="" icon={<span className="text-[9px] font-bold">M</span>} color="#ef4444" className="h-6 flex-1" />
        </div>
        
        <div className="flex justify-center my-1">
          <Knob label="PAN" min={-1} max={1} value={ch.pan} onChange={(v) => onChannelChange(ch.id, 'pan', v)} decimals={1} color={activeColor} size="small" />
        </div>

        <button 
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className={`
            w-full py-1.5 rounded text-[9px] font-bold tracking-widest uppercase transition-all border
            ${isSelected ? 'bg-amber-500/20 text-amber-500 border-amber-500/40' : 'bg-slate-800/40 text-slate-500 border-slate-700/50 hover:bg-slate-800 hover:text-slate-300'}
          `}
        >
          {isSelected ? 'Focusing' : 'Focus EQ'}
        </button>
      </div>
    </div>
  );
});

export const ProMixerConsole: React.FC<ProMixerConsoleProps> = ({
  channels, master, peakLevels, peakLEDs, masterGainReductionDb, analysers, audioContext, onChannelChange, onMasterChange, activeColor = '#f59e0b',
}) => {
  const [selectedChannelId, setSelectedChannelId] = useState(channels[0]?.id);
  const selectedChannel = useMemo(() => channels.find(ch => ch.id === selectedChannelId) || channels[0], [channels, selectedChannelId]);

  const masterPeak = useMemo(() => {
    // BUG FIX: Math.max(...vals) returns NaN if ANY value in peakLevels is NaN (e.g. a
    // transient analyser read during engine init/reconnect), which then poisons every
    // VU meter on the master bus — not just the affected channel. Filter to finite
    // values before reducing so one bad reading can't blank the whole master display.
    const vals = (Object.values(peakLevels) as number[]).filter(Number.isFinite);
    if (vals.length === 0) return 0;
    return Math.max(...vals);
  }, [peakLevels]);

  // BUG FIX: selectedChannel can be undefined if `channels` is ever empty (e.g. during
  // initial load before the engine populates channels, or if the user removes every
  // channel). Every other read of it was optional-chained (`selectedChannel?.label`)
  // except the ParametricEQ props below, which would throw on `selectedChannel.eq`.
  // Guard the whole focused-EQ section instead of crashing the console.
  if (!selectedChannel) {
    return (
      <div className="flex-1 flex flex-col bg-[#080808]/90 border border-[#222]/30 rounded-xl overflow-hidden shadow-2xl items-center justify-center">
        <span className="text-[10px] font-mono text-[#555] uppercase tracking-widest">No channels loaded</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#080808]/90 border border-[#222]/30 rounded-xl overflow-hidden shadow-2xl">
      <div className="bg-[#0a0a0a]/90 border-b border-[#222] px-4 py-2 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-amber-500 animate-pulse" />
          <span className="text-xs font-mono font-black text-white tracking-widest uppercase">SSL-9000J Console</span>
        </div>
        <div className="flex gap-3 text-[9px] font-mono text-[#555]">
          <span className="flex items-center gap-1"><Waves className="w-3 h-3" /> {channels.length} Mono/Stereo Inputs</span>
          <span>|</span>
          <span className="flex items-center gap-1"><Activity className="w-3 h-3" /> G-Series Bus Compressor Active</span>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Mixer Area (Channels + EQ below) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Channels Row */}
          <div className="shrink-0 overflow-x-auto border-b border-[#222] bg-[#050505]">
            <div className="flex gap-2 p-3 min-w-max">
              {channels.map((ch) => (
                <ChannelStrip 
                  key={ch.id} 
                  ch={ch} 
                  peakLevel={peakLevels[ch.id] || 0} 
                  peakLED={peakLEDs[ch.id] || false} 
                  isSelected={selectedChannelId === ch.id}
                  onSelect={() => setSelectedChannelId(ch.id)}
                  onChannelChange={onChannelChange} 
                  activeColor={activeColor} 
                />
              ))}
            </div>
          </div>

          {/* Focused Channel EQ (Below Channels) */}
          <div className="flex-1 bg-[#0a0a0a] p-4 border-t border-[#222] overflow-hidden flex flex-col">
            <h3 className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-[0.2em] border-b border-slate-800/60 pb-2 mb-4 flex items-center gap-2">
              <Target className="w-3 h-3 text-orange-500" /> 
              Focused Channel: <span className="text-white">{selectedChannel.label}</span> | Parametric EQ
            </h3>
            <div className="flex-1 min-h-0">
              <ParametricEQ 
                bands={selectedChannel.eq}
                onBandsChange={(newBands) => onChannelChange(selectedChannel.id, 'eq', newBands)}
                analyserNode={analysers[selectedChannel.id] || null}
                audioContext={audioContext}
                activeColor={activeColor}
              />
            </div>
          </div>
        </div>

        {/* Master Sidebar (beside channels) */}
        <div className="w-[180px] shrink-0 bg-[#0c0c0c] border-l border-[#222] p-3 flex flex-col gap-4 overflow-y-auto no-scrollbar">
          <div className="flex flex-col items-center gap-1 mb-2">
            <span className="text-[10px] font-mono font-black text-amber-500 uppercase tracking-widest">Master Bus</span>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-[#333] to-transparent" />
          </div>

          {/* SSL Bus Compressor Section */}
          <div className="bg-[#111] border border-[#222] rounded-lg p-3 space-y-3 shadow-inner">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-[#555] uppercase tracking-widest">Bus Comp</span>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" />
            </div>
            
            <GRMeter gainReductionDb={masterGainReductionDb} />

            <div className="grid grid-cols-1 gap-4 mt-2">
              <Knob label="THRESHOLD" min={-40} max={20} value={master.busCompThreshold} onChange={(v) => onMasterChange('busCompThreshold', v)} unit="dB" decimals={0} color="#f59e0b" size="small" />
              <div className="grid grid-cols-2 gap-2">
                <Knob label="RATIO" min={1} max={20} value={master.busCompRatio} onChange={(v) => onMasterChange('busCompRatio', v)} unit=":1" decimals={0} color="#f59e0b" size="small" />
                <Knob label="MAKEUP" min={0} max={20} value={master.busCompMakeup} onChange={(v) => onMasterChange('busCompMakeup', v)} unit="dB" decimals={0} color="#f59e0b" size="small" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Knob label="ATTACK" min={0.1} max={120} value={master.busCompAttack} onChange={(v) => onMasterChange('busCompAttack', v)} unit="ms" decimals={1} color="#f59e0b" size="small" />
                <Knob label="RELEASE" min={0.01} max={2.0} value={master.busCompRelease} onChange={(v) => onMasterChange('busCompRelease', v)} unit="s" decimals={2} color="#f59e0b" size="small" />
              </div>
            </div>
          </div>

          {/* Master Output Meter & Fader */}
          <div className="flex-1 bg-[#111] border border-[#222] rounded-lg p-3 flex flex-col items-center justify-between shadow-inner min-h-[200px]">
            <div className="w-full space-y-2">
              <span className="text-[9px] font-bold text-[#555] uppercase tracking-widest block text-center">Output</span>
              <div className="flex justify-center gap-1 h-24">
                <VUMeter level={masterPeak} peak={masterPeak > 0.9} />
                <VUMeter level={masterPeak * 0.95} peak={masterPeak > 0.9} />
              </div>
            </div>

            <div className="h-32">
               <VerticalFader min={0} max={1.2} value={master.volume} onChange={(v) => onMasterChange('volume', v)} label="Master Output" />
            </div>
            
            <div className="w-full mt-4">
               <Knob label="SATURATION" min={0} max={100} value={master.neveDrive} onChange={(v) => onMasterChange('neveDrive', v)} unit="%" color="#f59e0b" size="small" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
