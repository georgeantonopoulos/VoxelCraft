/// <reference lib="webworker" />

import { TerrainService } from '../services/terrainService';
import { meshChunk } from '../utils/GreedyMesher';

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'GENERATE') {
        const { cx, cz } = payload;
        const chunkData = TerrainService.generateChunk(cx, cz);

        const mesh = meshChunk(chunkData.material);

        const response = {
            key: `${cx},${cz}`,
            cx, cz,
            material: chunkData.material,

            positions: mesh.positions,
            indices: mesh.indices,
            normals: mesh.normals,
            uvs: mesh.uvs,
            textureIndices: mesh.textureIndices,
            ao: mesh.ao,

            tPositions: mesh.transparentPositions,
            tIndices: mesh.transparentIndices,
            tNormals: mesh.transparentNormals,
            tUvs: mesh.transparentUvs,
            tTextureIndices: mesh.transparentTextureIndices,
            tAo: mesh.transparentAo
        };

        const buffers = [
            chunkData.material.buffer,
            mesh.positions.buffer, mesh.indices.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.textureIndices.buffer, mesh.ao.buffer,
            mesh.transparentPositions.buffer, mesh.transparentIndices.buffer, mesh.transparentNormals.buffer, mesh.transparentUvs.buffer, mesh.transparentTextureIndices.buffer, mesh.transparentAo.buffer
        ].filter(b => b.byteLength > 0);

        self.postMessage({ type: 'GENERATED', payload: response }, buffers);
    }
    else if (type === 'REMESH') {
        const { material, key, cx, cz, version } = payload;

        const mesh = meshChunk(material);

        const response = {
            key, cx, cz, version,
            material,

            positions: mesh.positions,
            indices: mesh.indices,
            normals: mesh.normals,
            uvs: mesh.uvs,
            textureIndices: mesh.textureIndices,
            ao: mesh.ao,

            tPositions: mesh.transparentPositions,
            tIndices: mesh.transparentIndices,
            tNormals: mesh.transparentNormals,
            tUvs: mesh.transparentUvs,
            tTextureIndices: mesh.transparentTextureIndices,
            tAo: mesh.transparentAo
        };

        const buffers = [
            material.buffer,
            mesh.positions.buffer, mesh.indices.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.textureIndices.buffer, mesh.ao.buffer,
            mesh.transparentPositions.buffer, mesh.transparentIndices.buffer, mesh.transparentNormals.buffer, mesh.transparentUvs.buffer, mesh.transparentTextureIndices.buffer, mesh.transparentAo.buffer
        ].filter(b => b.byteLength > 0);

        self.postMessage({ type: 'REMESHED', payload: response }, buffers);
    }
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
