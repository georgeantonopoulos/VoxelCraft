
import React from 'react';

export const UI: React.FC = () => {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Center Crosshair */}
      <div className="crosshair" />
      
      {/* Controls Info */}
      <div className="absolute top-4 left-4 text-slate-800 bg-white/80 p-4 rounded-lg shadow-xl backdrop-blur-md border border-white/50">
        <h1 className="font-bold text-xl text-emerald-600 mb-2">Organic Voxel Engine</h1>
        <div className="space-y-1 text-sm font-medium">
            <p>🕹️ WASD + Space to Move</p>
            <p>🖱️ Left Click: <span className="text-red-500 font-bold">DIG</span></p>
            <p>🖱️ Right Click: <span className="text-emerald-600 font-bold">BUILD</span></p>
        </div>
      </div>
    </div>
  );
};
