import { describe, it, expect, beforeAll } from 'vitest';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { columnInfo, MAX_SURFACE_Y } from '@features/terrain/logic/terrainShape';
import { WATER_LEVEL } from '@/constants';

describe('terrain shape', () => {
  beforeAll(() => {
    BiomeManager.reinitialize(4242); initializeNoise(4242); BiomeManager.setWorldType(WorldType.DEFAULT);
  });

  it('stays finite, inside the column budget and free of tears', () => {
    let maxMicro = 0;
    for (let x = -2000; x <= 2000; x += 97) {
      for (let z = -2000; z <= 2000; z += 89) {
        const h = columnInfo(x, z).height;
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeLessThanOrEqual(MAX_SURFACE_Y);
        // A continuous surface barely moves over 2 cm even on cliffs (<= ~10 m/m);
        // a discontinuity (e.g. a piecewise parameter step) jumps the same at any scale.
        maxMicro = Math.max(maxMicro, Math.abs(columnInfo(x + 0.02, z).height - h), Math.abs(columnInfo(x, z + 0.02).height - h));
      }
    }
    expect(maxMicro).toBeLessThan(0.3);
  });

  it('has relief: mountains well above sea level and river valleys cut down to it', () => {
    let highest = -Infinity;
    let riverish = 0;
    for (let x = -3000; x <= 3000; x += 40) {
      for (let z = -3000; z <= 3000; z += 40) {
        const h = columnInfo(x, z).height;
        highest = Math.max(highest, h);
        // A low column surrounded by much higher land 60 m away = valley floor.
        if (h < WATER_LEVEL + 1 && h > WATER_LEVEL - 4) {
          const around = [columnInfo(x + 60, z).height, columnInfo(x - 60, z).height, columnInfo(x, z + 60).height, columnInfo(x, z - 60).height];
          if (Math.max(...around) > WATER_LEVEL + 12) riverish++;
        }
      }
    }
    expect(highest).toBeGreaterThan(45);
    expect(riverish).toBeGreaterThan(5);
  });

  it('terrain parameters are continuous across the continentalness breakpoints', () => {
    for (const c of [-0.3, 0.1]) {
      for (const e of [-0.6, 0.0, 0.8]) {
        const lo = BiomeManager.getTerrainParametersFromMetrics(0.1, 0.1, c - 1e-6, e);
        const hi = BiomeManager.getTerrainParametersFromMetrics(0.1, 0.1, c + 1e-6, e);
        expect(Math.abs(lo.baseHeight - hi.baseHeight)).toBeLessThan(0.01);
        expect(Math.abs(lo.amp - hi.amp)).toBeLessThan(0.01);
      }
    }
  });
});
