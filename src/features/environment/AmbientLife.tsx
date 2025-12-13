import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BiomeManager, BiomeType } from '@features/terrain/logic/BiomeManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { FogDeer } from '@features/creatures/FogDeer';

export type PlayerMovedDetail = {
  x: number;
  y: number;
  z: number;
  rotation: number;
};

export type PlayerMovedRef = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** True after we've received at least one `player-moved` event. */
  hasSignal: boolean;
};

function biomeFireflyFactor(biome: BiomeType): number {
  switch (biome) {
    case 'THE_GROVE':
      return 1.0;
    case 'JUNGLE':
      return 0.85;
    case 'BEACH':
      return 0.25;
    case 'PLAINS':
      return 0.35;
    case 'MOUNTAINS':
      return 0.1;
    case 'DESERT':
    case 'RED_DESERT':
    case 'SNOW':
    case 'ICE_SPIKES':
    case 'SKY_ISLANDS':
    default:
      return 0.0;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * FirefliesField
 * Lightweight instanced "motes" that feel like ambient life.
 *
 * - Uses stable anchor wrapping so the field feels infinite without spawning globally.
 * - Avoids React state churn: all per-instance simulation is kept in refs/typed arrays.
 */
const FirefliesField: React.FC<{
  enabled: boolean;
  playerRef: React.MutableRefObject<PlayerMovedRef>;
}> = ({ enabled, playerRef }) => {
  const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
  const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Tunables: keep count modest to avoid CPU churn.
  const COUNT = 200;
  const CELL_SIZE = 18; // Snapped anchor size to keep wrapping stable.
  const RANGE = 64; // XZ range covered around the anchor.
  const BASE_RADIUS = 0.07;

  // Per-instance: offset in the local window, cached base Y, and a stable phase/seed.
  const offsets = useRef<Float32Array>(new Float32Array(COUNT * 2)); // x,z only
  const baseY = useRef<Float32Array>(new Float32Array(COUNT));
  const phases = useRef<Float32Array>(new Float32Array(COUNT));
  const factors = useRef<Float32Array>(new Float32Array(COUNT)); // biome gating per instance
  const drift = useRef<Float32Array>(new Float32Array(COUNT * 2)); // drift direction x,z

  const anchorRef = useRef<{ ax: number; az: number } | null>(null);
  const lastEnvRef = useRef<{ undergroundBlend: number; underwaterBlend: number } | null>(null);

  useEffect(() => {
    // Deterministic-ish seed without importing new RNG deps.
    const rand = (() => {
      let s = 1337;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return (s & 0xfffffff) / 0xfffffff;
      };
    })();

    for (let i = 0; i < COUNT; i++) {
      const ox = (rand() - 0.5) * RANGE;
      const oz = (rand() - 0.5) * RANGE;
      offsets.current[i * 2 + 0] = ox;
      offsets.current[i * 2 + 1] = oz;
      phases.current[i] = rand() * Math.PI * 2;
      // Drift direction (unit-ish).
      const dx = rand() * 2 - 1;
      const dz = rand() * 2 - 1;
      const invLen = 1.0 / Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
      drift.current[i * 2 + 0] = dx * invLen;
      drift.current[i * 2 + 1] = dz * invLen;
      baseY.current[i] = 0;
      factors.current[i] = 0;
    }
  }, []);

  /**
   * Recomputes per-instance biome gating + baseline height when the anchor changes.
   * This keeps expensive queries (biome + surface height) out of the frame loop.
   */
  const refreshForAnchor = (ax: number, az: number) => {
    const px = playerRef.current.x;
    const py = playerRef.current.y;
    const pz = playerRef.current.z;
    const caveLerp = smoothstep(0.15, 0.65, undergroundBlend);

    for (let i = 0; i < COUNT; i++) {
      const wx = ax + offsets.current[i * 2 + 0];
      const wz = az + offsets.current[i * 2 + 1];

      const biome = BiomeManager.getBiomeAt(wx, wz);
      const biomeFactor = biomeFireflyFactor(biome);

      // Underground: allow subtle motes anywhere (cave entrances included),
      // but keep them very subdued in deserts/snow to avoid "magical glitter" everywhere.
      const caveFactor = caveLerp * (biomeFactor > 0 ? 1.0 : 0.35);
      factors.current[i] = Math.max(biomeFactor, caveFactor);

      const surfaceY = TerrainService.getHeightAt(wx, wz);
      // Blend: near surface use surfaceY; underground use player Y so motes appear "in the cave".
      const targetY = THREE.MathUtils.lerp(surfaceY + 2.0, py + 0.5, caveLerp);

      // Keep fireflies local so they don't end up above the player in deep caves.
      // This is purely a visual cheat; they are not physics objects.
      const dy = (phases.current[i] % 1.0) * 3.0 - 1.25;
      baseY.current[i] = THREE.MathUtils.lerp(targetY, py + dy, caveLerp);

      // Mild bias toward player so the field doesn't feel "pinned" to the surface when
      // walking along steep terrain.
      if (caveLerp < 0.15) {
        const distToPlayer = Math.hypot(wx - px, wz - pz);
        if (distToPlayer < 14) baseY.current[i] = THREE.MathUtils.lerp(baseY.current[i], py + 1.0, 0.2);
      }
    }
  };

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!enabled || !mesh) return;
    if (!playerRef.current.hasSignal) return;

    // Global intensity gates (cheap, avoids doing extra work underwater).
    const biomeAtPlayer = BiomeManager.getBiomeAt(playerRef.current.x, playerRef.current.z);
    const biomeFactor = biomeFireflyFactor(biomeAtPlayer);
    const caveBoost = smoothstep(0.25, 0.85, undergroundBlend);
    const underwaterSuppression = 1.0 - smoothstep(0.05, 0.45, underwaterBlend);
    const globalIntensity = Math.max(biomeFactor, caveBoost * 0.9) * underwaterSuppression;
    if (globalIntensity < 0.01) return;

    const px = playerRef.current.x;
    const pz = playerRef.current.z;
    const ax = Math.floor(px / CELL_SIZE) * CELL_SIZE;
    const az = Math.floor(pz / CELL_SIZE) * CELL_SIZE;

    const env = lastEnvRef.current;
    const envChanged =
      !env ||
      Math.abs(env.undergroundBlend - undergroundBlend) > 0.08 ||
      Math.abs(env.underwaterBlend - underwaterBlend) > 0.08;

    if (
      !anchorRef.current ||
      anchorRef.current.ax !== ax ||
      anchorRef.current.az !== az ||
      envChanged
    ) {
      anchorRef.current = { ax, az };
      lastEnvRef.current = { undergroundBlend, underwaterBlend };
      refreshForAnchor(ax, az);
    }

    const t = state.clock.elapsedTime;
    const driftSpeed = THREE.MathUtils.lerp(0.25, 0.6, smoothstep(0.0, 1.0, undergroundBlend));

    for (let i = 0; i < COUNT; i++) {
      const instanceFactor = factors.current[i] * globalIntensity;
      const phase = phases.current[i];

      // Blink: smooth pulse with per-instance phase.
      const blink = 0.45 + 0.55 * Math.sin(t * 1.6 + phase);
      const scale = BASE_RADIUS * instanceFactor * (0.35 + 0.75 * blink);

      // If suppressed, keep the matrix valid but tiny to avoid NaN issues.
      const safeScale = scale > 0.0005 ? scale : 0.0001;

      const ox = offsets.current[i * 2 + 0];
      const oz = offsets.current[i * 2 + 1];
      const dx = drift.current[i * 2 + 0];
      const dz = drift.current[i * 2 + 1];
      const driftX = dx * Math.sin(t * 0.7 + phase) * driftSpeed;
      const driftZ = dz * Math.cos(t * 0.6 + phase) * driftSpeed;
      const driftY = Math.sin(t * 0.9 + phase) * 0.35;

      dummy.position.set(ax + ox + driftX, baseY.current[i] + driftY, az + oz + driftZ);
      dummy.scale.setScalar(safeScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined as any, undefined as any, COUNT]} frustumCulled={false}>
      {/* Small icosahedrons read as "motes" and avoid looking like UI points. */}
      <icosahedronGeometry args={[1, 0]} />
      <meshBasicMaterial
        color="#d9ff7a"
        transparent
        opacity={0.95}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
};

/**
 * AmbientLife
 * Entry point for cheap, always-on "early life" ambience: fireflies + distant fog creatures.
 *
 * IMPORTANT:
 * - Uses the existing `player-moved` event as the data source to avoid tight coupling to Player.
 * - Avoids React state updates inside `useFrame()` to keep GC and rerenders low.
 */
export const AmbientLife: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const playerRef = useRef<PlayerMovedRef>({ x: 0, y: 0, z: 0, rotation: 0, hasSignal: false });

  useEffect(() => {
    if (!enabled) return;

    const handlePlayerMoved = (e: Event) => {
      const ce = e as CustomEvent<PlayerMovedDetail>;
      if (!ce.detail) return;
      playerRef.current.x = ce.detail.x;
      playerRef.current.y = ce.detail.y;
      playerRef.current.z = ce.detail.z;
      playerRef.current.rotation = ce.detail.rotation;
      playerRef.current.hasSignal = true;
    };

    window.addEventListener('player-moved', handlePlayerMoved as EventListener);
    return () => window.removeEventListener('player-moved', handlePlayerMoved as EventListener);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <FirefliesField enabled={enabled} playerRef={playerRef} />
      <FogDeer enabled={enabled} playerRef={playerRef} />
    </>
  );
};
