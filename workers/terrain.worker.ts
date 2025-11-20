import { TerrainService } from '../services/terrainService';
import { generateMesh } from '../utils/mesher';

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'GENERATE') {
        const { cx, cz } = payload;
        const { density, material } = TerrainService.generateChunk(cx, cz);
        const mesh = generateMesh(density, material);

        const response = {
            key: `${cx},${cz}`,
            cx, cz,
            density,
            material,
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals
        };

        // Transfer buffers to avoid copying
        self.postMessage({ type: 'GENERATED', payload: response }, [
            density.buffer,
            material.buffer,
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.normals.buffer
        ]);
    } else if (type === 'REMESH') {
        const { density, material, key, cx, cz, version } = payload;
        const mesh = generateMesh(density, material);

        const response = {
            key, cx, cz,
            density, // Echo back if needed, but usually we just update the mesh parts
            version, // Echo back version
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals
        };

        self.postMessage({ type: 'REMESHED', payload: response }, [
            mesh.positions.buffer,
            mesh.indices.buffer,
            mesh.materials.buffer,
            mesh.normals.buffer
        ]);
    }
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
