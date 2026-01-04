import React, { useEffect, useRef, useState, useMemo, useLayoutEffect } from 'react';
import { useInventoryStore as useGameStore } from '@/state/InventoryStore';
import { subscribeThrottled, PlayerPosition } from '@core/player/PlayerState';
import { BiomeManager, BiomeType } from '@/features/terrain/logic/BiomeManager';
import { InventoryBar } from '@/ui/InventoryBar';
import { useSettingsStore } from '@/state/SettingsStore';
import { TargetHealthBar } from '@/ui/TargetHealthBar';

// --- Minimap Configuration ---
const MAP_SIZE = 64; // Reduced from 128 for better performance
const MAP_SCALE = 4; // World units per pixel (Higher = zoomed out, was 2)
const SAMPLING_STEP = 8; // Sample every 8th pixel (was 4) - only 64 samples now vs 1024

// Minimap disabled by default due to performance impact (causes stuttering)
// Use ?minimap URL param to enable it
const minimapEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('minimap');

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
  'BEACH': '#fde68a',       // amber-200
};

// Cache for biome texture - only regenerate when player moves significantly
let cachedBiomeImageData: ImageData | null = null;
let cachedBiomeCenter = { x: -99999, z: -99999 };
const CACHE_DISTANCE_THRESHOLD = 32; // Regenerate when player moves 32 units

const Minimap: React.FC<{ x: number, z: number, rotation: number }> = ({ x: px, z: pz, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotatingRef = useRef<HTMLDivElement>(null);

  // Only redraw biome texture when player moves significantly (not every frame)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) return;

    // Check if we need to regenerate the biome texture
    const dx = px - cachedBiomeCenter.x;
    const dz = pz - cachedBiomeCenter.z;
    const distSq = dx * dx + dz * dz;

    if (distSq < CACHE_DISTANCE_THRESHOLD * CACHE_DISTANCE_THRESHOLD && cachedBiomeImageData) {
      // Use cached texture, just redraw
      ctx.putImageData(cachedBiomeImageData, 0, 0);
      return;
    }

    // Regenerate biome texture (only 64 samples now: 8x8 grid)
    const cx = MAP_SIZE / 2;
    const cy = MAP_SIZE / 2;

    for (let py = 0; py < MAP_SIZE; py += SAMPLING_STEP) {
      for (let pxLocal = 0; pxLocal < MAP_SIZE; pxLocal += SAMPLING_STEP) {
        const worldX = px + (pxLocal - cx) * MAP_SCALE;
        const worldZ = pz + (py - cy) * MAP_SCALE;

        const biome = BiomeManager.getBiomeAt(worldX, worldZ);
        const hex = BIOME_COLORS[biome] || '#000000';
        ctx.fillStyle = hex;
        ctx.fillRect(pxLocal, py, SAMPLING_STEP, SAMPLING_STEP);
      }
    }

    // Cache the result
    cachedBiomeImageData = ctx.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
    cachedBiomeCenter = { x: px, z: pz };
  }, [px, pz]);

  // Update rotation via DOM manipulation to avoid React re-renders
  useLayoutEffect(() => {
    if (rotatingRef.current) {
      rotatingRef.current.style.transform = `rotate(${rotation}rad)`;
    }
  }, [rotation]);

  return (
    <div className="relative rounded-full border-4 border-slate-800/50 shadow-2xl overflow-hidden bg-slate-900 w-32 h-32 flex items-center justify-center">
      {/* Rotating Container for Map and Cardinal Directions */}
      <div
        ref={rotatingRef}
        className="relative w-full h-full"
      >
        <canvas
          ref={canvasRef}
          width={MAP_SIZE}
          height={MAP_SIZE}
          className="w-full h-full object-cover rendering-pixelated"
        />

        {/* Cardinal Directions */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white drop-shadow-md">N</div>
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white/70 drop-shadow-md">S</div>
        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/70 drop-shadow-md">E</div>
        <div className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/70 drop-shadow-md">W</div>
      </div>

      {/* Static Player Marker (Always points UP) */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[8px] border-b-red-500 filter drop-shadow-lg" />
      </div>
    </div>
  );
};

export const HUD: React.FC = () => {
  const inventoryCount = useGameStore((state) => state.inventoryCount);
  const stickCount = useGameStore((state) => state.stickCount);
  const stoneCount = useGameStore((state) => state.stoneCount);
  const isSharedArrayBufferEnabled = useGameStore((state) => state.isSharedArrayBufferEnabled);
  const toggleSettings = useSettingsStore(s => s.toggleSettings);

  // Use throttled subscription from PlayerState singleton (10Hz instead of 60fps)
  // This keeps the UI responsive without constant re-renders.
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0, rotation: 0 });
  const lastStateUpdatePos = useRef({ x: 0, z: 0 });

  useEffect(() => {
    // Subscribe to throttled player position updates (already 10Hz limited)
    // Additional distance check to reduce state updates further
    return subscribeThrottled((state: PlayerPosition) => {
      const dx = state.x - lastStateUpdatePos.current.x;
      const dz = state.z - lastStateUpdatePos.current.z;

      // Update local state if we moved > 0.1m
      if (dx * dx + dz * dz > 0.01) {
        setCoords({ x: state.x, y: state.y, z: state.z, rotation: state.rotation });
        lastStateUpdatePos.current = { x: state.x, z: state.z };
      }
    });
  }, []);

  const [crosshairHit, setCrosshairHit] = useState(false);
  const [crosshairColor, setCrosshairColor] = useState<string>('rgba(255, 255, 255, 0.85)');
  const [placementDebug, setPlacementDebug] = useState<string>('');
  const debugMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const viaQuery = params.has('debug');
    const viaWindow = (window as any).__vcDebugPlacement === true;
    let viaStorage = false;
    try {
      viaStorage = window.localStorage.getItem('vcDebugPlacement') === '1';
    } catch {
      viaStorage = false;
    }
    return viaQuery || viaWindow || viaStorage;
  }, []);

  // Placement debugging (enabled with ?debug).
  useEffect(() => {
    if (!debugMode) return;
    let timeoutId: number | null = null;
    const handlePlacementDebug = (e: Event) => {
      const ce = e as CustomEvent;
      const msg = (ce.detail?.message as string | undefined) ?? '';
      if (!msg) return;
      setPlacementDebug(msg);
      if (timeoutId != null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setPlacementDebug(''), 1200);
    };
    window.addEventListener('vc-placement-debug', handlePlacementDebug as EventListener);
    return () => {
      window.removeEventListener('vc-placement-debug', handlePlacementDebug as EventListener);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [debugMode]);

  // Tool feedback: flash crosshair on terrain/tool impacts.
  useEffect(() => {
    let timeoutId: number | null = null;

    const handleImpact = (e: Event) => {
      const ce = e as CustomEvent;
      const detail = (ce.detail ?? {}) as { color?: string; ok?: boolean };
      // Slightly red-tint failed actions; otherwise use the material color from the terrain system.
      const color = detail.ok === false ? 'rgba(255, 120, 120, 0.95)' : (detail.color ?? 'rgba(255, 255, 255, 0.85)');
      setCrosshairColor(color);
      setCrosshairHit(true);
      if (timeoutId != null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => setCrosshairHit(false), 110);
    };

    window.addEventListener('tool-impact', handleImpact as EventListener);
    return () => {
      window.removeEventListener('tool-impact', handleImpact as EventListener);
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* Center Crosshair */}
      <div
        className={`crosshair ${crosshairHit ? 'hit' : ''}`}
        // Use CSS var so pseudo-elements can inherit the impact color.
        style={{ ['--crosshair-color' as any]: crosshairColor }}
      />

      <TargetHealthBar />

      {/* Top Left: Controls Info */}
      <div className="absolute top-4 left-4 text-slate-800 bg-white/70 px-3 py-2 rounded-lg shadow-lg backdrop-blur-md border border-white/40 max-w-[240px]">
        <div className="flex items-center justify-between mb-1">
          <h1 className="font-semibold text-sm text-emerald-700">Organic Voxel Engine</h1>
          {!isSharedArrayBufferEnabled && (
            <span className="px-1.5 py-0.5 bg-red-500 text-[9px] font-bold text-white rounded animate-pulse">
              LEGACY MODE
            </span>
          )}
        </div>
        <div className="space-y-0.5 text-xs font-medium leading-tight">
          <p>WASD + Space to move</p>
          <p>Left Click: <span className="text-red-500 font-semibold">DIG</span> (pickaxe selected)</p>
          <p>Right Click: <span className="text-emerald-600 font-semibold">USE</span> (place/throw)</p>
          <p>
            Q: <span className="text-cyan-600 font-semibold">Pick Up Items</span> (Flora: {inventoryCount}, Sticks: {stickCount}, Stones: {stoneCount})
          </p>
          <p>Scroll / 1-9: <span className="text-amber-500 font-semibold">Inventory</span></p>
        </div>
        {debugMode && placementDebug && (
          <div className="mt-1 text-[10px] font-mono text-slate-700">
            place: {placementDebug}
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-slate-300 text-[10px] font-mono opacity-80">
          POS: {coords.x.toFixed(1)}, {coords.y.toFixed(1)}, {coords.z.toFixed(1)}
        </div>
      </div>

      {/* Bottom Left: Inventory Bar */}
      <InventoryBar />

      {/* Bottom Right: Minimap (disabled by default, use ?minimap to enable) */}
      {minimapEnabled && (
        <div className="absolute bottom-6 right-6 pointer-events-auto">
          <Minimap x={coords.x} z={coords.z} rotation={coords.rotation} />
          <div className="text-center mt-1 text-[10px] text-white font-mono bg-black/50 rounded px-1 backdrop-blur-sm">
            Biome: {BiomeManager.getBiomeAt(coords.x, coords.z)}
          </div>
        </div>
      )}

      {/* Top Right: Settings */}
      <div className="absolute top-4 right-4 pointer-events-auto">
        <button
          onClick={toggleSettings}
          className="p-2 bg-slate-800/80 rounded-full hover:bg-slate-700 text-white shadow-lg backdrop-blur-sm transition-colors"
          title="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.212 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>
    </div>
  );
};
