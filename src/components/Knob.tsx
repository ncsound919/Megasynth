import React, { useState, useEffect, useRef, useCallback } from 'react';

interface KnobProps {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  decimals?: number;
  /** Accept any CSS colour string — alpha blending will be computed where needed */
  color?: string;
  /** Optional: hold Shift for fine‑tune (10× resolution) */
  shiftFine?: boolean;
}

const DEFAULT_COLOR = '#f97316'; // orange-500

/**
 * Converts any CSS colour string to an rgba() form suitable for box‑shadow.
 * Returns the original colour if conversion fails.
 */
const toRgba = (color: string, alpha: number): string => {
  if (color.startsWith('#')) {
    // Expand shorthand
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    const num = parseInt(hex, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (color.startsWith('rgb(')) {
    return color.replace(')', `, ${alpha})`).replace('rgb(', 'rgba(');
  }
  if (color.startsWith('rgba(')) {
    return color.replace(/[\d.]+\)$/, `${alpha})`);
  }
  // Fallback: use the colour as‑is (may break if used in box‑shadow with alpha)
  return color;
};

export const Knob: React.FC<KnobProps> = ({
  label,
  min,
  max,
  value,
  onChange,
  unit = '',
  decimals = 0,
  color = DEFAULT_COLOR,
  shiftFine = true,
}) => {
  const knobRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startValRef = useRef(0);
  const [isFocused, setIsFocused] = useState(false);
  // Store latest onChange in a ref to avoid stale closures in the mousemove effect
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ================== Mouse / Touch interaction ==================
  const moveHandler = useCallback(
    (clientY: number, shiftKey: boolean) => {
      const deltaY = startYRef.current - clientY;
      const range = max - min;
      let speed = 140; // pixels per full range
      if (shiftFine && shiftKey) speed *= 10; // hold Shift for fine adjustment
      const deltaVal = (deltaY / speed) * range;
      const newVal = Math.max(min, Math.min(max, startValRef.current + deltaVal));
      onChangeRef.current(newVal);
    },
    [max, min, shiftFine],
  );

  // Unified pointer‑down: works for mouse and touch
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValRef.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    moveHandler(e.clientY, e.shiftKey);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Capture mouse wheel for precision scrolling
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const range = max - min;
    const step = range / 50;
    let newVal = value - (e.deltaY > 0 ? step : -step);
    newVal = Math.max(min, Math.min(max, newVal));
    onChange(newVal);
  };

  // ================== Keyboard accessibility ==================
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      increment(e.shiftKey ? 0.1 : 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      decrement(e.shiftKey ? 0.1 : 1);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      increment(10);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      decrement(10);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    }
  };

  const increment = (multiplier = 1) => {
    const range = max - min;
    const step = range / 100; // default step
    const newVal = Math.min(max, value + step * multiplier);
    onChange(newVal);
  };

  const decrement = (multiplier = 1) => {
    const range = max - min;
    const step = range / 100;
    const newVal = Math.max(min, value - step * multiplier);
    onChange(newVal);
  };

  // ================== Value display & arc ==================
  const pct = (value - min) / (max - min || 1);
  const angle = -135 + pct * 270; // rotation in degrees
  const radius = 17; // SVG circle radius
  const circumference = 2 * Math.PI * radius;
  const filledLength = pct * circumference * 0.75; // 270° = 0.75 of full circle

  // Glow style for active state
  const glowColor = toRgba(color, 0.25);
  const activeGlow = isDragging
    ? `0 0 12px ${glowColor}`
    : '';

  return (
    <div
      className="flex flex-col items-center select-none group w-16"
      onWheel={handleWheel}
    >
      {/* Label */}
      <span className="text-[8px] font-mono font-bold tracking-wider text-[#777] group-hover:text-white transition-colors uppercase mb-1 text-center truncate w-full">
        {label}
      </span>

      {/* Knob body — focusable for keyboard */}
      <div
        ref={knobRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value.toFixed(decimals)} ${unit}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className={`w-10 h-10 rounded-full bg-gradient-to-tr from-[#151515] to-[#252525] border border-[#2c2c2c] shadow-[0_3px_5px_rgba(0,0,0,0.6)] flex items-center justify-center cursor-ns-resize relative transition-all duration-150 ${
          isDragging ? 'scale-105' : 'group-hover:border-[#555]'
        } ${isFocused ? 'ring-1 ring-offset-1 ring-offset-black ring-gray-500' : ''}`}
        style={{
          boxShadow: isDragging ? activeGlow : '',
          borderColor: isDragging ? color : '',
        }}
      >
        {/* Rotatable indicator line */}
        <div
          className="w-0.5 h-3 absolute top-1 origin-bottom rounded-full"
          style={{
            transform: `rotate(${angle}deg)`,
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
        {/* Knob centre cap */}
        <div className="w-4 h-4 rounded-full bg-[#121212] border border-[#222]" />

        {/* Arc track SVG */}
        <svg
          className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
          viewBox="0 0 40 40"
        >
          {/* Background track */}
          <circle
            cx="20" cy="20" r={radius}
            fill="none"
            stroke="#121212"
            strokeWidth="1.5"
          />
          {/* Filled arc */}
          <circle
            cx="20" cy="20" r={radius}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={circumference - filledLength}
            strokeLinecap="round"
            className="opacity-75 transition-all duration-75 group-hover:opacity-100"
          />
        </svg>
      </div>

      {/* Numerical readout */}
      <span
        className="text-[9px] font-mono text-[#aaa] font-semibold mt-1 tracking-tighter"
        style={{ color: isDragging ? color : '#aaa' }}
      >
        {value.toFixed(decimals)}{unit}
      </span>
    </div>
  );
};