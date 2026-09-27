import * as THREE from 'three';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { columnInfo, riverSignedAt, RIVER_WIDTH } from '@features/terrain/logic/terrainShape';
import { findNearestGroveCenter } from '@features/grove/hollowSense';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { CHUNK_SIZE_XZ, WATER_LEVEL } from '@/constants';
import { useLogStore, type LogData } from '@/state/LogStore';
import { lyingQuat, uprightQuat } from '@features/building/logic/pieceFrame';
import type { WeatherPhase } from '@/state/WeatherStore';
import type { VcTestApi } from './TestHarness';

/**
 * Named starting situations for test mode (`?test=<name>`). A scenario picks
 * the world, seed, time and weather, where to stand (from pure world
 * functions, before any chunk loads, so the terrain streams in around it),
 * what to carry, and an optional setup that runs once the scene is ready.
 * URL parameters override every default.
 */
export interface SpawnSpot {
  x: number;
  z: number;
  /** Radians; 0 looks down -Z. */
  yaw?: number;
  pitch?: number;
}

export interface Scenario {
  description: string;
  world?: WorldType;
  seed?: number;
  /** Hour of day (see orbitAngleForHour). */
  time?: number;
  weather?: WeatherPhase;
  give?: string[];
  spawn?: () => SpawnSpot | null;
  setup?: (t: VcTestApi) => Promise<void> | void;
}

/** Seed used when neither the scenario nor the URL names one. */
export const DEFAULT_TEST_SEED = 1337;
const ORIGIN = 16;

/** Yaw that looks from (x, z) toward (tx, tz). */
export const yawToward = (x: number, z: number, tx: number, tz: number): number => Math.atan2(-(tx - x), -(tz - z));

/** First spot outward from the origin (rings of `step` m) where `test` returns a result. */
function searchOut<T>(maxR: number, step: number, test: (x: number, z: number) => T | null): T | null {
  for (let r = 0; r <= maxR; r += step) {
    const n = Math.max(1, Math.round((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const hit = test(Math.round(ORIGIN + Math.cos(a) * r), Math.round(ORIGIN + Math.sin(a) * r));
      if (hit) return hit;
    }
  }
  return null;
}

/** A view over the land from (x, z): the direction whose ground falls away most (never into a hillside). */
export const openViewYaw = (x: number, z: number): number => {
  let best = 0, bestScore = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    let score = 0;
    for (const d of [8, 18, 30, 45]) score += TerrainService.getHeightAt(x + dx * d, z + dz * d);
    if (score < bestScore) { bestScore = score; best = yawToward(x, z, x + dx, z + dz); }
  }
  return best;
};

const DIRS = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);

/** Dry land a little above the water line with open water ahead. */
const shoreSpot = (riverOnly: boolean): SpawnSpot | null =>
  searchOut(1200, 6, (x, z) => {
    const h = TerrainService.getHeightAt(x, z);
    if (h < WATER_LEVEL + 0.6 || h > WATER_LEVEL + 3) return null;
    for (const a of DIRS) {
      const dx = Math.cos(a), dz = Math.sin(a);
      const wx = x + dx * 12, wz = z + dz * 12;
      if (TerrainService.getHeightAt(wx, wz) > WATER_LEVEL - 1.2) continue;
      if (TerrainService.getHeightAt(x + dx * 24, z + dz * 24) > WATER_LEVEL - 0.5) continue;
      if (riverOnly && Math.abs(riverSignedAt(wx, wz, columnInfo(wx, wz).warp)) > RIVER_WIDTH * 0.4) continue;
      return { x, z, yaw: yawToward(x, z, wx, wz), pitch: -0.18 };
    }
    return null;
  });

/** Loaded-chunk hollow nearest to (x, z): world position (Y is the stump base). */
const nearestLoadedHollow = (x: number, z: number): THREE.Vector3 | null => {
  let best: THREE.Vector3 | null = null;
  let bestD = Infinity;
  for (const key of chunkDataManager.getLoadedKeys()) {
    const chunk = chunkDataManager.getChunk(key);
    const packed = chunk?.rootHollowPositions;
    if (!chunk || !packed) continue;
    for (let i = 0; i + 5 < packed.length; i += 6) {
      const hx = packed[i] + chunk.cx * CHUNK_SIZE_XZ;
      const hz = packed[i + 2] + chunk.cz * CHUNK_SIZE_XZ;
      const d = (hx - x) ** 2 + (hz - z) ** 2;
      if (d < bestD) { bestD = d; best = new THREE.Vector3(hx, packed[i + 1], hz); }
    }
  }
  return best;
};

/** The open spot with the most loaded trees within 10 m (trees are stride 5, chunk-local x, y, z). */
const densestTrees = (x: number, z: number): { x: number; z: number } | null => {
  const trees: [number, number][] = [];
  for (const key of chunkDataManager.getLoadedKeys()) {
    const chunk = chunkDataManager.getChunk(key);
    const tp = chunk?.treePositions;
    if (!chunk || !tp) continue;
    for (let i = 0; i + 4 < tp.length; i += 5) trees.push([tp[i] + chunk.cx * CHUNK_SIZE_XZ, tp[i + 2] + chunk.cz * CHUNK_SIZE_XZ]);
  }
  let best: { x: number; z: number } | null = null, bestN = 0;
  for (let gx = x - 64; gx <= x + 64; gx += 4) {
    for (let gz = z - 64; gz <= z + 64; gz += 4) {
      let n = 0, blocked = false;
      for (const [tx, tz] of trees) {
        const d = (tx - gx) ** 2 + (tz - gz) ** 2;
        if (d < 2.5 ** 2) { blocked = true; break; } // not inside a trunk
        if (d < 100) n++;
      }
      if (!blocked && n > bestN && TerrainService.getHeightAt(gx, gz) > WATER_LEVEL + 0.5) { bestN = n; best = { x: gx, z: gz }; }
    }
  }
  return best;
};

/**
 * An air pocket under solid rock near (x, z): a column with at least 4 m of
 * rock overhead, then 2.5 m of air, then a floor. Needs the chunks loaded.
 */
const findCaveNear = (x: number, z: number): THREE.Vector3 | null => {
  for (let r = 0; r <= 40; r += 2) {
    const n = Math.max(1, Math.round((2 * Math.PI * r) / 2));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const cx = Math.round(x + Math.cos(a) * r), cz = Math.round(z + Math.sin(a) * r);
      const top = TerrainService.getHeightAt(cx, cz);
      let rock = 0, air = 0;
      for (let y = Math.floor(top) - 1; y > top - 60; y--) {
        const solid = terrainRuntime.isSolidAtWorld(cx + 0.5, y + 0.5, cz + 0.5);
        if (solid == null) break;
        if (solid) {
          if (air >= 3 && rock >= 4) return new THREE.Vector3(cx + 0.5, y + 1 + 0.9, cz + 0.5);
          rock += 1; air = 0;
        } else if (rock >= 4) {
          air += 1;
        }
      }
    }
  }
  return null;
};

/** Offsets from the player: forward along the view, right across it. */
const frameAt = (t: VcTestApi) => {
  const p = t.player();
  const yaw = t.camera().yaw;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const at = (f: number, r: number) => new THREE.Vector3(p.x, 0, p.z).addScaledVector(fwd, f).addScaledVector(right, r);
  return { fwd, right, at };
};

const q4 = (q: THREE.Quaternion): [number, number, number, number] => [q.x, q.y, q.z, q.w];

export const SCENARIOS: Record<string, Scenario> = {
  meadow: {
    description: 'Default world at the usual spawn, mid-morning, clear.',
  },
  forest: {
    description: 'Standing among the densest trees near spawn (leaf shading, sticks).',
    give: ['axe'],
    // Head for the leafiest land nearby, then into the thickest trees that actually grew.
    spawn: () => {
      let best: SpawnSpot | null = null, bestCover = 0;
      searchOut(700, 16, (x, z) => {
        if (TerrainService.getHeightAt(x, z) < WATER_LEVEL + 2) return null;
        const c = BiomeManager.getClimate(x, z);
        const cover = BiomeManager.getTreeCover(c.temp, c.humid, c.erosion, BiomeManager.getBiomeAt(x, z));
        if (cover > bestCover) { bestCover = cover; best = { x, z }; }
        return null;
      });
      return best;
    },
    setup: async (t) => {
      const p = t.player();
      const spot = densestTrees(p.x, p.z);
      if (spot && Math.hypot(spot.x - p.x, spot.z - p.z) > 3) await t.goto(spot.x, spot.z);
    },
  },
  shore: {
    description: 'On a low shore looking out over open water.',
    spawn: () => shoreSpot(false),
  },
  river: {
    description: 'On a river bank looking across the water (current, ripples).',
    spawn: () => shoreSpot(true),
  },
  hollow: {
    description: 'A dormant Root Hollow a few metres ahead.',
    spawn: () => {
      const g = findNearestGroveCenter(ORIGIN, ORIGIN, 1200, 16);
      if (!g) return null;
      // Stand back toward the origin so the hollow is in front.
      const d = Math.hypot(ORIGIN - g.x, ORIGIN - g.z) || 1;
      const x = g.x + ((ORIGIN - g.x) / d) * 14, z = g.z + ((ORIGIN - g.z) / d) * 14;
      return { x, z, yaw: yawToward(x, z, g.x, g.z) };
    },
    setup: (t) => {
      const p = t.player();
      const h = nearestLoadedHollow(p.x, p.z);
      if (h) t.lookAt(h.x, h.y + 1.2, h.z);
    },
  },
  cave: {
    description: 'Underground in the nearest cave pocket (GI darkness, keeper glow).',
    give: ['torch:3'],
    setup: async (t) => {
      const p = t.player();
      const spot = findCaveNear(p.x, p.z);
      if (!spot) throw new Error('no cave pocket within 40 m of spawn');
      t.teleport(spot.x, spot.y, spot.z);
      await t.settle();
    },
  },
  night: {
    description: 'The usual spawn at night with a torch.',
    time: 23,
    give: ['torch:3'],
  },
  rain: {
    description: 'The usual spawn in steady rain.',
    weather: 'rain',
  },
  carpentry: {
    description: 'A workbench ahead with a log on it, loose logs and planks beside it, saw and axe in hand.',
    give: ['saw', 'flintaxe', 'copper:4'],
    setup: async (t) => {
      const { fwd, right, at } = frameAt(t);
      const ground = (v: THREE.Vector3) => t.groundAt(v.x, v.z);
      const c = at(2.4, 0);
      const g = ground(c);
      const bark = '#5b4a38';
      const topId = 'test-bench-top';
      const pieces: LogData[] = [
        { id: 'test-bench-leg-a', kind: 'plank', state: 'placed', length: 0.8, radius: 0.12, bark,
          position: [c.x - right.x * 0.45, g + 0.4, c.z - right.z * 0.45], rotation: q4(uprightQuat(fwd)) },
        { id: 'test-bench-leg-b', kind: 'plank', state: 'placed', length: 0.8, radius: 0.12, bark,
          position: [c.x + right.x * 0.45, g + 0.4, c.z + right.z * 0.45], rotation: q4(uprightQuat(fwd)) },
        { id: topId, kind: 'plank', state: 'placed', length: 1.3, radius: 0.13, bark,
          position: [c.x, g + 0.83, c.z], rotation: q4(lyingQuat(right)) },
        // A short log waiting on the bench (right click the bench to shape it).
        { id: 'test-bench-work', kind: 'log', state: 'placed', onBench: topId, length: 1.2, radius: 0.12, bark,
          position: [c.x, g + 0.86 + 0.12, c.z], rotation: q4(lyingQuat(right)) },
      ];
      // Loose stock to the right of the bench.
      for (let i = 0; i < 2; i++) {
        const p = at(1.2 + i * 0.5, 2.2);
        pieces.push({ id: `test-log-${i}`, kind: 'log', state: 'loose', length: 3, radius: 0.16, bark,
          position: [p.x, ground(p) + 0.25, p.z], rotation: q4(lyingQuat(fwd)) });
      }
      for (let i = 0; i < 3; i++) {
        const p = at(1.0 + i * 0.3, -2.0);
        pieces.push({ id: `test-plank-${i}`, kind: 'plank', state: 'loose', length: 1.8, radius: 0.13, bark,
          position: [p.x, ground(p) + 0.1 + i * 0.07, p.z], rotation: q4(lyingQuat(fwd)) });
      }
      useLogStore.getState().addLogs(pieces);
      t.lookAt(c.x, g + 0.7, c.z);
    },
  },
  sky: {
    description: 'Sky Archipelago: standing on a floating island.',
    world: WorldType.SKY_ISLANDS,
  },
};

export const scenarioNames = (): string[] => Object.keys(SCENARIOS);
