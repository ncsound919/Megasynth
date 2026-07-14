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
  /** Visual size variant. Defaults to 'medium'. */
  size?: 'small' | 'medium' | 'large';
}

const DEFAULT_COLOR = '#f97316'; // orange-500

const SIZE_CONFIG = {
  small: {
    container: 'w-12',
    knob: 'w-8 h-8',
    viewBoxSize: 32,
    radius: 13,
    indicator: 'w-0.5 h-2.5 top-0.5',
    cap: 'w-3 h-3',
    label: 'text-[7px]',
    readout: 'text-[8px]',
  },
  medium: {
    container: 'w-16',
    knob: 'w-10 h-10',
    viewBoxSize: 40,
    radius: 17,
    indicator: 'w-0.5 h-3 top-1',
    cap: 'w-4 h-4',
    label: 'text-[8px]',
    readout: 'text-[9px]',
  },
  large: {
    container: 'w-20',
    knob: 'w-14 h-14',
    viewBoxSize: 56,
    radius: 24,
    indicator: 'w-1 h-4 top-1.5',
    cap: 'w-5 h-5',
    label: 'text-[9px]',
    readout: 'text-[10px]',
  },
} as const;

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
  size = 'medium',
}) => {
  const sz = SIZE_CONFIG[size];
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
  const radius = sz.radius; // SVG circle radius, scaled per size variant
  const circumference = 2 * Math.PI * radius;
  const filledLength = pct * circumference * 0.75; // 270° = 0.75 of full circle

  // Glow style for active state
  const glowColor = toRgba(color, 0.25);
  const activeGlow = isDragging
    ? `0 0 12px ${glowColor}`
    : '';

  return (
    <div
      className={`flex flex-col items-center select-none group ${sz.container}`}
      onWheel={handleWheel}
    >
      {/* Label */}
      <span className={`${sz.label} font-mono font-bold tracking-wider text-[#777] group-hover:text-white transition-colors uppercase mb-1 text-center truncate w-full`}>
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
        className={`${sz.knob} rounded-full bg-gradient-to-tr from-[#151515] to-[#252525] border border-[#2c2c2c] shadow-[0_3px_5px_rgba(0,0,0,0.6)] flex items-center justify-center cursor-ns-resize relative transition-all duration-150 ${
          isDragging ? 'scale-105' : 'group-hover:border-[#555]'
        } ${isFocused ? 'ring-1 ring-offset-1 ring-offset-black ring-gray-500' : ''}`}
        style={{
          boxShadow: isDragging ? activeGlow : '',
          borderColor: isDragging ? color : '',
        }}
      >
        {/* Rotatable indicator line */}
        <div
          className={`${sz.indicator} absolute origin-bottom rounded-full`}
          style={{
            transform: `rotate(${angle}deg)`,
            backgroundColor: color,
            boxShadow: `0 0 6px ${color}`,
          }}
        />
        {/* Knob centre cap */}
        <div className={`${sz.cap} rounded-full bg-[#121212] border border-[#222]`} />

        {/* Arc track SVG */}
        <svg
          className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
          viewBox={`0 0 ${sz.viewBoxSize} ${sz.viewBoxSize}`}
        >
          {/* Background track */}
          <circle
            cx={sz.viewBoxSize / 2} cy={sz.viewBoxSize / 2} r={radius}
            fill="none"
            stroke="#121212"
            strokeWidth="1.5"
          />
          {/* Filled arc */}
          <circle
            cx={sz.viewBoxSize / 2} cy={sz.viewBoxSize / 2} r={radius}
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
        className={`${sz.readout} font-mono text-[#aaa] font-semibold mt-1 tracking-tighter`}
        style={{ color: isDragging ? color : '#aaa' }}
      >
        {value.toFixed(decimals)}{unit}
      </span>
    </div>
  );
};