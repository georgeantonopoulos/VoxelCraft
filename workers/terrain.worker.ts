import { TerrainService } from '../services/terrainService';
import { generateMesh } from '../utils/mesher';
import { MATERIAL_PROPS, TOTAL_SIZE } from '../constants';
import { MaterialType } from '../types';

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'GENERATE') {
        const { cx, cz } = payload;
        // Returns density, material, metadata (wetness, mossiness inside)
        const chunkData = TerrainService.generateChunk(cx, cz);

        // Mesher still expects flat arrays, so we extract them
        const wetness = chunkData.metadata.wetness;
        const mossiness = chunkData.metadata.mossiness;

        const mesh = generateMesh(chunkData.density, chunkData.material, wetness, mossiness);

        const response = {
            key: `${cx},${cz}`,
            cx, cz,
            density: chunkData.density,
            material: chunkData.material,
            metadata: chunkData.metadata, // Send back the new structure
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness
        };

        self.postMessage({ type: 'GENERATED', payload: response }, [
            chunkData.density.buffer,
            chunkData.material.buffer,
            wetness.buffer,
            mossiness.buffer,
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.normals.buffer,
            mesh.wetness.buffer,
            mesh.mossiness.buffer
        ]);
    }
    else if (type === 'REMESH') {
        const { density, material, wetness, mossiness, key, cx, cz, version } = payload;
        // We assume main thread passes the current state of wetness/mossiness

        const mesh = generateMesh(density, material, wetness, mossiness);

        const response = {
            key, cx, cz,
            density, material, wetness, mossiness,
            version,
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness
        };

        self.postMessage({ type: 'REMESHED', payload: response }, [
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.normals.buffer,
            mesh.wetness.buffer,
            mesh.mossiness.buffer
        ]);
    }
    // SIMULATE is now handled on main thread via SimulationManager, so we removed it here.
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
