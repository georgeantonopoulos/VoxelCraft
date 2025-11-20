
import React from 'react';

export const UI: React.FC = () => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Center Crosshair */}
      <div className="crosshair" />
      
      {/* Controls Info */}
      <div className="absolute top-4 left-4 text-slate-800 bg-white/70 px-3 py-2 rounded-lg shadow-lg backdrop-blur-md border border-white/40 max-w-[240px]">
        <h1 className="font-semibold text-base text-emerald-700 mb-1">Organic Voxel Engine</h1>
        <div className="space-y-0.5 text-xs font-medium leading-tight">
            <p>WASD + Space to move</p>
            <p>Left Click: <span className="text-red-500 font-semibold">DIG</span></p>
            <p>Right Click: <span className="text-emerald-600 font-semibold">BUILD</span></p>
        </div>
      </div>
    </div>
  );
};
