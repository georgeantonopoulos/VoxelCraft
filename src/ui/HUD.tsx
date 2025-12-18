import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Vector3 } from 'three';
import { useInventoryStore as useGameStore } from '@/state/InventoryStore';
import { useWorldStore } from '@/state/WorldStore';
import { BiomeManager, BiomeType } from '@/features/terrain/logic/BiomeManager';
import { InventoryBar } from '@/ui/InventoryBar';
import { useSettingsStore } from '@/state/SettingsStore';

// --- Minimap Configuration ---
const MAP_SIZE = 128; // Pixel width/height of the map
const MAP_SCALE = 2; // World units per pixel (Higher = zoomed out)
const REFRESH_RATE = 10; // Throttled to every 10 frames (was 5)
const SAMPLING_STEP = 4; // Sample every 4th pixel for biomes (BIG perf gain)

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

const Minimap: React.FC<{ x: number, z: number, rotation: number }> = ({ x: px, z: pz, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameCount = useRef(0);

  // Ground pickup signatures (sticks/rocks). Flora signatures are intentionally disabled.
  const getStickHotspotsNearby = useWorldStore(s => s.getStickHotspotsNearby);
  const getRockHotspotsNearby = useWorldStore(s => s.getRockHotspotsNearby);

  const visibleStickHotspots = useMemo(() => {
    const range = (MAP_SIZE / 2) * MAP_SCALE + 20;
    return getStickHotspotsNearby(new Vector3(px, 0, pz), range);
  }, [getStickHotspotsNearby, px, pz]);

  const visibleRockHotspots = useMemo(() => {
    const range = (MAP_SIZE / 2) * MAP_SCALE + 20;
    return getRockHotspotsNearby(new Vector3(px, 0, pz), range);
  }, [getRockHotspotsNearby, px, pz]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false }); // Alpha false for performance
    if (!ctx) return;

    // Optimization: Throttle the draw calls
    frameCount.current++;
    if (frameCount.current % REFRESH_RATE !== 0) return;

    const drawStart = performance.now();

    // Center of the map
    const cx = MAP_SIZE / 2;
    const cy = MAP_SIZE / 2;

    // Optimization 2: Low-resolution biome sampling
    // We sample every SAMPLING_STEP pixels to avoid 16,000+ noise calls.
    for (let py = 0; py < MAP_SIZE; py += SAMPLING_STEP) {
      for (let pxLocal = 0; pxLocal < MAP_SIZE; pxLocal += SAMPLING_STEP) {
        const worldX = px + (pxLocal - cx) * MAP_SCALE;
        const worldZ = pz + (py - cy) * MAP_SCALE;

        const biome = BiomeManager.getBiomeAt(worldX, worldZ);
        const hex = BIOME_COLORS[biome] || '#000000';
        ctx.fillStyle = hex;
        // Draw a block of pixels instead of manipulating imagedata for the low-res look
        ctx.fillRect(pxLocal, py, SAMPLING_STEP, SAMPLING_STEP);
      }
    }

    // Draw Ground Pickup Hotspots (sticks + stones)
    const time = Date.now() / 1000;
    const pulse = (Math.sin(time * 5) * 0.5 + 0.5); // 0 to 1
    const rSmall = 1.8 + pulse * 0.9;
    const rLarge = 2.3 + pulse * 1.1;

    // Sticks: brown dots
    ctx.fillStyle = '#b45309';
    ctx.globalAlpha = 0.65 + pulse * 0.25;
    visibleStickHotspots.forEach((spot) => {
      const mapX = cx + (spot.x - px) / MAP_SCALE;
      const mapY = cy + (spot.z - pz) / MAP_SCALE;
      ctx.beginPath();
      ctx.arc(mapX, mapY, rSmall, 0, Math.PI * 2);
      ctx.fill();
    });

    // Stones: grey dots
    ctx.fillStyle = '#9ca3af';
    ctx.globalAlpha = 0.70 + pulse * 0.25;
    visibleRockHotspots.forEach((spot) => {
      const mapX = cx + (spot.x - px) / MAP_SCALE;
      const mapY = cy + (spot.z - pz) / MAP_SCALE;
      ctx.beginPath();
      ctx.arc(mapX, mapY, rLarge, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = 1.0;

    if (typeof window !== 'undefined') {
      const diag = (window as any).__vcDiagnostics;
      if (diag) {
        diag.minimapDrawTime = Math.max(diag.minimapDrawTime || 0, performance.now() - drawStart);
      }
    }
  }, [px, pz, visibleStickHotspots, visibleRockHotspots]); // Re-run when player moves or pickup hotspots change

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
  const stickCount = useGameStore((state) => state.stickCount);
  const stoneCount = useGameStore((state) => state.stoneCount);
  const toggleSettings = useSettingsStore(s => s.toggleSettings);

  // Use store for player coordinates instead of event listener
  // Use local state to avoid full HUD re-renders every frame.
  // We'll update this state at a slower cadence or only on significant movement.
  const [coords, setCoords] = useState({ x: 0, y: 0, z: 0, rotation: 0 });
  const lastStateUpdatePos = useRef({ x: 0, z: 0 });

  useEffect(() => {
    // Subscribe to store for coordinates but with a throttled local state update.
    // This keeps the UI Snappy (60FPS for crosshair/inventory) without 
    // the heavy Minimap/Text updates every single frame.
    const unsub = useWorldStore.subscribe((state) => {
      const p = state.playerParams;
      const dx = p.x - lastStateUpdatePos.current.x;
      const dz = p.z - lastStateUpdatePos.current.z;

      // Update local state if we moved > 0.1m or rotation changed significantly
      if (dx * dx + dz * dz > 0.01) {
        setCoords({ ...p });
        lastStateUpdatePos.current = { x: p.x, z: p.z };
      }
    });
    return unsub;
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

      {/* Top Left: Controls Info */}
      <div className="absolute top-4 left-4 text-slate-800 bg-white/70 px-3 py-2 rounded-lg shadow-lg backdrop-blur-md border border-white/40 max-w-[240px]">
        <h1 className="font-semibold text-base text-emerald-700 mb-1">Organic Voxel Engine</h1>
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

      {/* Bottom Right: Minimap */}
      <div className="absolute bottom-6 right-6 pointer-events-auto">
        <Minimap x={coords.x} z={coords.z} rotation={coords.rotation} />
        <div className="text-center mt-1 text-[10px] text-white font-mono bg-black/50 rounded px-1 backdrop-blur-sm">
          Biome: {BiomeManager.getBiomeAt(coords.x, coords.z)}
        </div>
      </div>

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
