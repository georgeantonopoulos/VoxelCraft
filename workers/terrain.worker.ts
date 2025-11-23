import { TerrainService } from '../services/terrainService';
import { generateMesh } from '../utils/mesher';

const ctx: Worker = self as any;

ctx.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'GENERATE') {
        const { cx, cz } = payload;
        const t0 = performance.now();
        console.log('[terrain.worker] GENERATE start', cx, cz);
        const { density, material } = TerrainService.generateChunk(cx, cz);
        const mesh = generateMesh(density, material);
        console.log('[terrain.worker] GENERATE done', cx, cz, {
            positions: mesh.positions.length,
            indices: mesh.indices.length,
            ms: Math.round(performance.now() - t0)
        });

        const response = {
            key: `${cx},${cz}`,
            cx, cz,
            density,
            material,
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness
        };

        // Transfer buffers to avoid copying
        ctx.postMessage({ type: 'GENERATED', payload: response }, [
            density.buffer,
            material.buffer,
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.normals.buffer,
            mesh.wetness.buffer,
            mesh.mossiness.buffer
        ]);
    } else if (type === 'REMESH') {
        const { density, material, key, cx, cz, version } = payload;
        const t0 = performance.now();
        console.log('[terrain.worker] REMESH start', key, 'v', version);
        const mesh = generateMesh(density, material);
        console.log('[terrain.worker] REMESH done', key, {
            positions: mesh.positions.length,
            indices: mesh.indices.length,
            ms: Math.round(performance.now() - t0)
        });

        const response = {
            key, cx, cz,
            density, // Echo back if needed, but usually we just update the mesh parts
            version, // Echo back version
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness
        };

        ctx.postMessage({ type: 'REMESHED', payload: response }, [
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.normals.buffer,
            mesh.wetness.buffer,
            mesh.mossiness.buffer
        ]);
    }
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
