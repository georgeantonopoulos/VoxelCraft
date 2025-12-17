import { generateMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';

const ctx: Worker = self as any;

/**
 * Mesh-only worker.
 *
 * Keep this worker pure (no DB, no biome queries) so it can be scaled into a pool later.
 * It accepts voxel fields and produces renderable mesh buffers.
 */
ctx.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'MESH_GENERATE' || type === 'MESH_REMESH') {
      const { key, density, material, wetness, mossiness } = payload;

      // Keep overlay continuity on remesh by reusing simulation metadata.
      const mesh = generateMesh(density, material, wetness, mossiness) as MeshData;

      const response = {
        key,
        meshPositions: mesh.positions,
        meshIndices: mesh.indices,
        meshMatWeightsA: mesh.matWeightsA,
        meshMatWeightsB: mesh.matWeightsB,
        meshMatWeightsC: mesh.matWeightsC,
        meshMatWeightsD: mesh.matWeightsD,
        meshNormals: mesh.normals,
        meshWetness: mesh.wetness,
        meshMossiness: mesh.mossiness,
        meshCavity: mesh.cavity,
        // Water is a distinct surface mesh (separate from terrain Surface-Nets geometry).
        meshWaterPositions: mesh.waterPositions,
        meshWaterIndices: mesh.waterIndices,
        meshWaterNormals: mesh.waterNormals,
        // Pre-computed shoreline SDF mask (avoids main-thread BFS).
        meshWaterShoreMask: mesh.waterShoreMask
      };

      ctx.postMessage({ type: 'MESH_DONE', payload: response }, [
        mesh.positions.buffer,
        mesh.indices.buffer,
        mesh.matWeightsA.buffer,
        mesh.matWeightsB.buffer,
        mesh.matWeightsC.buffer,
        mesh.matWeightsD.buffer,
        mesh.normals.buffer,
        mesh.wetness.buffer,
        mesh.mossiness.buffer,
        mesh.cavity.buffer,
        mesh.waterPositions.buffer,
        mesh.waterIndices.buffer,
        mesh.waterNormals.buffer,
        mesh.waterShoreMask.buffer
      ]);
    }
  } catch (error) {
    console.error('[mesher.worker] Error:', error);
  }
};
