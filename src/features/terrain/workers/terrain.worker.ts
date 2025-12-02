import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';
import { getChunkModifications } from '@/state/WorldDB';
import { BiomeManager } from '../logic/BiomeManager';
import { getVegetationForBiome, getBiomeVegetationDensity } from '../logic/VegetationConfig';
import { noise } from '@core/math/noise';
import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, ISO_LEVEL } from '@/constants';

const ctx: Worker = self as any;

// Instantiate DB connection implicitly by importing it (Singleton in WorldDB.ts)
// The user requested: "Ensure you instantiate WorldDB outside the onmessage handler."
// Since `worldDB` is exported as a const instance in `WorldDB.ts`, it is instantiated on module load.
// We don't need to do anything extra here, just usage is fine.

ctx.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        if (type === 'GENERATE') {
            const { cx, cz } = payload;
            const t0 = performance.now();
            console.log('[terrain.worker] GENERATE start', cx, cz);

            // 1. Fetch persistent modifications (Async)
            // This happens BEFORE generation so we can pass them in
            let modifications: any[] = [];
            try {
                modifications = await getChunkModifications(cx, cz);
            } catch (err) {
                console.error('[terrain.worker] DB Read Error:', err);
                // Continue generation even if DB fails, to avoid game crash
            }

            // 2. Generate with mods
            const { density, material, metadata, floraPositions, rootHollowPositions } = TerrainService.generateChunk(cx, cz, modifications);

            // --- AMBIENT VEGETATION GENERATION ---
            const vegetationBuckets: Record<number, number[]> = {};

            // We iterate strictly within the CHUNK bounds (excluding padding)
            // But we access the padded density array.
            // Padded size is TOTAL_SIZE_XZ (XZ + 2*PAD).
            // TerrainService generates [TOTAL_SIZE_XZ, TOTAL_SIZE_Y, TOTAL_SIZE_XZ].
            // We want world coordinates to map biomes.

            for (let z = 0; z < CHUNK_SIZE_XZ; z++) {
                for (let x = 0; x < CHUNK_SIZE_XZ; x++) {
                    const worldX = cx * CHUNK_SIZE_XZ + x;
                    const worldZ = cz * CHUNK_SIZE_XZ + z;

                    const biome = BiomeManager.getBiomeAt(worldX, worldZ);
                    const biomeDensity = getBiomeVegetationDensity(biome);

                    // 1. Density Noise (Smaller, more frequent patches)
                    // Scale 0.15 = ~6-7 blocks per cycle (much smaller patches)
                    const densityNoise = noise(worldX * 0.15, 0, worldZ * 0.15);
                    const normalizedDensity = (densityNoise + 1) * 0.5;

                    // Jitter to break edges
                    const jitter = noise(worldX * 0.8, 0, worldZ * 0.8) * 0.3;

                    const finalDensity = normalizedDensity + jitter;
                    const threshold = 1.0 - biomeDensity;

                    if (finalDensity > threshold) {

                        // Simple Raycast from top down to find surface
                        let surfaceY = -1;
                        const pad = 2;
                        const dx = x + pad;
                        const dz = z + pad;
                        const sizeX = TOTAL_SIZE_XZ;
                        const sizeY = TOTAL_SIZE_Y;

                        // Scan down
                        for (let y = sizeY - 2; y >= 0; y--) {
                            const idx = dx + y * sizeX + dz * sizeX * sizeY;
                            const d = density[idx];

                            if (d > ISO_LEVEL) {
                                surfaceY = y;
                                const idxAbove = idx + sizeX;
                                const dAbove = density[idxAbove];
                                const t = (ISO_LEVEL - d) / (dAbove - d);
                                surfaceY += t;
                                break;
                            }
                        }

                        const meshYOffset = -35;
                        const worldY = (surfaceY - pad) + meshYOffset;

                        // Skip if underwater or too low
                        if (surfaceY > 0 && worldY > 11) {

                            // 2. Clumping Logic
                            // If density is very high, place multiple plants
                            let numPlants = 1;
                            if (finalDensity > threshold + 0.4) numPlants = 3; // Dense clump
                            else if (finalDensity > threshold + 0.2) numPlants = 2; // Moderate clump

                            // 3. Type Noise
                            const typeNoise = noise(worldX * 0.1 + 100, 0, worldZ * 0.1 + 100);
                            const normalizedType = (typeNoise + 1) * 0.5;
                            const vegType = getVegetationForBiome(biome, normalizedType);

                            if (vegType !== null) {
                                if (!vegetationBuckets[vegType]) vegetationBuckets[vegType] = [];

                                for (let i = 0; i < numPlants; i++) {
                                    // Unique hash for each sub-plant
                                    const seed = (worldX * 31 + worldZ * 17 + i * 13);
                                    const r1 = Math.sin(seed) * 43758.5453;
                                    const r2 = Math.cos(seed) * 43758.5453;

                                    // Random offset -0.4 to 0.4 (stay roughly within block but spread out)
                                    const offX = (r1 - Math.floor(r1) - 0.5) * 0.8;
                                    const offZ = (r2 - Math.floor(r2) - 0.5) * 0.8;

                                    // Scale variation
                                    // We don't store scale here, but we could jitter position slightly more to avoid Z-fighting

                                    vegetationBuckets[vegType].push(
                                        x + offX,
                                        worldY - 0.1,
                                        z + offZ
                                    );
                                }
                            }
                        }
                    }
                }
            }

            // Flatten to Float32Arrays and prepare transfer list
            const vegetationData: Record<number, Float32Array> = {};
            const vegetationBuffers: ArrayBuffer[] = [];

            for (const [key, positions] of Object.entries(vegetationBuckets)) {
                const f32 = new Float32Array(positions);
                vegetationData[parseInt(key)] = f32;
                vegetationBuffers.push(f32.buffer);
            }

            const mesh = generateMesh(density, material, metadata.wetness, metadata.mossiness) as MeshData;

            console.log('[terrain.worker] GENERATE done', cx, cz, {
                positions: mesh.positions.length,
                ms: Math.round(performance.now() - t0),
                mods: modifications.length
            });

            const response = {
                key: `${cx},${cz}`,
                cx, cz,
                density,
                material,
                metadata,
                vegetationData,
                floraPositions,
                rootHollowPositions,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMatWeightsA: mesh.matWeightsA,
                meshMatWeightsB: mesh.matWeightsB,
                meshMatWeightsC: mesh.matWeightsC,
                meshMatWeightsD: mesh.matWeightsD,
                meshNormals: mesh.normals,
                meshWetness: mesh.wetness,
                meshMossiness: mesh.mossiness,
                waterPositions: mesh.waterPositions,
                waterIndices: mesh.waterIndices,
                waterNormals: mesh.waterNormals
            };

            ctx.postMessage({ type: 'GENERATED', payload: response }, [
                ...vegetationBuffers,
                density.buffer,
                material.buffer,
                metadata.wetness.buffer,
                metadata.mossiness.buffer,
                floraPositions.buffer,
                rootHollowPositions.buffer,
                mesh.positions.buffer,
                mesh.indices.buffer,
                mesh.matWeightsA.buffer,
                mesh.matWeightsB.buffer,
                mesh.matWeightsC.buffer,
                mesh.matWeightsD.buffer,
                mesh.normals.buffer,
                mesh.wetness.buffer,
                mesh.mossiness.buffer,
                mesh.waterPositions.buffer,
                mesh.waterIndices.buffer,
                mesh.waterNormals.buffer
            ]);
        } else if (type === 'REMESH') {
            const { density, material, key, cx, cz, version } = payload;

            // console.log('[terrain.worker] REMESH start', key, 'v', version);
            const mesh = generateMesh(density, material) as MeshData;
            // console.log('[terrain.worker] REMESH done', key);

            const response = {
                key, cx, cz,
                density,
                version,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMatWeightsA: mesh.matWeightsA,
                meshMatWeightsB: mesh.matWeightsB,
                meshMatWeightsC: mesh.matWeightsC,
                meshMatWeightsD: mesh.matWeightsD,
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
                mesh.matWeightsA.buffer,
                mesh.matWeightsB.buffer,
                mesh.matWeightsC.buffer,
                mesh.matWeightsD.buffer,
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
