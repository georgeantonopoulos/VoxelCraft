import { TerrainService } from '../services/terrainService';
import { generateMesh } from '../utils/mesher';
import { MeshData } from '../types';

// Type alias to ensure TypeScript recognizes all MeshData properties
type CompleteMeshData = MeshData & {
  materials2: Float32Array;
  materials3: Float32Array;
  meshWeights: Float32Array;
};

const ctx: Worker = self as any;

ctx.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'GENERATE') {
        const { cx, cz } = payload;
        const t0 = performance.now();
        console.log('[terrain.worker] GENERATE start', cx, cz);
        const { density, material, metadata, floraPositions, rootHollowPositions } = TerrainService.generateChunk(cx, cz);
        const mesh = generateMesh(density, material, metadata.wetness, metadata.mossiness) as CompleteMeshData;
        console.log('[terrain.worker] GENERATE done', cx, cz, {
            positions: mesh.positions.length,
            indices: mesh.indices.length,
            waterPositions: mesh.waterPositions.length,
            waterIndices: mesh.waterIndices.length,
            floraCount: floraPositions.length / 3,
            hollowCount: rootHollowPositions.length / 6, // 6 values per root: position (3) + normal (3)
            ms: Math.round(performance.now() - t0)
        });
        
        // Log flora positions if any exist
        if (floraPositions.length > 0) {
            console.log('[terrain.worker] Flora spawned in chunk', cx, cz, ':', floraPositions.length / 3, 'positions');
        }

        const response = {
            key: `${cx},${cz}`,
            cx, cz,
            density,
            material,
            metadata, // CRITICAL: Pass metadata back to main thread so VoxelTerrain can init DB
            floraPositions, // Flora spawn positions for caves
            rootHollowPositions, // Root Hollow positions
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshMaterials2: mesh.materials2,
            meshMaterials3: mesh.materials3,
            meshWeights: mesh.meshWeights,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness,
            // Water Mesh
            waterPositions: mesh.waterPositions,
            waterIndices: mesh.waterIndices,
            waterNormals: mesh.waterNormals
        };

        // Transfer buffers to avoid copying
        ctx.postMessage({ type: 'GENERATED', payload: response }, [
            density.buffer,
            material.buffer,
            metadata.wetness.buffer, // Transfer metadata buffers too
            metadata.mossiness.buffer,
            floraPositions.buffer,
            rootHollowPositions.buffer,
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.materials2.buffer,
            mesh.materials3.buffer,
            mesh.meshWeights.buffer,
            mesh.normals.buffer,
            mesh.wetness.buffer,
            mesh.mossiness.buffer,
            mesh.waterPositions.buffer,
            mesh.waterIndices.buffer,
            mesh.waterNormals.buffer
        ]);
    } else if (type === 'REMESH') {
        const { density, material, key, cx, cz, version } = payload;
        
        const t0 = performance.now();
        console.log('[terrain.worker] REMESH start', key, 'v', version);
        const mesh = generateMesh(density, material) as CompleteMeshData;
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
            meshMaterials2: mesh.materials2,
            meshMaterials3: mesh.materials3,
            meshWeights: mesh.meshWeights,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness,
            waterPositions: mesh.waterPositions,
            waterIndices: mesh.waterIndices,
            waterNormals: mesh.waterNormals
        };

        ctx.postMessage({ type: 'REMESHED', payload: response }, [
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.materials2.buffer,
            mesh.materials3.buffer,
            mesh.meshWeights.buffer,
            mesh.normals.buffer,
            mesh.wetness.buffer,
            mesh.mossiness.buffer,
            mesh.waterPositions.buffer,
            mesh.waterIndices.buffer,
            mesh.waterNormals.buffer
        ]);
    }
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
