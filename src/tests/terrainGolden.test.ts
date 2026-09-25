import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { ISO_LEVEL } from '@/constants';

/**
 * Golden-output guard for the terrain pipeline.
 *
 * Optimisations to generateChunk / generateMesh must not change what players
 * see or invalidate saved edits. This test fingerprints, per chunk:
 *  - the solid/air sign of every voxel and every material id,
 *  - every generated placement buffer (trees, flora, rocks, hollows...),
 *  - the mesh (vertex positions, normals and indices, quantised).
 *
 * Density *magnitudes* far from any surface are deliberately not fingerprinted:
 * the mesher never reads them, so the generator is free to approximate there.
 *
 * Intentional generator changes: bump GEN_VERSION and regenerate with
 *   UPDATE_GOLDEN=1 npx vitest run src/tests/terrainGolden.test.ts
 */

const GOLDEN_PATH = resolve(__dirname, '__golden__/terrain.json');
const SEED = 1337;
const CHUNKS: Array<[number, number]> = [[0, 0], [5, -3], [-12, 40]];

const fnv = (h: number, v: number): number => Math.imul(h ^ (v & 0xff), 16777619) >>> 0;
const hashInts = (h: number, v: number): number => {
  h = fnv(h, v); h = fnv(h, v >>> 8); h = fnv(h, v >>> 16); return fnv(h, v >>> 24);
};
const hashFloats = (arr: ArrayLike<number>, quantum: number): string => {
  let h = 2166136261;
  for (let i = 0; i < arr.length; i++) h = hashInts(h, Math.round(arr[i] / quantum) | 0);
  return `${arr.length}:${h.toString(16)}`;
};

const fingerprint = (cx: number, cz: number): Record<string, string> => {
  const chunk = TerrainService.generateChunk(cx, cz);
  let signHash = 2166136261;
  let matHash = 2166136261;
  for (let i = 0; i < chunk.density.length; i++) {
    signHash = fnv(signHash, chunk.density[i] > ISO_LEVEL ? 1 : 0);
    matHash = fnv(matHash, chunk.material[i]);
  }
  const mesh = generateMesh(chunk.density, chunk.material, chunk.metadata.wetness, chunk.metadata.mossiness);
  return {
    sign: signHash.toString(16),
    material: matHash.toString(16),
    trees: hashFloats(chunk.treePositions, 1e-3),
    flora: hashFloats(chunk.floraPositions, 1e-3),
    sticks: hashFloats(chunk.stickPositions, 1e-3),
    rocks: hashFloats(chunk.rockPositions, 1e-3),
    largeRocks: hashFloats(chunk.largeRockPositions, 1e-3),
    hollows: hashFloats(chunk.rootHollowPositions, 1e-3),
    fireflies: hashFloats(chunk.fireflyPositions, 1e-3),
    meshPositions: hashFloats(mesh.positions, 1e-3),
    meshNormals: hashFloats(mesh.normals, 1e-2),
    meshIndices: hashFloats(mesh.indices, 1),
  };
};

describe('Terrain golden output', () => {
  it('matches the recorded fingerprints for the reference chunks', () => {
    BiomeManager.reinitialize(SEED);
    initializeNoise(SEED);
    BiomeManager.setWorldType(WorldType.DEFAULT);

    const actual: Record<string, Record<string, string>> = {};
    for (const [cx, cz] of CHUNKS) actual[`${cx},${cz}`] = fingerprint(cx, cz);

    if (process.env.UPDATE_GOLDEN || !existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n');
    }
    const expected = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));
    expect(actual).toEqual(expected);
  }, 120_000);
});
