import { TerrainService } from '../services/terrainService';
import { generateMesh } from '../utils/mesher';
import { MATERIAL_PROPS, TOTAL_SIZE } from '../constants';
import { MaterialType } from '../types';

// Helper to get index
const getIdx = (x: number, y: number, z: number) => x + y * TOTAL_SIZE + z * TOTAL_SIZE * TOTAL_SIZE;

function simulate(density: Float32Array, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array): boolean {
    const size = TOTAL_SIZE;
    let anyChanged = false;

    for (let z = 1; z < size - 1; z++) {
        for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
                const idx = getIdx(x, y, z);
                const mat = material[idx];

                const props = MATERIAL_PROPS[mat] || MATERIAL_PROPS[MaterialType.DIRT];

                const oldWet = wetness[idx];
                const oldMoss = mossiness[idx];
                let currentWet = oldWet;
                let currentMoss = oldMoss;

                // 2. Calculate Max Neighbor Wetness
                let maxWet = 0;
                if (wetness[getIdx(x+1,y,z)] > maxWet) maxWet = wetness[getIdx(x+1,y,z)];
                if (wetness[getIdx(x-1,y,z)] > maxWet) maxWet = wetness[getIdx(x-1,y,z)];
                if (wetness[getIdx(x,y+1,z)] > maxWet) maxWet = wetness[getIdx(x,y+1,z)];
                if (wetness[getIdx(x,y-1,z)] > maxWet) maxWet = wetness[getIdx(x,y-1,z)];
                if (wetness[getIdx(x,y,z+1)] > maxWet) maxWet = wetness[getIdx(x,y,z+1)];
                if (wetness[getIdx(x,y,z-1)] > maxWet) maxWet = wetness[getIdx(x,y,z-1)];

                if (mat === MaterialType.WATER_SOURCE || mat === MaterialType.WATER_FLOWING) {
                    currentWet = 255;
                } else {
                    const targetWet = Math.max(0, maxWet - 5);
                    if (targetWet > currentWet) {
                        currentWet += props.absorptionRate;
                    } else if (targetWet < currentWet) {
                        currentWet -= props.dryingRate;
                    }
                    if (currentWet > 255) currentWet = 255;
                    if (currentWet < 0) currentWet = 0;
                }

                if (mat === MaterialType.STONE || mat === MaterialType.BEDROCK) {
                    const mossThresh = 100;
                    if (currentWet > mossThresh) {
                        currentMoss += props.mossGrowthRate;
                    } else {
                        currentMoss -= props.mossDecayRate;
                    }
                    if (currentMoss > 255) currentMoss = 255;
                    if (currentMoss < 0) currentMoss = 0;
                } else {
                    currentMoss -= 5;
                    if (currentMoss < 0) currentMoss = 0;
                }

                if (currentWet !== oldWet) {
                    wetness[idx] = currentWet;
                    anyChanged = true;
                }
                if (currentMoss !== oldMoss) {
                    mossiness[idx] = currentMoss;
                    anyChanged = true;
                }
            }
        }
    }
    return anyChanged;
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'GENERATE') {
        const { cx, cz } = payload;
        // Returns density, material, wetness, mossiness
        const chunkData = TerrainService.generateChunk(cx, cz);

        const mesh = generateMesh(chunkData.density, chunkData.material, chunkData.wetness, chunkData.mossiness);

        const response = {
            key: `${cx},${cz}`,
            cx, cz,
            density: chunkData.density,
            material: chunkData.material,
            wetness: chunkData.wetness,
            mossiness: chunkData.mossiness,
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
            chunkData.wetness.buffer,
            chunkData.mossiness.buffer,
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
        // Assuming wetness/mossiness passed in
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
    else if (type === 'SIMULATE') {
        const { density, material, wetness, mossiness, key, cx, cz, version } = payload;

        // 1. Run Physics Simulation (Gravity, Collapse)
        const physResult = TerrainService.simulatePhysics(density, material, wetness, mossiness);

        // 2. Run Environmental Simulation (Wetness, Moss)
        const envChanged = simulate(density, material, wetness, mossiness);

        const changed = physResult.modified || envChanged;

        if (changed) {
            const mesh = generateMesh(density, material, wetness, mossiness);

            const response = {
                key, cx, cz,
                density, material, wetness, mossiness,
                transfers: physResult.transfers,
                version: version + 1,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMaterials: mesh.materials,
                meshNormals: mesh.normals,
                meshWetness: mesh.wetness,
                meshMossiness: mesh.mossiness
            };

            self.postMessage({ type: 'REMESHED', payload: response }, [
                density.buffer,
                material.buffer,
                wetness.buffer,
                mossiness.buffer,
                mesh.positions.buffer,
                mesh.indices.buffer,
                mesh.materials.buffer,
                mesh.normals.buffer,
                mesh.wetness.buffer,
                mesh.mossiness.buffer
            ]);
        } else {
             self.postMessage({
                 type: 'SIMULATE_SKIPPED',
                 payload: { key, cx, cz }
             });
        }
    }
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
