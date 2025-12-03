import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Vector3 } from 'three';
import { useInventoryStore as useGameStore } from '@/state/InventoryStore';
import { useWorldStore } from '@/state/WorldStore';
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

const Minimap: React.FC<{ x: number, z: number, rotation: number }> = ({ x: px, z: pz, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCount = useRef(0);

  // Get flora entities to display
  const floraEntities = useWorldStore(s => s.entities);
  const getFloraHotspotsNearby = useWorldStore(s => s.getFloraHotspotsNearby);
  // We need a ref to access the latest entities inside the effect without re-triggering it constantly
  // However, since we redraw every few frames, we can just read from the store or use a ref.
  // Using the hook directly causes re-renders when entities change, which is fine.

  // Filter flora for performance (only those likely to be on map)
  // Map radius in world units = (MAP_SIZE / 2) * MAP_SCALE = 64 * 2 = 128
  const visibleFlora = useMemo(() => {
    const range = (MAP_SIZE / 2) * MAP_SCALE + 20; // +buffer
    return Array.from(floraEntities.values()).filter(e => {
      if (e.type !== 'FLORA') return false;
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      return Math.abs(dx) < range && Math.abs(dz) < range;
    });
  }, [floraEntities, px, pz]);

  const visibleHotspots = useMemo(() => {
    const range = (MAP_SIZE / 2) * MAP_SCALE + 20; // Keep buffer consistent with entities
    return getFloraHotspotsNearby(new Vector3(px, 0, pz), range);
  }, [getFloraHotspotsNearby, px, pz]);

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

    // Draw Flora Hotspots (pre-pickup spawn points from terrain generation)
    const time = Date.now() / 1000;
    const pulse = (Math.sin(time * 5) * 0.5 + 0.5); // 0 to 1
    const hotspotRadius = 3 + pulse * 3; // Larger to signal area of interest

    ctx.fillStyle = '#38bdf8'; // Bright blue
    ctx.globalAlpha = 0.45 + pulse * 0.35; // Pulse opacity

    visibleHotspots.forEach((spot) => {
      // Convert world pos to map pos
      const mapX = cx + (spot.x - px) / MAP_SCALE;
      const mapY = cy + (spot.z - pz) / MAP_SCALE;

      // Gentle jitter to avoid laser accuracy (consistent per coordinate)
      const jitterSeed = spot.x * 0.25 + spot.z * 0.75;
      const offsetX = Math.sin(jitterSeed) * 6;
      const offsetY = Math.cos(jitterSeed) * 6;

      ctx.beginPath();
      ctx.arc(mapX + offsetX, mapY + offsetY, hotspotRadius, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw placed/active flora entities (player-facing objects)
    const entityRadius = 2 + pulse * 2; // 2 to 4 pixels

    ctx.fillStyle = '#67e8f9'; // Cyan
    ctx.globalAlpha = 0.6 + pulse * 0.4; // Pulse opacity

    visibleFlora.forEach(flora => {
      const mapX = cx + (flora.position.x - px) / MAP_SCALE;
      const mapY = cy + (flora.position.z - pz) / MAP_SCALE;

      // Add some "inaccuracy" as requested ("Don't be too accurate")
      // We can hash the ID to get a consistent offset
      const hash = flora.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const offsetX = (Math.sin(hash) * 10); // +/- 10 pixels inaccuracy
      const offsetY = (Math.cos(hash) * 10);

      ctx.beginPath();
      ctx.arc(mapX + offsetX, mapY + offsetY, entityRadius, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1.0;

  }, [px, pz, visibleFlora, visibleHotspots]); // Re-run when player moves or flora changes

  return (
    <div className="relative rounded-full border-4 border-slate-800/50 shadow-2xl overflow-hidden bg-slate-900 w-32 h-32 flex items-center justify-center">
      {/* Rotating Container for Map and Cardinal Directions */}
      <div
        className="relative w-full h-full"
        style={{ transform: `rotate(${rotation}rad)` }}
      >
        <canvas
          ref={canvasRef}
          width={MAP_SIZE}
          height={MAP_SIZE}
          className="w-full h-full object-cover rendering-pixelated"
        />

        {/* Cardinal Directions (Attached to the map, so they rotate with it) */}
        {/* N is at -Z (Top of map), S is at +Z (Bottom), E is at +X (Right), W is at -X (Left) */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white drop-shadow-md">N</div>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white/70 drop-shadow-md">S</div>
        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/70 drop-shadow-md">E</div>
        <div className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/70 drop-shadow-md">W</div>
      </div>

      {/* Static Player Marker (Always points UP) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {/* Arrow pointing UP */}
        <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-red-500 filter drop-shadow-lg" />
      </div>
    </div>
  );
};

export const HUD: React.FC = () => {
  const inventoryCount = useGameStore((state) => state.inventoryCount);
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0, rotation: 0 });

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
        <Minimap x={coords.x} z={coords.z} rotation={coords.rotation} />
        <div className="text-center mt-1 text-[10px] text-white font-mono bg-black/50 rounded px-1 backdrop-blur-sm">
          Biome: {BiomeManager.getBiomeAt(coords.x, coords.z)}
        </div>
      </div>
    </div>
  );
};
