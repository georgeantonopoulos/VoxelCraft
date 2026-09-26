import { describe, it, expect } from 'vitest';
import { dilateWaterMask, generateWaterSurfaceMesh, floodShallows, dropShallowPools } from '@features/terrain/logic/mesher';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET, WATER_LEVEL, CHUNK_SIZE_XZ } from '@/constants';
import { MaterialType } from '@/types';

describe('Water surface mesh', () => {
  it('dilates by one cell', () => {
    const w = 5, h = 5, m = new Uint8Array(w * h);
    m[2 + 2 * w] = 1;
    expect(dilateWaterMask(m, w, h).reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('does not put water over a chunk half that is land (e.g. a cave or pit area)', () => {
    const size = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;
    const density = new Float32Array(size).fill(-1);
    const material = new Uint8Array(size);
    const seaY = Math.floor(WATER_LEVEL - MESH_Y_OFFSET) + PAD;
    for (let z = 0; z < TOTAL_SIZE_XZ; z++) for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
      const isSea = x < PAD + 10; // west part is open sea, east part land (solid to above sea)
      for (let y = 0; y < TOTAL_SIZE_Y; y++) {
        const i = x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
        if (isSea) { if (y <= seaY) material[i] = MaterialType.WATER; }
        else if (y <= seaY + 6) { density[i] = 1; material[i] = MaterialType.STONE; }
      }
    }
    const mesh = generateWaterSurfaceMesh(density, material);
    let maxX = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) maxX = Math.max(maxX, mesh.positions[i]);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(maxX).toBeLessThanOrEqual(12); // 10 sea cells + 2 dilation, not the full CHUNK_SIZE_XZ
    expect(maxX).toBeLessThan(CHUNK_SIZE_XZ);
    // Watertight: every vertex position appears once (shared grid, no T-junctions).
    const keys = new Set<string>();
    for (let i = 0; i < mesh.positions.length; i += 3) keys.add(`${mesh.positions[i]},${mesh.positions[i + 2]}`);
    expect(keys.size).toBe(mesh.positions.length / 3);
  });
});

describe('Shallow flats', () => {
  it('floods connected columns below sea level, but not higher ground', () => {
    const w = 5, h = 1;
    const sea = new Uint8Array([1, 0, 0, 0, 0]);
    const tops = new Float32Array([-2, 4.2, 4.4, 6.0, 3.0]); // col 4 is below sea level but cut off by land
    expect(Array.from(floodShallows(sea, tops, w, h, 4.5))).toEqual([1, 1, 1, 0, 0]);
  });
});

describe('dropShallowPools', () => {
  // 5x3 grid: a lone 10 cm puddle in the middle, a deep pool at the right edge.
  const w = 5, h = 3;
  const wet = Uint8Array.from([
    0, 0, 0, 0, 1,
    0, 1, 0, 0, 1,
    0, 0, 0, 0, 1,
  ]);
  const tops = Float32Array.from([
    9, 9, 9, 9, 2,
    9, 4.4, 9, 9, 2,
    9, 9, 9, 9, 2,
  ]);

  it('removes an interior puddle that never gets deep (it rendered as a foam slab)', () => {
    const out = dropShallowPools(wet, tops, w, h, 4.5, 0.5);
    expect(out[1 + 1 * w]).toBe(0);
  });

  it('keeps deep water and water touching the chunk border', () => {
    const out = dropShallowPools(wet, tops, w, h, 4.5, 0.5);
    expect(out[4]).toBe(1);
    const deepInterior = dropShallowPools(wet, Float32Array.from(tops.map((t, i) => (i === 6 ? 3.0 : t))), w, h, 4.5, 0.5);
    expect(deepInterior[6]).toBe(1);
  });
});
