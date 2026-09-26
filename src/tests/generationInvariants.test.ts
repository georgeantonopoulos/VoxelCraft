import { describe, it, expect, beforeAll } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, ISO_LEVEL } from '@/constants';
import { MaterialType } from '@/types';
import { RockVariant } from '@features/terrain/logic/GroundItemKinds';

/**
 * Invariants for generated placements (regressions found by the terrain audit).
 * Chunks are sampled in a 4x4 block so cross-border rules are exercised.
 */
const SEED = 1337;
type Gen = ReturnType<typeof TerrainService.generateChunk>;
const chunks = new Map<string, Gen>();

beforeAll(() => {
  BiomeManager.reinitialize(SEED);
  initializeNoise(SEED);
  BiomeManager.setWorldType(WorldType.DEFAULT);
  for (let cx = 0; cx < 4; cx++) for (let cz = 0; cz < 4; cz++) chunks.set(`${cx},${cz}`, TerrainService.generateChunk(cx, cz));
}, 120_000);

describe('Surface materials', () => {
  it('keeps subsoil off the exposed surface (no dirt lines where overhang noise fades)', () => {
    // The top solid voxel of a column is DIRT only in dirt-surfaced biomes
    // (savanna) and the drained ground around dormant Root Hollows; in grassy
    // chunks the topsoil post-pass restores grass.
    const SX = TOTAL_SIZE_XZ, SY = TOTAL_SIZE_Y;
    let grassTops = 0, dirtTops = 0;
    for (const [key, c] of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      for (let z = 2; z < SX - 2; z++) for (let x = 2; x < SX - 2; x++) {
        if (BiomeManager.getSacredGroveInfo(cx * CHUNK_SIZE_XZ + x - 2, cz * CHUNK_SIZE_XZ + z - 2).inGrove) continue;
        for (let y = SY - 1; y >= 0; y--) {
          const i = x + y * SX + z * SX * SY;
          if (c.density[i] <= ISO_LEVEL) continue;
          if (c.material[i] === MaterialType.GRASS) grassTops++;
          if (c.material[i] === MaterialType.DIRT) dirtTops++;
          break;
        }
      }
    }
    expect(grassTops).toBeGreaterThan(1000);
    expect(dirtTops / (grassTops + dirtTops)).toBeLessThan(0.03);
  });
});

describe('Generated placements', () => {
  it('never produces NaN positions (stick/firefly passes read trees with the right stride)', () => {
    for (const c of chunks.values()) {
      for (const arr of [c.stickPositions, c.fireflyPositions, c.rockPositions, c.treePositions, c.floraPositions]) {
        for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
      }
    }
  });

  it('places sticks near trees (within the scatter radius)', () => {
    let checked = 0;
    for (const c of chunks.values()) {
      for (let s = 0; s < c.stickPositions.length; s += 8) {
        const sx = c.stickPositions[s], sz = c.stickPositions[s + 2];
        let best = Infinity;
        for (let t = 0; t < c.treePositions.length; t += 5) {
          best = Math.min(best, Math.hypot(c.treePositions[t] - sx, c.treePositions[t + 2] - sz));
        }
        expect(best).toBeLessThan(3.0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('assigns every lumina flora to exactly one chunk (no cross-border duplicates)', () => {
    for (const [key, c] of chunks) {
      const [cx, cz] = key.split(',').map(Number);
      for (let i = 0; i < c.floraPositions.length; i += 4) {
        const x = c.floraPositions[i], z = c.floraPositions[i + 2];
        expect(Math.floor(x / CHUNK_SIZE_XZ)).toBe(cx);
        expect(Math.floor(z / CHUNK_SIZE_XZ)).toBe(cz);
      }
    }
  });

  it('spreads surface rocks across the whole chunk (uniform placement hash)', () => {
    const xs: number[] = [];
    for (const c of chunks.values()) for (let i = 0; i < c.rockPositions.length; i += 8) xs.push(c.rockPositions[i]);
    if (xs.length < 8) return; // biome-dependent; nothing to assert
    expect(Math.min(...xs)).toBeLessThan(8);
    expect(Math.max(...xs)).toBeGreaterThan(24);
  });

  it('can place cave rocks (the floor search starts below the surface)', () => {
    let cave = 0;
    for (let cx = -6; cx < 6 && cave === 0; cx++) {
      for (let cz = -6; cz < 6 && cave === 0; cz += 3) {
        const c = TerrainService.generateChunk(cx, cz);
        for (let i = 0; i < c.rockPositions.length; i += 8) if (c.rockPositions[i + 6] === RockVariant.CAVE) cave++;
      }
    }
    expect(cave).toBeGreaterThan(0);
  }, 120_000);
});

describe('World types', () => {
  const coldShare = (type: WorldType) => {
    BiomeManager.setWorldType(type);
    let cold = 0, hot = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const b = BiomeManager.getBiomeAt((i * 97) % 6000 - 3000, Math.floor(i / 60) * 97 - 3000);
      if (b === 'SNOW' || b === 'ICE_SPIKES') cold++;
      if (b === 'JUNGLE' || b === 'DESERT' || b === 'RED_DESERT' || b === 'SAVANNA') hot++;
    }
    BiomeManager.setWorldType(WorldType.DEFAULT);
    return { cold: cold / N, hot: hot / N };
  };

  it('FROZEN worlds are mostly snow and ice', () => {
    expect(coldShare(WorldType.FROZEN).cold).toBeGreaterThan(0.4);
  });

  it('every world type has Root Hollows to find (the Keeper\'s Path depends on them)', async () => {
    const { findNearestGroveCenter } = await import('@features/grove/hollowSense');
    for (const type of [WorldType.DEFAULT, WorldType.FROZEN, WorldType.LUSH, WorldType.SKY_ISLANDS, WorldType.CHAOS]) {
      BiomeManager.setWorldType(type);
      const hit = findNearestGroveCenter(16, 16, 768, 24);
      BiomeManager.setWorldType(WorldType.DEFAULT);
      expect(hit, `${type} has a grove within 768 m`).not.toBeNull();
    }
  });

  it('LUSH worlds contain hot biomes', () => {
    expect(coldShare(WorldType.LUSH).hot).toBeGreaterThan(0.05);
  });

  it('LUSH worlds are largely jungle (it never got hot enough before)', () => {
    BiomeManager.setWorldType(WorldType.LUSH);
    let jungle = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      if (BiomeManager.getBiomeAt((i * 97) % 6000 - 3000, Math.floor(i / 60) * 97 - 3000) === 'JUNGLE') jungle++;
    }
    BiomeManager.setWorldType(WorldType.DEFAULT);
    expect(jungle / N).toBeGreaterThan(0.3);
  });
});

describe('Early-game resources', () => {
  it('places visible surface stones in grassland/forest (not only mountains, beaches and caves)', () => {
    let lowlandChunks = 0, surfaceStones = 0;
    for (let cx = -6; cx < 6; cx++) {
      for (let cz = -6; cz < 6; cz++) {
        const b = BiomeManager.getBiomeAt(cx * CHUNK_SIZE_XZ + 16, cz * CHUNK_SIZE_XZ + 16);
        if (b !== 'PLAINS' && b !== 'THE_GROVE' && b !== 'JUNGLE') continue;
        lowlandChunks++;
        const c = TerrainService.generateChunk(cx, cz);
        for (let i = 0; i < c.rockPositions.length; i += 8) {
          if (c.rockPositions[i + 1] < -1000) continue;
          if (c.rockPositions[i + 6] === RockVariant.CAVE) continue; // underground, not visible
          surfaceStones++;
        }
      }
    }
    expect(lowlandChunks).toBeGreaterThan(20);
    // ~1.4 per chunk with field stones; the old generator gave ~0.5.
    expect(surfaceStones / lowlandChunks).toBeGreaterThan(1.0);
  }, 300_000);
});
