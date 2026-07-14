import React from 'react';
import { Sliders } from 'lucide-react';
import { Knob } from './Knob';
import { SynthParams } from '../types';

interface MixerConsoleProps {
  mixer: Record<string, { volume: number; pan: number; muted: boolean; soloed: boolean; outputRoute: 'master' | 'out2' | 'out3' | 'out4' }>;
  peakLEDs: Record<string, boolean>;
  params: SynthParams;
  activeColor: string;
  handleMixerChange: (chId: string, field: string, val: any) => void;
  handleParamChange: (key: keyof SynthParams, val: any) => void;
}

export const MixerConsole: React.FC<MixerConsoleProps> = ({
  mixer,
  peakLEDs,
  params,
  activeColor,
  handleMixerChange,
  handleParamChange
}) => {
  return (
    <div className="flex-1 flex flex-col bg-[#080808]/75 border border-[#222]/30 p-5 rounded-xl">
      <div className="flex justify-between items-center mb-5 border-b border-[#222]/20 pb-3">
        <span className="text-white text-xs font-bold font-mono tracking-widest uppercase flex items-center gap-1.5">
          <Sliders className="w-4 h-4 text-blue-500" />
          MULTI-OUTPUT ROUTING MIXING CONSOLE
        </span>
        <span className="text-[9px] text-[#555] font-mono uppercase font-bold">
          5 Channel Strips | Independent Panning & Auxiliary Routing
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
        
        {/* Channel fader strips */}
        <div className="md:col-span-9 grid grid-cols-5 gap-3.5 bg-[#0a0a0a] p-4 rounded-xl border border-[#1c1c1c] shadow-md">
          {Object.keys(mixer).map(chId => {
            const ch = mixer[chId];
            const isLEDFlashed = peakLEDs[chId];

            return (
              <div key={chId} className="flex flex-col items-center bg-[#0d0d0d] border border-[#1a1a1a] rounded-lg p-3 shadow-inner">
                {/* Channel title & peak flash */}
                <div className="flex items-center gap-1.5 mb-3.5">
                  <div 
                    className="w-1.5 h-1.5 rounded-full transition-all duration-100"
                    style={{
                      backgroundColor: isLEDFlashed ? 'rgb(245,158,11)' : '#1a110a',
                      boxShadow: isLEDFlashed ? '0 0 10px rgb(245,158,11), 0 0 4px rgb(245,158,11)' : 'none'
                    }}
                  />
                  <span className="text-[9px] font-mono font-black text-[#888] uppercase tracking-wider">{chId}</span>
                </div>

                {/* Volume Slider (Fader) */}
                <div className="flex flex-col items-center h-32 justify-center relative">
                  <input
                    type="range"
                    min="0"
                    max="1.2"
                    step="0.05"
                    value={ch.volume}
                    onChange={(e) => handleMixerChange(chId, 'volume', parseFloat(e.target.value))}
                    className="accent-amber-500 bg-[#060606] border border-[#151515] rounded cursor-row-resize h-28"
                    style={{ WebkitAppearance: 'slider-vertical', writingMode: 'bt-lr' } as any}
                  />
                </div>

                {/* Decibel Display */}
                <span className="text-[8px] font-mono text-[#555] mt-1.5 font-bold">
                  {(ch.volume * 10).toFixed(1)} dB
                </span>

                {/* Pan Dial */}
                <div className="mt-3.5 scale-90">
                  <Knob
                    label="PAN"
                    min={-1.0}
                    max={1.0}
                    value={ch.pan}
                    onChange={(v) => handleMixerChange(chId, 'pan', v)}
                    decimals={1}
                    color={activeColor}
                  />
                </div>

                {/* Solo & Mute Buttons */}
                <div className="flex gap-1 justify-center mt-3 w-full">
                  <button
                    onClick={() => handleMixerChange(chId, 'soloed', !ch.soloed)}
                    className={`flex-1 h-5 rounded text-[8px] font-mono font-bold flex items-center justify-center border transition ${
                      ch.soloed 
                        ? 'bg-amber-500/10 text-amber-500 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.2)]' 
                        : 'bg-[#121212] border-[#222] text-[#444] hover:text-[#777]'
                    }`}
                  >
                    S
                  </button>
                  <button
                    onClick={() => handleMixerChange(chId, 'muted', !ch.muted)}
                    className={`flex-1 h-5 rounded text-[8px] font-mono font-bold flex items-center justify-center border transition ${
                      ch.muted 
                        ? 'bg-red-500/15 text-red-400 border-red-500/40 shadow-[0_0_8px_rgba(239,68,68,0.2)]' 
                        : 'bg-[#121212] border-[#222] text-[#444] hover:text-[#777]'
                    }`}
                  >
                    M
                  </button>
                </div>

                {/* Routing Dropdown */}
                <div className="mt-3.5 w-full">
                  <select
                    value={ch.outputRoute}
                    onChange={(e) => handleMixerChange(chId, 'outputRoute', e.target.value as any)}
                    className="bg-[#050505] border border-[#222] text-[#555] hover:text-white text-[8px] font-mono rounded px-1 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-amber-500 transition cursor-pointer text-center"
                  >
                    <option value="master">Out 1 (Master)</option>
                    <option value="out2">Out 2 (Sub)</option>
                    <option value="out3">Out 3 (FX)</option>
                    <option value="out4">Out 4 (Aux)</option>
                  </select>
                </div>

              </div>
            );
          })}
        </div>

        {/* Master Compressor & Sidechain Meter Panel */}
        <div className="md:col-span-3 flex flex-col justify-between bg-[#0a0a0a] border border-[#1c1c1c] rounded-xl p-4 shadow-md">
          <div className="space-y-4">
            <span className="text-[10px] font-bold font-mono tracking-widest text-amber-500 uppercase block">BUS COMPRESSION</span>
            
            {/* Master Pro-Audio Strip */}
            <div className="mt-2 pt-4 border-t border-[#222]/50 space-y-4">
              <span className="text-[10px] font-bold font-mono tracking-widest text-blue-400 uppercase block">MASTER PRO-STRIP</span>
              <div className="grid grid-cols-2 gap-4">
                <Knob 
                  label="NEVE DRIVE" 
                  min={0} max={100} 
                  value={params.neveDrive ?? 20} 
                  onChange={(v) => handleParamChange('neveDrive', v)} 
                  unit="%" decimals={0} color="rgb(59,130,246)" 
                />
                <Knob 
                  label="STEREO WIDTH" 
                  min={0} max={100} 
                  value={params.mixerWidth ?? 50} 
                  onChange={(v) => handleParamChange('mixerWidth', v)} 
                  unit="%" decimals={0} color="rgb(59,130,246)" 
                />
              </div>
            </div>

            <p className="text-[9px] font-mono text-[#444] leading-relaxed uppercase">
              PULTEC STYLE BUS LIMITER LINKED TO SUB-BASS TRANSIENT ENVELOPES:
            </p>

            {/* Ducking VU Gain Reduction Meter */}
            <div className="bg-[#070707] border border-[#1a1a1a] p-3 rounded-lg flex flex-col gap-1.5 shadow-inner">
              <div className="flex justify-between text-[8px] font-mono font-bold text-[#444]">
                <span>-12 dB</span>
                <span>-6 dB</span>
                <span>-3 dB</span>
                <span>0 dB</span>
              </div>
              <div className="w-full bg-[#151515] h-3 rounded overflow-hidden relative border border-[#121212]">
                <div 
                  className="bg-amber-500 h-full origin-right transition-all duration-75"
                  style={{
                    width: `${100 - (peakLEDs.sub ? (params.sidechainGain ?? 50) * 0.8 : 0)}%`,
                    marginLeft: 'auto'
                  }}
                />
              </div>
              <span className="text-[8px] font-mono font-extrabold text-amber-500/80 text-center uppercase tracking-wider block">
                GR Meter (Pumping Active)
              </span>
            </div>
          </div>

          <div className="p-3 bg-[#0d0d0d] border border-[#151515] rounded-lg mt-3.5">
            <span className="text-[8px] font-mono text-[#666] font-bold block uppercase tracking-wide mb-1">PRO-MIX ROUTING</span>
            <p className="text-[8px] font-mono text-[#444] leading-relaxed">
              Out 2-4 connect directly to custom sub-mixing nodes bypasses main Pultec saturator chain, allowing independent channel processing.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
