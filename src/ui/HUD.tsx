import React, { useEffect, useRef, useState } from 'react';
import { useInventoryStore as useGameStore } from '@/state/InventoryStore';
import { BiomeManager, BiomeType } from '@/features/terrain/logic/BiomeManager';

// --- Minimap Configuration ---
const MAP_SIZE = 128; // Pixel width/height of the map
const MAP_SCALE = 2; // World units per pixel (Higher = zoomed out)
const REFRESH_RATE = 5; // Skip frames to save CPU (Draw every Nth frame)

const BIOME_COLORS: Record<BiomeType, string> = {
  'PLAINS': '#4ade80',      // green-400
  'DESERT': '#fde047',      // yellow-300
  'RED_DESERT': '#fb923c',  // orange-400
  'SNOW': '#f8fafc',        // slate-50
  'ICE_SPIKES': '#bae6fd',  // sky-200
  'MOUNTAINS': '#64748b',   // slate-500
  'JUNGLE': '#15803d',      // green-700
  'SAVANNA': '#a3e635',     // lime-400
  'THE_GROVE': '#10b981',   // emerald-500
  'SKY_ISLANDS': '#0ea5e9', // sky-500
};

const Minimap: React.FC<{ x: number, z: number }> = ({ x: px, z: pz }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCount = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false }); // Alpha false for performance
    if (!ctx) return;

    // Optimization: Throttle the draw calls
    frameCount.current++;
    if (frameCount.current % REFRESH_RATE !== 0) return;

    // Center of the map
    const cx = MAP_SIZE / 2;
    const cy = MAP_SIZE / 2;
    
    // Create ImageData buffer for direct pixel manipulation (Fastest method)
    const imgData = ctx.createImageData(MAP_SIZE, MAP_SIZE);
    const data = imgData.data;

    for (let py = 0; py < MAP_SIZE; py++) {
      for (let pxLocal = 0; pxLocal < MAP_SIZE; pxLocal++) {
        // Calculate World Position for this pixel
        // We flip Z because screen Y is down, but world Z is usually "forward/back"
        const worldX = px + (pxLocal - cx) * MAP_SCALE;
        const worldZ = pz + (py - cy) * MAP_SCALE;

        // "Predict" the biome at this location using logic, not geometry
        const biome = BiomeManager.getBiomeAt(worldX, worldZ);
        
        // Parse hex color to RGB
        const hex = BIOME_COLORS[biome] || '#000000';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);

        // Fill buffer (RGBA)
        const index = (py * MAP_SIZE + pxLocal) * 4;
        data[index] = r;
        data[index + 1] = g;
        data[index + 2] = b;
        data[index + 3] = 255; // Full opacity
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw Player Marker
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    ctx.stroke();

  }, [px, pz]); // Re-run when player moves

  return (
    <div className="relative rounded-full border-4 border-slate-800/50 shadow-2xl overflow-hidden bg-slate-900 w-32 h-32">
      <canvas 
        ref={canvasRef} 
        width={MAP_SIZE} 
        height={MAP_SIZE} 
        className="w-full h-full object-cover rendering-pixelated"
      />
      {/* Compass / NSEW markings could go here as absolute overlays */}
      <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white/80">N</div>
    </div>
  );
};

export const HUD: React.FC = () => {
  const inventoryCount = useGameStore((state) => state.inventoryCount);
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0 });

  // Quick hack to get camera position: App.tsx will update a DOM element or Custom Event
  useEffect(() => {
    const handlePosUpdate = (e: CustomEvent) => {
      setCoords(e.detail);
    };
    window.addEventListener('player-moved', handlePosUpdate as EventListener);
    return () => window.removeEventListener('player-moved', handlePosUpdate as EventListener);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* Center Crosshair */}
      <div className="crosshair" />

      {/* Top Left: Controls Info */}
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

      {/* Bottom Right: Minimap */}
      <div className="absolute bottom-6 right-6 pointer-events-auto">
        <Minimap x={coords.x} z={coords.z} />
        <div className="text-center mt-1 text-[10px] text-white font-mono bg-black/50 rounded px-1 backdrop-blur-sm">
          Biome: {BiomeManager.getBiomeAt(coords.x, coords.z)}
        </div>
      </div>
    </div>
  );
};