import { describe, it, expect, beforeAll } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { CHUNK_SIZE_XZ } from '@/constants';
import type { MeshData } from '@/types';

/**
 * Vertices on a shared chunk border must shade identically from both sides
 * (normal, cavity, material weights), otherwise a visible seam line appears.
 */
let a: MeshData, b: MeshData, c: MeshData;

beforeAll(() => {
  BiomeManager.reinitialize(1337); initializeNoise(1337); BiomeManager.setWorldType(WorldType.DEFAULT);
  const ca = TerrainService.generateChunk(0, 0);
  const cb = TerrainService.generateChunk(1, 0);
  a = generateMesh(ca.density, ca.material, ca.metadata.wetness, ca.metadata.mossiness, undefined, null, 0, 0);
  b = generateMesh(cb.density, cb.material, cb.metadata.wetness, cb.metadata.mossiness, undefined, null, CHUNK_SIZE_XZ, 0);
  const cc = TerrainService.generateChunk(0, 1);
  c = generateMesh(cc.density, cc.material, cc.metadata.wetness, cc.metadata.mossiness, undefined, null, 0, CHUNK_SIZE_XZ);
}, 60_000);

/** Vertices exactly on the x = 32 plane (chunk a) / x = 0 plane (chunk b), keyed by world position. */
const borderVerts = (m: MeshData, axis: 0 | 2, plane: number, offset: number) => {
  const map = new Map<string, number>();
  for (let v = 0; v < m.positions.length / 3; v++) {
    if (Math.abs(m.positions[v * 3 + axis] - plane) > 1e-4) continue;
    const p = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]];
    p[axis] += offset;
    const key = p.map((n) => n.toFixed(3)).join(',');
    map.set(key, v);
  }
  return map;
};

describe('Chunk border seams', () => {
  const compare = (a: MeshData, b: MeshData, va: Map<string, number>, vb: Map<string, number>) => {
    let shared = 0, badNormal = 0, badCavity = 0, badWeights = 0;
    for (const [key, ia] of va) {
      const ib = vb.get(key);
      if (ib === undefined) continue;
      shared++;
      const dot = a.normals[ia * 3] * b.normals[ib * 3] + a.normals[ia * 3 + 1] * b.normals[ib * 3 + 1] + a.normals[ia * 3 + 2] * b.normals[ib * 3 + 2];
      if (dot < Math.cos((2 * Math.PI) / 180)) badNormal++;
      if (Math.abs(a.cavity[ia] - b.cavity[ib]) > 0.02) badCavity++;
      for (const k of ['matWeightsA', 'matWeightsB', 'matWeightsC', 'matWeightsD'] as const) {
        for (let c = 0; c < 4; c++) if (Math.abs(a[k][ia * 4 + c] - b[k][ib * 4 + c]) > 0.02) { badWeights++; break; }
      }
    }
    expect(shared).toBeGreaterThan(20);
    expect({ badNormal, badCavity, badWeights }).toEqual({ badNormal: 0, badCavity: 0, badWeights: 0 });
  };

  it('X border: shared vertices match (normals, cavity, material weights)', () => {
    compare(a, b, borderVerts(a, 0, CHUNK_SIZE_XZ, 0), borderVerts(b, 0, 0, CHUNK_SIZE_XZ));
  });

  it('Z border: shared vertices match (normals, cavity, material weights)', () => {
    compare(a, c, borderVerts(a, 2, CHUNK_SIZE_XZ, 0), borderVerts(c, 2, 0, CHUNK_SIZE_XZ));
  });
});
