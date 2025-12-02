import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';
import { getChunkModifications } from '@/state/WorldDB';
import { BiomeManager } from '../logic/BiomeManager';
import { getVegetationForBiome } from '../logic/VegetationConfig';
import { CHUNK_SIZE_XZ, CHUNK_SIZE_Y, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, ISO_LEVEL } from '@/constants';

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

                    // Simple Raycast from top down to find surface
                    let surfaceY = -1;

                    // Note: density array is [x + y*sizeX + z*sizeX*sizeY]
                    // We need to map local x/z (0..31) to density indices which include PAD
                    // Assuming TerrainService uses PAD = 2
                    // We need to match the PAD used in TerrainService.
                    // Let's assume PAD is consistent.

                    const pad = 2; // Hardcoded PAD matching TerrainService/constants
                    const dx = x + pad;
                    const dz = z + pad;
                    const sizeX = TOTAL_SIZE_XZ;
                    const sizeY = TOTAL_SIZE_Y;
                    const sizeZ = TOTAL_SIZE_XZ; // Symmetrical

                    // Scan down
                    for (let y = sizeY - 2; y >= 0; y--) { // Skip top boundary
                         const idx = dx + y * sizeX + dz * sizeX * sizeY;
                         if (density[idx] > ISO_LEVEL) {
                             surfaceY = y;
                             break;
                         }
                    }

                    // Check if surface is valid and not underwater
                    // Assuming MESH_Y_OFFSET handled by renderer world position,
                    // but we need relative Y to the chunk bottom (which is 0 in local coords?)
                    // Wait, TerrainService outputs density in a padded grid.
                    // The mesh output positions are relative to (cx*CHUNK, 0, cz*CHUNK).
                    // The density y index maps to world Y via MESH_Y_OFFSET (-35).

                    // Water Check:
                    // If surfaceY corresponds to a world Y below WATER_LEVEL (11), skip.
                    // surfaceWorldY = surfaceY - PAD + MESH_Y_OFFSET?
                    // No, TerrainService loop uses `wy = (y - PAD) + MESH_Y_OFFSET`.
                    const meshYOffset = -35;
                    const worldY = (surfaceY - pad) + meshYOffset;

                    // Skip if underwater or too low
                    if (surfaceY > 0 && worldY > 11) { // 11 is WATER_LEVEL

                        // Deterministic Placement
                        const seed = Math.sin(worldX * 12.9898 + worldZ * 78.233) * 43758.5453;
                        const noiseVal = seed - Math.floor(seed);

                        const vegType = getVegetationForBiome(biome, noiseVal);

                        if (vegType !== null) {
                            if (!vegetationBuckets[vegType]) vegetationBuckets[vegType] = [];

                            // Position relative to Chunk Origin (0,0,0)
                            // The mesh generation produces vertices relative to (0,0,0) of the chunk.
                            // x and z loop are 0..31.
                            // We need to add random offset.

                            vegetationBuckets[vegType].push(
                                x + (noiseVal - 0.5) * 0.6,
                                worldY - 0.2, // Use world Y because rendering assumes 0 is bedrock?
                                              // Wait, ChunkMesh positions the group at [cx*CHUNK, 0, cz*CHUNK].
                                              // The vertices in mesh are local.
                                              // Mesh generator uses `wy` for Y values? No.
                                              // Mesher uses `y - PAD + MESH_Y_OFFSET` to calculate vertex positions?
                                              // Actually `mesher.ts` usually outputs coordinates relative to the grid origin?
                                              // Let's look at `mesher.ts` output.
                                              // Standard Dual Contouring usually outputs world space or local space.
                                              // If ChunkMesh groups are positioned at (cx, 0, cz), then local Y must be World Y.
                                              // Yes, standard Minecraft engines use Y=WorldY.

                                z + (Math.cos(noiseVal * 100) - 0.5) * 0.6
                            );
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

            const t0 = performance.now();
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
