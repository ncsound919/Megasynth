import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings2, MousePointer2, Trash2 } from 'lucide-react';
import { EQBand } from '../types';

interface ParametricEQProps {
  bands: EQBand[];
  onBandsChange: (bands: EQBand[]) => void;
  analyserNode: AnalyserNode | null;
  audioContext: AudioContext | null;
  activeColor?: string;
}

const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const GAIN_MIN = -24;
const GAIN_MAX = 24;
const MAX_BANDS = 8;

const freqToX = (freq: number, width: number) =>
  (Math.log10(freq / FREQ_MIN) / Math.log10(FREQ_MAX / FREQ_MIN)) * width;

const xToFreq = (x: number, width: number) =>
  FREQ_MIN * Math.pow(10, (x / width) * Math.log10(FREQ_MAX / FREQ_MIN));

const gainToY = (gain: number, height: number) =>
  height / 2 - (gain / GAIN_MAX) * (height / 2);

const yToGain = (y: number, height: number) =>
  ((height / 2 - y) / (height / 2)) * GAIN_MAX;

export const ParametricEQ: React.FC<ParametricEQProps> = ({
  bands,
  onBandsChange,
  analyserNode,
  audioContext,
  activeColor = '#3b82f6',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeBandIndex, setActiveBandIndex] = useState<number | null>(null);
  const [hoveredBandIndex, setHoveredBandIndex] = useState<number | null>(null);
  const [responseCurve, setResponseCurve] = useState<Float32Array | null>(null);

  // ---- Reusable filter bank for frequency response calculation ----
  const filterBankRef = useRef<BiquadFilterNode[]>([]);
  const filterBankInit = useRef(false);

  const updateResponseCurve = useCallback(() => {
    if (!audioContext) return;

    const width = 1000; // logical width
    const magResponse = new Float32Array(width);
    const phaseResponse = new Float32Array(width);
    const freqs = new Float32Array(width);

    for (let i = 0; i < width; i++) {
      freqs[i] = xToFreq(i, width);
    }

    const totalMag = new Float32Array(width).fill(1);

    // Ensure we have enough reusable filters (lazy creation)
    const filters = filterBankRef.current;
    if (!filterBankInit.current) {
      // Initialize once with a sufficient number
      for (let i = 0; i < MAX_BANDS; i++) {
        filters.push(audioContext.createBiquadFilter());
      }
      filterBankInit.current = true;
    }

    bands.forEach((band, idx) => {
      if (!band.enabled) return;
      const filter = filters[idx];
      if (!filter) return; // safety

      filter.type = band.type;
      filter.frequency.value = band.freq;
      filter.Q.value = band.q;
      filter.gain.value = band.gain;

      filter.getFrequencyResponse(freqs, magResponse, phaseResponse);
      for (let i = 0; i < width; i++) {
        totalMag[i] *= magResponse[i];
      }
    });

    setResponseCurve(totalMag);
  }, [audioContext, bands]);

  useEffect(() => {
    updateResponseCurve();
  }, [updateResponseCurve]);

  // ---- Global mouseup to reliably end dragging ----
  useEffect(() => {
    const handleGlobalMouseUp = () => setActiveBandIndex(null);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // ---- Canvas drawing loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const draw = () => {
      const { width, height } = canvas;

      ctx.clearRect(0, 0, width, height);

      // Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
        const x = freqToX(f, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.font = '10px Inter, sans-serif';
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, height - 5);
      });

      [-18, -12, -6, 0, 6, 12, 18].forEach((g) => {
        const y = gainToY(g, height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        if (g !== 0) {
          ctx.fillText(`${g > 0 ? '+' : ''}${g}dB`, 5, y - 2);
        }
      });

      // Spectrum analyzer (if available)
      if (analyserNode && audioContext) {
        const dataArray = new Uint8Array(analyserNode.frequencyBinCount);
        analyserNode.getByteFrequencyData(dataArray);
        const sampleRate = audioContext.sampleRate;

        ctx.beginPath();
        ctx.strokeStyle = `${activeColor}44`;
        ctx.lineWidth = 1.5;

        for (let i = 0; i < width; i++) {
          const freq = xToFreq(i, width);
          const bin = Math.min(
            Math.floor((freq / (sampleRate / 2)) * dataArray.length),
            dataArray.length - 1
          );
          const val = dataArray[bin] / 255;
          const y = height - val * height * 0.8;
          if (i === 0) ctx.moveTo(i, y);
          else ctx.lineTo(i, y);
        }
        ctx.stroke();

        // Fill gradient
        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, `${activeColor}22`);
        grad.addColorStop(1, 'transparent');
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Response curve
      if (responseCurve) {
        ctx.beginPath();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `${activeColor}88`;

        for (let i = 0; i < width; i++) {
          const db = 20 * Math.log10(Math.max(responseCurve[i], 1e-6));
          const y = gainToY(db, height);
          if (i === 0) ctx.moveTo(i, y);
          else ctx.lineTo(i, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Band nodes
      bands.forEach((band, i) => {
        if (!band.enabled) return;
        const x = freqToX(band.freq, width);
        const y = gainToY(band.gain, height);
        const isActive = i === activeBandIndex || i === hoveredBandIndex;

        ctx.beginPath();
        ctx.arc(x, y, isActive ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = band.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (isActive) {
          ctx.beginPath();
          ctx.arc(x, y, 14, 0, Math.PI * 2);
          ctx.strokeStyle = `${band.color}44`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    analyserNode,
    audioContext,
    bands,
    responseCurve,
    activeColor,
    activeBandIndex,
    hoveredBandIndex,
  ]);

  // ---- Interactive handlers ----
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = bands.findIndex((band) => {
      if (!band.enabled) return false;
      const bx = freqToX(band.freq, rect.width);
      const by = gainToY(band.gain, rect.height);
      return Math.hypot(x - bx, y - by) < 20;
    });

    if (hit !== -1) {
      setActiveBandIndex(hit);
      e.stopPropagation();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeBandIndex !== null) {
      const newFreq = Math.min(FREQ_MAX, Math.max(FREQ_MIN, xToFreq(x, rect.width)));
      const newGain = Math.min(GAIN_MAX, Math.max(GAIN_MIN, yToGain(y, rect.height)));

      const updated = [...bands];
      updated[activeBandIndex] = { ...updated[activeBandIndex], freq: newFreq, gain: newGain };
      onBandsChange(updated);
    } else {
      const hoverIdx = bands.findIndex((band) => {
        if (!band.enabled) return false;
        const bx = freqToX(band.freq, rect.width);
        const by = gainToY(band.gain, rect.height);
        return Math.hypot(x - bx, y - by) < 20;
      });
      setHoveredBandIndex(hoverIdx !== -1 ? hoverIdx : null);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (bands.length >= MAX_BANDS) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const freq = xToFreq(x, rect.width);
    const gain = yToGain(y, rect.height);

    const newBand: EQBand = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 9),
      type: 'peaking',
      freq,
      gain,
      q: 1.0,
      enabled: true,
      color: activeColor,
    };
    onBandsChange([...bands, newBand]);
  };

  const handleDeleteBand = (index: number) => {
    const updated = bands.filter((_, i) => i !== index);
    onBandsChange(updated);
    setActiveBandIndex(null);
    setHoveredBandIndex(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (hoveredBandIndex === null) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const updated = [...bands];
    const band = updated[hoveredBandIndex];
    updated[hoveredBandIndex] = {
      ...band,
      q: Math.min(10, Math.max(0.1, band.q * delta)),
    };
    onBandsChange(updated);
  };

  // ---- Floating tooltip for active/hovered band ----
  const tooltipBand = activeBandIndex !== null ? bands[activeBandIndex] : hoveredBandIndex !== null ? bands[hoveredBandIndex] : null;

  return (
    <div className="flex flex-col h-full bg-slate-950/40 rounded-xl border border-slate-800/60 overflow-hidden group">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900/40 border-b border-slate-800/40">
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold tracking-widest text-slate-300 uppercase">Graphical EQ</span>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-slate-500 font-mono">
          <span className="flex items-center gap-1">
            <MousePointer2 className="w-3 h-3" /> DRAG
          </span>
          <span className="flex items-center gap-1">
            <MousePointer2 className="w-3 h-3 rotate-90" /> SCROLL Q
          </span>
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 relative cursor-crosshair overflow-hidden"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          width={1000}
          height={400}
          className="w-full h-full"
        />

        {/* Floating tooltip */}
        <AnimatePresence>
          {tooltipBand && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 px-4 py-2 bg-slate-900/95 border border-slate-700 rounded-lg shadow-2xl backdrop-blur-md flex items-center gap-6 pointer-events-none z-10"
            >
              {/* Inner controls use pointer-events-auto */}
              <div className="flex items-center gap-6">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Freq</span>
                  <span className="text-sm font-mono text-white">
                    {tooltipBand.freq >= 1000 ? `${(tooltipBand.freq / 1000).toFixed(2)}k` : Math.round(tooltipBand.freq)}Hz
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Gain</span>
                  <span className="text-sm font-mono text-white">
                    {tooltipBand.gain > 0 ? '+' : ''}{tooltipBand.gain.toFixed(1)}dB
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-bold uppercase">Q</span>
                  <span className="text-sm font-mono text-white">{tooltipBand.q.toFixed(2)}</span>
                </div>

                {/* Type selector */}
                <select
                  className="bg-slate-800 text-[10px] font-bold text-slate-300 uppercase rounded px-2 py-1 outline-none pointer-events-auto"
                  value={tooltipBand.type}
                  onChange={(e) => {
                    const updated = [...bands];
                    const idx = activeBandIndex ?? hoveredBandIndex;
                    if (idx !== null) {
                      updated[idx] = { ...updated[idx], type: e.target.value as any };
                      onBandsChange(updated);
                    }
                  }}
                >
                  <option value="peaking">Peaking</option>
                  <option value="lowshelf">Low Shelf</option>
                  <option value="highshelf">High Shelf</option>
                  <option value="lowpass">Low Pass</option>
                  <option value="highpass">High Pass</option>
                  <option value="bandpass">Band Pass</option>
                  <option value="notch">Notch</option>
                </select>

                {/* Delete button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteBand(activeBandIndex ?? hoveredBandIndex ?? 0);
                  }}
                  className="text-red-500 hover:text-red-400 pointer-events-auto"
                  title="Delete Band"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom band controls strip – flexible wrap */}
      <div className="flex flex-wrap gap-2 p-2 bg-slate-900/60 border-t border-slate-800/40 overflow-x-auto">
        {bands.map((band, index) => (
          <div key={band.id} className="flex-1 min-w-[140px] max-w-[200px] p-2 bg-slate-900/40 rounded border border-slate-800/60 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <button
                onClick={() => {
                  const updated = [...bands];
                  updated[index] = { ...updated[index], enabled: !band.enabled };
                  onBandsChange(updated);
                }}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold transition ${
                  band.enabled ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{ backgroundColor: band.enabled ? band.color : '#334155' }}
                />
                B{index + 1}
              </button>
              <button
                onClick={() => handleDeleteBand(index)}
                className="text-slate-600 hover:text-red-500 transition"
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            <select
              className="bg-slate-900 text-[9px] font-bold text-slate-400 uppercase rounded px-1 py-0.5 outline-none border border-slate-700"
              value={band.type}
              onChange={(e) => {
                const updated = [...bands];
                updated[index] = { ...updated[index], type: e.target.value as any };
                onBandsChange(updated);
              }}
            >
              <option value="peaking">Peaking</option>
              <option value="lowshelf">Low Shelf</option>
              <option value="highshelf">High Shelf</option>
              <option value="lowpass">Low Pass</option>
              <option value="highpass">High Pass</option>
              <option value="bandpass">Band Pass</option>
              <option value="notch">Notch</option>
            </select>

            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              <div className="flex flex-col bg-[#111] p-1 rounded border border-slate-800">
                <span className="text-slate-500 font-bold uppercase text-[8px]">Freq</span>
                <input
                  type="number"
                  value={Math.round(band.freq)}
                  onChange={(e) => {
                    const updated = [...bands];
                    updated[index] = { ...updated[index], freq: Number(e.target.value) };
                    onBandsChange(updated);
                  }}
                  className="bg-transparent text-white w-full outline-none"
                />
              </div>
              <div className="flex flex-col bg-[#111] p-1 rounded border border-slate-800">
                <span className="text-slate-500 font-bold uppercase text-[8px]">Gain</span>
                <input
                  type="number"
                  value={band.gain.toFixed(1)}
                  step="0.1"
                  onChange={(e) => {
                    const updated = [...bands];
                    updated[index] = { ...updated[index], gain: Number(e.target.value) };
                    onBandsChange(updated);
                  }}
                  className="bg-transparent text-white w-full outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
              <div className="flex flex-col bg-[#111] p-1 rounded border border-slate-800">
                <span className="text-slate-500 font-bold uppercase text-[8px]">Q</span>
                <input
                  type="number"
                  value={band.q.toFixed(2)}
                  step="0.1"
                  onChange={(e) => {
                    const updated = [...bands];
                    updated[index] = { ...updated[index], q: Number(e.target.value) };
                    onBandsChange(updated);
                  }}
                  className="bg-transparent text-white w-full outline-none"
                />
              </div>
              <div className="flex items-center gap-1 bg-[#111] p-1 rounded border border-slate-800">
                <span className="text-slate-500 font-bold uppercase text-[8px]">Dyn</span>
                <input
                  type="checkbox"
                  checked={!!band.dynEnabled}
                  onChange={(e) => {
                    const updated = [...bands];
                    updated[index] = { ...updated[index], dynEnabled: e.target.checked };
                    onBandsChange(updated);
                  }}
                  className="w-3 h-3 accent-orange-500"
                />
              </div>
            </div>

            {band.dynEnabled && (
              <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
                <div className="flex flex-col bg-orange-950/20 p-1 rounded border border-orange-900/30">
                  <span className="text-orange-600 font-bold uppercase text-[8px]">Thr</span>
                  <input
                    type="number"
                    value={band.dynThreshold ?? -20}
                    onChange={(e) => {
                      const updated = [...bands];
                      updated[index] = { ...updated[index], dynThreshold: Number(e.target.value) };
                      onBandsChange(updated);
                    }}
                    className="bg-transparent text-orange-400 w-full outline-none"
                  />
                </div>
                <div className="flex flex-col bg-orange-950/20 p-1 rounded border border-orange-900/30">
                  <span className="text-orange-600 font-bold uppercase text-[8px]">Rat</span>
                  <input
                    type="number"
                    value={band.dynRatio ?? 4}
                    onChange={(e) => {
                      const updated = [...bands];
                      updated[index] = { ...updated[index], dynRatio: Number(e.target.value) };
                      onBandsChange(updated);
                    }}
                    className="bg-transparent text-orange-400 w-full outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};