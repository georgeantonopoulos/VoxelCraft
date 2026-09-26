import { describe, it, expect, beforeAll } from 'vitest';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { computeRiverFlow, FLOW_GRID } from '@features/terrain/logic/waterFlow';

describe('river current field', () => {
  // Find a chunk a river runs through (the river network is fixed by the noise).
  const findRiverChunk = (): [number, number] => {
    for (let r = 0; r < 60; r++) {
      for (let cx = -r; cx <= r; cx++) {
        for (const cz of [-r, r]) {
          const f = computeRiverFlow(cx, cz);
          for (let i = 2; i < f.length; i += 3) if (f[i] > 0.9) return [cx, cz];
        }
      }
    }
    throw new Error('no river found');
  };
  let cx = 0, cz = 0;
  beforeAll(() => {
    BiomeManager.reinitialize(4242); initializeNoise(4242); BiomeManager.setWorldType(WorldType.DEFAULT);
    [cx, cz] = findRiverChunk();
  });

  it('costs little per chunk (computed on the main thread when water mounts)', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) computeRiverFlow(cx + i, cz);
    expect((performance.now() - t0) / 20).toBeLessThan(8);
  });

  it('points along the river with unit direction where it flows', () => {
    const f = computeRiverFlow(cx, cz);
    for (let i = 0; i < FLOW_GRID * FLOW_GRID; i++) {
      if (f[i * 3 + 2] > 0) expect(Math.hypot(f[i * 3], f[i * 3 + 1])).toBeCloseTo(1, 4);
    }
  });

  it('agrees on both sides of a chunk border', () => {
    const a = computeRiverFlow(cx, cz), b = computeRiverFlow(cx + 1, cz);
    for (let j = 0; j < FLOW_GRID; j++) {
      const ia = ((FLOW_GRID - 1) + j * FLOW_GRID) * 3, ib = (0 + j * FLOW_GRID) * 3;
      for (let k = 0; k < 3; k++) expect(a[ia + k]).toBeCloseTo(b[ib + k], 5);
    }
  });

  it('keeps one direction along the river (no flips between neighbours)', () => {
    const f = computeRiverFlow(cx, cz);
    for (let j = 0; j < FLOW_GRID; j++) {
      for (let i = 0; i + 1 < FLOW_GRID; i++) {
        const a = (i + j * FLOW_GRID) * 3, b = a + 3;
        if (f[a + 2] > 0.5 && f[b + 2] > 0.5) expect(f[a] * f[b] + f[a + 1] * f[b + 1]).toBeGreaterThan(0);
      }
    }
  });
});
