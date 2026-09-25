import { describe, it, expect, beforeAll } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { CHUNK_SIZE_XZ } from '@/constants';
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

  it('LUSH worlds contain hot biomes', () => {
    expect(coldShare(WorldType.LUSH).hot).toBeGreaterThan(0.05);
  });
});
