import { bench, describe } from 'vitest';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { generateLightGrid, extractLuminaLights, getSkyLightConfig } from '@core/lighting/lightPropagation';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';
import { buildGeneratedChunk } from '@features/terrain/logic/chunkPipeline';

/**
 * Terrain pipeline benchmark: `npm run bench`.
 * Mirrors the per-chunk work a terrain worker does for GENERATE.
 * Not part of `npm run test:unit`.
 */
BiomeManager.reinitialize(1337);
initializeNoise(1337);
BiomeManager.setWorldType(WorldType.DEFAULT);

const CHUNKS: Array<[number, number]> = [[0, 0], [5, -3], [-12, 40], [20, 20]];
const generated = CHUNKS.map(([cx, cz]) => TerrainService.generateChunk(cx, cz));

describe('terrain pipeline (per chunk)', () => {
  let i = 0;
  bench('generateChunk', () => {
    const [cx, cz] = CHUNKS[i++ % CHUNKS.length];
    TerrainService.generateChunk(cx, cz);
  }, { iterations: 8, warmupIterations: 2 });

  let j = 0;
  bench('generateLightGrid', () => {
    const c = generated[j++ % generated.length];
    generateLightGrid(c.density, extractLuminaLights(c.floraPositions), getSkyLightConfig(0.5));
  }, { iterations: 8, warmupIterations: 2 });

  let k = 0;
  bench('generateMesh', () => {
    const c = generated[k++ % generated.length];
    const grid = generateLightGrid(c.density, extractLuminaLights(c.floraPositions), getSkyLightConfig(0.5));
    generateMesh(c.density, c.material, c.metadata.wetness, c.metadata.mossiness, grid);
  }, { iterations: 8, warmupIterations: 2 });

  let m = 0;
  bench('full worker GENERATE (buildGeneratedChunk)', () => {
    const [cx, cz] = CHUNKS[m++ % CHUNKS.length];
    buildGeneratedChunk(cx, cz, [], []);
  }, { iterations: 8, warmupIterations: 2 });
});
