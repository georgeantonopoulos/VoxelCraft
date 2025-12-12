import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';
import { getChunkModifications } from '@/state/WorldDB';
import { BiomeManager } from '../logic/BiomeManager';
import { getVegetationForBiome } from '../logic/VegetationConfig';
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
        if (type === 'CONFIGURE') {
            const { worldType } = payload;
            BiomeManager.setWorldType(worldType);
            console.log('[terrain.worker] Configured WorldType:', worldType);
        } else if (type === 'GENERATE') {

            const { cx, cz } = payload;
            const t0 = performance.now();
            // console.log('[terrain.worker] GENERATE start', cx, cz);

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
            const { density, material, metadata, floraPositions, treePositions, rootHollowPositions } = TerrainService.generateChunk(cx, cz, modifications);

            // 3. Compute Light Clusters (Async in Worker)
            // const lightPositions = TerrainService.computeLightClusters(floraPositions);

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
                    let biomeDensity = BiomeManager.getVegetationDensity(worldX, worldZ);
                    // Beaches should read as clean shoreline; reduce ambient ground clutter and avoid
                    // paying for unnecessary surface scans in the worker.
                    if (biome === 'BEACH') biomeDensity *= 0.1;

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
                        const sizeZ = TOTAL_SIZE_XZ;

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

                            // --- CALCULATE NORMAL ---
                            // Central differences on the density field
                            // We need to clamp indices to be safe
                            const cX = Math.floor(dx);
                            const cY = Math.floor(surfaceY);
                            const cZ = Math.floor(dz);

                            // Helper to safely get density
                            const getD = (ox: number, oy: number, oz: number) => {
                                const ix = Math.max(0, Math.min(sizeX - 1, cX + ox));
                                const iy = Math.max(0, Math.min(sizeY - 1, cY + oy));
                                const iz = Math.max(0, Math.min(sizeZ - 1, cZ + oz));
                                return density[ix + iy * sizeX + iz * sizeX * sizeY];
                            };

                            // Gradient vector pointing out of the wall (towards lower density)
                            // Normal = -Gradient
                            const nx = -(getD(1, 0, 0) - getD(-1, 0, 0));
                            const ny = -(getD(0, 1, 0) - getD(0, -1, 0));
                            const nz = -(getD(0, 0, 1) - getD(0, 0, -1));

                            // Normalize
                            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                            // Fallback to UP if degenerate
                            const invLen = len > 0.0001 ? 1.0 / len : 0;
                            const finalNx = len > 0.0001 ? nx * invLen : 0;
                            const finalNy = len > 0.0001 ? ny * invLen : 1;
                            const finalNz = len > 0.0001 ? nz * invLen : 0;

                            // Re-assign to simple vars for usage below
                            const nx_val = finalNx;
                            const ny_val = finalNy;
                            const nz_val = finalNz;

                            // 2. Clumping Logic
                            // If density is very high, place multiple plants
                            // ... inside the loop ...

                            // 2. Clumping Logic
                            // If density is very high, place multiple plants
                            let numPlants = 1;

                            // HIGH DENSITY BIOMES (The Ghibli Look)
                            if (biome === 'JUNGLE' || biome === 'THE_GROVE') {
                                // We push the count much higher. 
                                // Since we spherized the normals in the shader, 
                                // these extra instances won't look "noisy", they will look like soft volume.
                                if (finalDensity > threshold + 0.30) numPlants = 7; // Extremely dense core
                                else if (finalDensity > threshold + 0.15) numPlants = 5;
                                else if (finalDensity > threshold + 0.05) numPlants = 3;
                            } else {
                                // Standard Biomes (Plains, etc) - Keep optimized
                                if (finalDensity > threshold + 0.4) numPlants = 3;
                                else if (finalDensity > threshold + 0.2) numPlants = 2;
                            }

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

                                    // Spread Logic Update:
                                    // Increased multiplier from 1.2 to 1.4
                                    // This allows grass to step further off the grid center, 
                                    // blending chunks together so you don't see "rows" of grass.
                                    const offX = (r1 - Math.floor(r1) - 0.5) * 1.4;
                                    const offZ = (r2 - Math.floor(r2) - 0.5) * 1.4;

                                    // Tiny Y Jitter
                                    // Randomly sink the grass slightly (-0.15 to 0.0) 
                                    // This prevents the "flat bottom" look on hills.
                                    const offY = ((r1 + r2) % 1) * -0.15;

                                    // --- SLOPE CORRECTION ---
                                    // Since we moved X/Z, we must adjust Y based on the slope (normal).
                                    // Plane eq: nx*x + ny*y + nz*z = 0
                                    // dy = -(nx*dx + nz*dz) / ny
                                    // We clamp ny to avoid division by zero (though ny should be > 0 for ground)
                                    let slopeY = 0;
                                    if (ny_val > 0.1) {
                                        slopeY = -(nx_val * offX + nz_val * offZ) / ny_val;
                                    }
                                    // Clamp slope correction to avoid wild spikes on steep terrain
                                    slopeY = Math.max(-1.0, Math.min(1.0, slopeY));

                                    vegetationBuckets[vegType].push(
                                        x + offX,
                                        worldY - 0.1 + offY + slopeY, // Apply sink + slope correction
                                        z + offZ,
                                        // Normal (nx, ny, nz)
                                        nx_val, ny_val, nz_val
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

            // console.log('[terrain.worker] GENERATE done', cx, cz, {
            //     positions: mesh.positions.length,
            //     ms: Math.round(performance.now() - t0),
            //     mods: modifications.length
            // });

            const response = {
                key: `${cx},${cz}`,
                cx, cz,
                density,
                material,
                metadata,
                vegetationData,
                floraPositions,
                treePositions,
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
                // Water is a distinct surface mesh (separate from terrain Surface-Nets geometry).
                // Chunk state expects `meshWater*` keys so ChunkMesh can render it.
                meshWaterPositions: mesh.waterPositions,
                meshWaterIndices: mesh.waterIndices,
                meshWaterNormals: mesh.waterNormals
            };

            ctx.postMessage({ type: 'GENERATED', payload: response }, [
                ...vegetationBuffers,
                density.buffer,
                material.buffer,
                metadata.wetness.buffer,
                metadata.mossiness.buffer,
                floraPositions.buffer,
                treePositions.buffer,
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
            const { density, material, wetness, mossiness, key, cx, cz, version } = payload;

            // console.log('[terrain.worker] REMESH start', key, 'v', version);
            // Keep overlay continuity on remesh by reusing simulation metadata.
            // Without this, wet/moss weights silently reset and look like texture blending glitches.
            const mesh = generateMesh(density, material, wetness, mossiness) as MeshData;
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
                // Keep `meshWater*` naming consistent with ChunkState.
                meshWaterPositions: mesh.waterPositions,
                meshWaterIndices: mesh.waterIndices,
                meshWaterNormals: mesh.waterNormals
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
