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
    let maxSlope = 0;
    let tears = 0;
    for (let x = -2000; x <= 2000; x += 97) {
      for (let z = -2000; z <= 2000; z += 89) {
        const h = columnInfo(x, z).height;
        expect(Number.isFinite(h)).toBe(true);
        expect(h).toBeLessThanOrEqual(MAX_SURFACE_Y);
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const big = Math.abs(columnInfo(x + dx * 0.02, z + dz * 0.02).height - h);
          const small = Math.abs(columnInfo(x + dx * 0.002, z + dz * 0.002).height - h);
          maxSlope = Math.max(maxSlope, big / 0.02);
          // A continuous surface changes ~10x less over a 10x smaller step; a
          // discontinuity (e.g. a piecewise parameter step) jumps the same at any scale.
          if (big > 0.05 && small > big * 0.5) tears++;
        }
      }
    }
    expect(tears).toBe(0);
    // Cliffs yes, walls no (steeper than ~25 m per m reads as a tear on screen).
    expect(maxSlope).toBeLessThan(25);
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
