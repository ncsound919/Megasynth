import React from 'react';

interface TactileButtonProps {
  active: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; // Better typing
  label: string;
  icon?: React.ReactNode;
  color?: string;
  className?: string;     // Allow extension
  disabled?: boolean;
}

export const TactileButton: React.FC<TactileButtonProps> = ({ 
  active, 
  onClick, 
  label, 
  icon, 
  color = "#f97316", 
  className = "",
  disabled = false
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 rounded font-mono text-[9px] uppercase font-bold tracking-wider border transition-all duration-200 active:scale-95 flex items-center justify-between gap-2.5 cursor-pointer shadow-[0_2px_4px_rgba(0,0,0,0.3)] select-none
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${active 
          ? 'bg-[#1a1a1a] text-white shadow-inner' 
          : 'border-[#222] bg-[#111] text-[#666] hover:text-[#999] hover:border-[#444]'
        } ${className}`}
      style={{
        borderColor: active ? color : '#222',
        boxShadow: active 
          ? `0 0 12px ${color}30, inset 0 2px 6px rgba(0,0,0,0.6)` 
          : '0 2px 4px rgba(0,0,0,0.3)'
      }}
    >
      <div className="flex items-center gap-1.5">
        {icon && (
          <span style={{ color: active ? color : '#777' }}>
            {icon}
          </span>
        )}
        <span>{label}</span>
      </div>

      <div 
        className="w-1.5 h-1.5 rounded-full transition-all duration-200" 
        style={{
          backgroundColor: active ? color : '#1c1c1c',
          boxShadow: active ? `0 0 8px ${color}` : 'none'
        }}
      />
    </button>
  );
};