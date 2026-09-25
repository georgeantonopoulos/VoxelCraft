import { describe, it, expect } from 'vitest';
import { dilateWaterMask, mergeMaskRects, generateWaterSurfaceMesh } from '@features/terrain/logic/mesher';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET, WATER_LEVEL, CHUNK_SIZE_XZ } from '@/constants';
import { MaterialType } from '@/types';

describe('Water surface mesh', () => {
  it('covers exactly the mask cells with merged rectangles', () => {
    const w = 6, h = 5;
    const mask = new Uint8Array(w * h);
    for (let z = 1; z < 4; z++) for (let x = 2; x < 5; x++) mask[x + z * w] = 1;
    mask[0] = 1;
    const rects = mergeMaskRects(mask, w, h);
    const cover = new Uint8Array(w * h);
    for (const r of rects) for (let z = r.z0; z < r.z1; z++) for (let x = r.x0; x < r.x1; x++) { expect(cover[x + z * w]).toBe(0); cover[x + z * w] = 1; }
    expect([...cover]).toEqual([...mask]);
    expect(rects.length).toBe(2);
  });

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
    expect(maxX).toBeLessThanOrEqual(11); // 10 sea cells + 1 dilation, not the full CHUNK_SIZE_XZ
    expect(maxX).toBeLessThan(CHUNK_SIZE_XZ);
  });
});
