
import React, { useEffect, useState } from 'react';
import { useGameStore } from '../services/GameManager';

export const UI: React.FC = () => {
  const inventoryCount = useGameStore((state) => state.inventoryCount);
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0 });

  useEffect(() => {
    const updateCoords = () => {
        // We can access camera position from window if exposed, or simpler:
        // We will pass coords via props or context in a refactor.
        // For now, let's poll a global variable if we set one, OR
        // rely on the parent to update us.
        // Actually, let's attach a listener to the window for debug purposes
        // or just use a small interval to read from a global if available.
        // But since this is a React component outside Canvas, it doesn't have access to R3F context.
        // We will update App.tsx to pass coords or expose them.
    };
  }, []);

  // Quick hack to get camera position: App.tsx will update a DOM element or Custom Event
  useEffect(() => {
      const handlePosUpdate = (e: CustomEvent) => {
          setCoords(e.detail);
      };
      window.addEventListener('player-moved', handlePosUpdate as EventListener);
      return () => window.removeEventListener('player-moved', handlePosUpdate as EventListener);
  }, []);

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
            <p>E: <span className="text-cyan-600 font-semibold">Place Flora</span> (Inv: {inventoryCount})</p>
        </div>
        <div className="mt-2 pt-2 border-t border-slate-300 text-[10px] font-mono opacity-80">
            POS: {coords.x.toFixed(1)}, {coords.y.toFixed(1)}, {coords.z.toFixed(1)}
        </div>
      </div>
    </div>
  );
};
