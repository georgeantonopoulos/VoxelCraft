import { TerrainService } from '../services/terrainService';
import { generateMesh } from '../utils/mesher';
import { MATERIAL_PROPS, TOTAL_SIZE } from '../constants';
import { MaterialType } from '../types';

// Helper to get index
const getIdx = (x: number, y: number, z: number) => x + y * TOTAL_SIZE + z * TOTAL_SIZE * TOTAL_SIZE;

function simulate(density: Float32Array, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array) {
    const size = TOTAL_SIZE;
    // We iterate the whole buffer including padding to let wetness propagate to edges
    // In a real global sim, we'd sync edges.

    // We use a temporary buffer for wetness to avoid directional bias?
    // For performance in JS, in-place is often acceptable for "organic" look if we alternate sweep direction,
    // but for now standard loop.

    for (let z = 1; z < size - 1; z++) {
        for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
                const idx = getIdx(x, y, z);
                const mat = material[idx];

                // Skip air for performance?
                // Air can carry humidity (fog)? For now, only solids or water.
                // Actually, if air doesn't carry wetness, water won't spread across gaps.
                // Let's assume Wetness spreads through Air (humidity) but decays fast?
                // Or just contact spread.

                // Logic:
                // 1. Get Material Props
                const props = MATERIAL_PROPS[mat] || MATERIAL_PROPS[MaterialType.DIRT];

                let currentWet = wetness[idx];
                let currentMoss = mossiness[idx];

                // 2. Calculate Max Neighbor Wetness
                // 6-neighbors
                let maxWet = 0;
                if (wetness[getIdx(x+1,y,z)] > maxWet) maxWet = wetness[getIdx(x+1,y,z)];
                if (wetness[getIdx(x-1,y,z)] > maxWet) maxWet = wetness[getIdx(x-1,y,z)];
                if (wetness[getIdx(x,y+1,z)] > maxWet) maxWet = wetness[getIdx(x,y+1,z)];
                if (wetness[getIdx(x,y-1,z)] > maxWet) maxWet = wetness[getIdx(x,y-1,z)];
                if (wetness[getIdx(x,y,z+1)] > maxWet) maxWet = wetness[getIdx(x,y,z+1)];
                if (wetness[getIdx(x,y,z-1)] > maxWet) maxWet = wetness[getIdx(x,y,z-1)];

                // Source overrides
                if (mat === MaterialType.WATER_SOURCE || mat === MaterialType.WATER_FLOWING) {
                    currentWet = 255;
                } else {
                    // Diffusion / Drying
                    // Distance falloff: wetness drops by some amount as it spreads
                    // e.g. maxWet - 10.
                    const targetWet = Math.max(0, maxWet - 5);

                    if (targetWet > currentWet) {
                        currentWet += props.absorptionRate;
                    } else if (targetWet < currentWet) {
                        currentWet -= props.dryingRate;
                    }

                    // Clamp
                    if (currentWet > 255) currentWet = 255;
                    if (currentWet < 0) currentWet = 0;
                }

                // 3. Moss Growth
                // Only on Stone (or other moss-able materials)
                if (mat === MaterialType.STONE || mat === MaterialType.BEDROCK) { // Bedrock can get mossy too?
                    const mossThresh = 100;
                    if (currentWet > mossThresh) {
                        currentMoss += props.mossGrowthRate;
                    } else {
                        currentMoss -= props.mossDecayRate;
                    }

                    if (currentMoss > 255) currentMoss = 255;
                    if (currentMoss < 0) currentMoss = 0;
                } else {
                    // Moss dies on other materials (or maybe dirt supports it too?)
                    // User asked for Mossy Stone.
                    // Let's let moss die on others for now.
                    currentMoss -= 5;
                    if (currentMoss < 0) currentMoss = 0;
                }

                wetness[idx] = currentWet;
                mossiness[idx] = currentMoss;
            }
        }
    }
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

        // Run simulation step
        simulate(density, material, wetness, mossiness);

        // Remesh after simulation
        // Optimization: Only remesh if visual change?
        // For Phase 1, just remesh.
        const mesh = generateMesh(density, material, wetness, mossiness);

        const response = {
            key, cx, cz,
            density, material, wetness, mossiness, // Send back updated data
            version: version + 1, // Increment version
            meshPositions: mesh.positions,
            meshIndices: mesh.indices,
            meshMaterials: mesh.materials,
            meshNormals: mesh.normals,
            meshWetness: mesh.wetness,
            meshMossiness: mesh.mossiness
        };

        self.postMessage({ type: 'REMESHED', payload: response }, [
            // density/material/wetness/mossiness are transferred back (or copied if we want to keep them here?)
            // If we transfer, the worker loses them?
            // If the main thread sent them with transfer, the main thread lost them.
            // We need to send them back.
            // Note: Float32Array buffers if transferred are gone.
            // So we should transfer them back.
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
    }
  } catch (error) {
      console.error('Worker Error:', error);
  }
};
