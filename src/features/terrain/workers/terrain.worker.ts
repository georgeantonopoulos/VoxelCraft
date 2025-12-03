import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';
import { getChunkModifications } from '@/state/WorldDB';
import { BiomeManager } from '../logic/BiomeManager';
import { getVegetationForBiome, getBiomeVegetationDensity } from '../logic/VegetationConfig';
import { noise } from '@core/math/noise';
import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, ISO_LEVEL } from '@/constants';

const ctx: Worker = self as any;

ctx.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        if (type === 'GENERATE') {
            const { cx, cz } = payload;
            const t0 = performance.now();
            console.log('[terrain.worker] GENERATE start', cx, cz);

            // 1. Fetch persistent modifications (Async)
            let modifications: any[] = [];
            try {
                modifications = await getChunkModifications(cx, cz);
            } catch (err) {
                console.error('[terrain.worker] DB Read Error:', err);
            }

            // 2. Generate with mods
            const { density, material, metadata, floraPositions, treePositions, rootHollowPositions } = TerrainService.generateChunk(cx, cz, modifications);

            // --- AMBIENT VEGETATION GENERATION ---
            const vegetationBuckets: Record<number, number[]> = {};

            for (let z = 0; z < CHUNK_SIZE_XZ; z++) {
                for (let x = 0; x < CHUNK_SIZE_XZ; x++) {
                    const worldX = cx * CHUNK_SIZE_XZ + x;
                    const worldZ = cz * CHUNK_SIZE_XZ + z;

                    const biome = BiomeManager.getBiomeAt(worldX, worldZ);
                    const biomeDensity = getBiomeVegetationDensity(biome);

                    const densityNoise = noise(worldX * 0.15, 0, worldZ * 0.15);
                    const normalizedDensity = (densityNoise + 1) * 0.5;
                    const jitter = noise(worldX * 0.8, 0, worldZ * 0.8) * 0.3;

                    const finalDensity = normalizedDensity + jitter;
                    const threshold = 1.0 - biomeDensity;

                    if (finalDensity > threshold) {
                        let surfaceY = -1;
                        const pad = 2;
                        const dx = x + pad;
                        const dz = z + pad;
                        const sizeX = TOTAL_SIZE_XZ;
                        const sizeY = TOTAL_SIZE_Y;

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

                        if (surfaceY > 0 && worldY > 11) {
                            let numPlants = 1;
                            if (finalDensity > threshold + 0.4) numPlants = 3;
                            else if (finalDensity > threshold + 0.2) numPlants = 2;

                            const typeNoise = noise(worldX * 0.1 + 100, 0, worldZ * 0.1 + 100);
                            const normalizedType = (typeNoise + 1) * 0.5;
                            const vegType = getVegetationForBiome(biome, normalizedType);

                            if (vegType !== null) {
                                if (!vegetationBuckets[vegType]) vegetationBuckets[vegType] = [];

                                for (let i = 0; i < numPlants; i++) {
                                    const seed = (worldX * 31 + worldZ * 17 + i * 13);
                                    const r1 = Math.sin(seed) * 43758.5453;
                                    const r2 = Math.cos(seed) * 43758.5453;
                                    const offX = (r1 - Math.floor(r1) - 0.5) * 0.8;
                                    const offZ = (r2 - Math.floor(r2) - 0.5) * 0.8;

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
                treePositions,
                rootHollowPositions,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMatIndices: mesh.matIndices, // Optimized attributes
                meshMatWeights: mesh.matWeights, // Optimized attributes
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
                treePositions.buffer,
                rootHollowPositions.buffer,
                mesh.positions.buffer,
                mesh.indices.buffer,
                mesh.matIndices.buffer, // Optimized attributes
                mesh.matWeights.buffer, // Optimized attributes
                mesh.normals.buffer,
                mesh.wetness.buffer,
                mesh.mossiness.buffer,
                mesh.waterPositions.buffer,
                mesh.waterIndices.buffer,
                mesh.waterNormals.buffer
            ]);
        } else if (type === 'REMESH') {
            const { density, material, key, cx, cz, version } = payload;

            const mesh = generateMesh(density, material) as MeshData;

            const response = {
                key, cx, cz,
                density,
                version,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMatIndices: mesh.matIndices, // Optimized attributes
                meshMatWeights: mesh.matWeights, // Optimized attributes
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
                mesh.matIndices.buffer, // Optimized attributes
                mesh.matWeights.buffer, // Optimized attributes
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
