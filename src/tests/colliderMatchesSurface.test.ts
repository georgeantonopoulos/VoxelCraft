import { describe, it, expect, beforeAll } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { CHUNK_SIZE_XZ } from '@/constants';
import type { MeshData } from '@/types';

/**
 * The physics collider must follow the rendered terrain. A coarse collider let
 * players fall through thin cave roofs and walk into cave walls far enough for
 * the camera to clip through them.
 *
 * For vertical rays through each chunk, every rendered surface crossing must
 * have a collider surface within TOLERANCE.
 */
const TOLERANCE = 0.35;

/** Heights (y) where a vertical line at (x, z) crosses a triangle soup. */
function crossings(pos: Float32Array, idx: Uint32Array, x: number, z: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[c], cz = pos[c + 2];
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    out.push(l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1]);
  }
  return out;
}

/** Collider crossings for a chunk (heightfield or trimesh), chunk-local coordinates. */
function colliderCrossings(m: MeshData, x: number, z: number): number[] {
  if (m.isHeightfield && m.colliderHeightfield) {
    const n = CHUNK_SIZE_XZ + 1;
    const ix = Math.min(CHUNK_SIZE_XZ - 1, Math.floor(x)), iz = Math.min(CHUNK_SIZE_XZ - 1, Math.floor(z));
    const fx = x - ix, fz = z - iz;
    const h = (gx: number, gz: number) => m.colliderHeightfield![gz + gx * n];
    return [(h(ix, iz) * (1 - fx) + h(ix + 1, iz) * fx) * (1 - fz) + (h(ix, iz + 1) * (1 - fx) + h(ix + 1, iz + 1) * fx) * fz];
  }
  return crossings(m.colliderPositions!, m.colliderIndices!, x, z);
}

const meshes: MeshData[] = [];
beforeAll(() => {
  BiomeManager.reinitialize(1337); initializeNoise(1337); BiomeManager.setWorldType(WorldType.DEFAULT);
  for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) {
    const c = TerrainService.generateChunk(cx, cz);
    meshes.push(generateMesh(c.density, c.material, c.metadata.wetness, c.metadata.mossiness));
  }
}, 120_000);

describe('Terrain collider', () => {
  it('has a collider surface at every rendered surface (no holes, no sunken walls)', () => {
    let checked = 0, missing = 0, trimeshChunks = 0;
    const worst: string[] = [];
    for (const m of meshes) {
      if (!m.isHeightfield) trimeshChunks++;
      for (let x = 0.37; x < CHUNK_SIZE_XZ - 0.5; x += 1.3) {
        for (let z = 0.61; z < CHUNK_SIZE_XZ - 0.5; z += 1.3) {
          const col = colliderCrossings(m, x, z);
          for (const y of crossings(m.positions, m.indices, x, z)) {
            checked++;
            const d = Math.min(...col.map((c) => Math.abs(c - y)), Infinity);
            if (d > TOLERANCE) { missing++; if (worst.length < 5) worst.push(`(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) off by ${d.toFixed(2)}`); }
          }
        }
      }
    }
    expect(trimeshChunks).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(2000);
    expect({ missing, worst }).toEqual({ missing: 0, worst: [] });
  });
});
