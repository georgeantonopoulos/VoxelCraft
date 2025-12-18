import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh, generateWaterSurfaceMesh } from '@features/terrain/logic/mesher';
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

// Packed hotspot storage: [x0, z0, x1, z1, ...] in world space.
const buildFloraHotspotsPacked = (floraPositions: Float32Array): Float32Array => {
    const packed: number[] = [];
    for (let i = 0; i < floraPositions.length; i += 4) {
        if (floraPositions[i + 1] < -9999) continue;
        packed.push(floraPositions[i], floraPositions[i + 2]);
    }
    return new Float32Array(packed);
};

const buildStickData = (stickPositions: Float32Array, cx: number, cz: number) => {
    const packedHotspots: number[] = [];
    const drySticks: number[] = [];
    const jungleSticks: number[] = [];

    for (let i = 0; i < stickPositions.length; i += 8) {
        if (stickPositions[i + 1] < -9999) continue;
        const wx = stickPositions[i] + cx * CHUNK_SIZE_XZ;
        const wz = stickPositions[i + 2] + cz * CHUNK_SIZE_XZ;
        packedHotspots.push(wx, wz);

        const variant = stickPositions[i + 6];
        const target = variant === 0 ? drySticks : jungleSticks;
        target.push(
            stickPositions[i + 0], stickPositions[i + 1], stickPositions[i + 2],
            stickPositions[i + 3], stickPositions[i + 4], stickPositions[i + 5],
            stickPositions[i + 7] // seed
        );
    }

    return {
        stickHotspots: new Float32Array(packedHotspots),
        drySticks: new Float32Array(drySticks),
        jungleSticks: new Float32Array(jungleSticks)
    };
};

const buildRockData = (rockPositions: Float32Array, cx: number, cz: number) => {
    const packedHotspots: number[] = [];
    const rockBuckets: Record<number, number[]> = {};

    for (let i = 0; i < rockPositions.length; i += 8) {
        if (rockPositions[i + 1] < -9999) continue;
        const wx = rockPositions[i] + cx * CHUNK_SIZE_XZ;
        const wz = rockPositions[i + 2] + cz * CHUNK_SIZE_XZ;
        packedHotspots.push(wx, wz);

        const variant = rockPositions[i + 6];
        if (!rockBuckets[variant]) rockBuckets[variant] = [];
        rockBuckets[variant].push(
            rockPositions[i + 0], rockPositions[i + 1], rockPositions[i + 2],
            rockPositions[i + 3], rockPositions[i + 4], rockPositions[i + 5],
            rockPositions[i + 7] // seed
        );
    }

    const rockDataBuckets: Record<number, Float32Array> = {};
    const rockBuffers: ArrayBuffer[] = [];
    for (const [rKey, points] of Object.entries(rockBuckets)) {
        const f32 = new Float32Array(points);
        rockDataBuckets[parseInt(rKey)] = f32;
        rockBuffers.push(f32.buffer);
    }

    return {
        rockHotspots: new Float32Array(packedHotspots),
        rockDataBuckets,
        rockBuffers
    };
};

/**
 * Pre-compute tree instance matrices in the worker to avoid main-thread matrix calculation loops.
 * Returns batched data grouped by tree type and variant, with pre-computed Float32Array matrices.
 */
const JUNGLE_VARIANTS = 4;

const buildTreeInstanceData = (treePositions: Float32Array) => {
    // Group trees by type:variant
    const batches = new Map<string, { type: number; variant: number; positions: number[] }>();

    for (let i = 0; i < treePositions.length; i += 4) {
        const x = treePositions[i];
        const y = treePositions[i + 1];
        const z = treePositions[i + 2];
        const type = treePositions[i + 3];

        // Deterministic variant selection for jungle trees
        let variant = 0;
        if (type === 5) { // TreeType.JUNGLE = 5
            const seed = x * 12.9898 + z * 78.233;
            const h = Math.abs(Math.sin(seed)) * 43758.5453;
            variant = Math.floor((h % 1) * JUNGLE_VARIANTS);
        }

        const key = `${type}:${variant}`;
        if (!batches.has(key)) {
            batches.set(key, { type, variant, positions: [] });
        }
        batches.get(key)!.positions.push(x, y, z);
    }

    // Now compute matrices for each batch
    const result: Record<string, { type: number; variant: number; count: number; matrices: Float32Array }> = {};
    const buffers: ArrayBuffer[] = [];

    for (const [key, batch] of batches.entries()) {
        const count = batch.positions.length / 3;
        // 16 floats per 4x4 matrix
        const matrices = new Float32Array(count * 16);

        for (let i = 0; i < count; i++) {
            const x = batch.positions[i * 3];
            const y = batch.positions[i * 3 + 1];
            const z = batch.positions[i * 3 + 2];

            // Compute rotation and scale (same logic as was in TreeLayer.tsx)
            const seed = x * 12.9898 + z * 78.233;
            const rotY = (seed % 1) * Math.PI * 2;
            const scale = 0.8 + (seed % 0.4);

            // Build the 4x4 matrix directly (TRS composition)
            // This is equivalent to: translate(x,y,z) * rotateY(rotY) * scale(scale)
            const c = Math.cos(rotY);
            const s = Math.sin(rotY);

            const offset = i * 16;
            // Column-major order for Three.js Matrix4
            // Column 0
            matrices[offset + 0] = c * scale;
            matrices[offset + 1] = 0;
            matrices[offset + 2] = -s * scale;
            matrices[offset + 3] = 0;
            // Column 1
            matrices[offset + 4] = 0;
            matrices[offset + 5] = scale;
            matrices[offset + 6] = 0;
            matrices[offset + 7] = 0;
            // Column 2
            matrices[offset + 8] = s * scale;
            matrices[offset + 9] = 0;
            matrices[offset + 10] = c * scale;
            matrices[offset + 11] = 0;
            // Column 3 (translation)
            matrices[offset + 12] = x;
            matrices[offset + 13] = y;
            matrices[offset + 14] = z;
            matrices[offset + 15] = 1;
        }

        result[key] = {
            type: batch.type,
            variant: batch.variant,
            count,
            matrices
        };
        buffers.push(matrices.buffer);
    }

    return { treeInstanceBatches: result, treeMatrixBuffers: buffers };
};

ctx.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        if (type === 'CONFIGURE') {
            const { worldType } = payload;
            BiomeManager.setWorldType(worldType);
            console.log('[terrain.worker] Configured WorldType:', worldType);
        } else if (type === 'GENERATE') {

            const { cx, cz } = payload;
            // const t0 = performance.now();
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
            const { density, material, metadata, floraPositions, treePositions, stickPositions, rockPositions, largeRockPositions, rootHollowPositions, fireflyPositions } = TerrainService.generateChunk(cx, cz, modifications);

            // --- OPTIMIZATION: Early Out for Terrain-Empty Chunks ---
            // NOTE: Do not treat "liquid-only" chunks as empty: they still need a water surface mesh
            // and shoreline mask (computed at sea-level in `mesher.ts`).
            let isEmpty = true;
            for (let i = 0; i < density.length; i++) {
                if (density[i] > ISO_LEVEL) {
                    isEmpty = false;
                    break;
                }
            }

            if (isEmpty) {
                const water = generateWaterSurfaceMesh(density, material);
                const hasWaterSurface = water.indices.length > 0;
                const waterShoreMask = hasWaterSurface ? water.shoreMask : new Uint8Array(0);

                // Keep ground item rendering/hotspots functional even for geometry-empty chunks.
                const floraHotspots = buildFloraHotspotsPacked(floraPositions);
                const stickData = buildStickData(stickPositions, cx, cz);
                const rockData = buildRockData(rockPositions, cx, cz);
                const treeInstanceData = buildTreeInstanceData(treePositions);

                const emptyResponse = {
                    key: `${cx},${cz}`,
                    cx, cz,
                    density,
                    material,
                    terrainVersion: 0,
                    visualVersion: 0,
                    metadata,
                    // Preserve entities (they might exist even in empty chunks)
                    floraPositions,
                    treePositions,
                    treeInstanceBatches: treeInstanceData.treeInstanceBatches,
                    stickPositions,
                    rockPositions,
                    drySticks: stickData.drySticks,
                    jungleSticks: stickData.jungleSticks,
                    rockDataBuckets: rockData.rockDataBuckets,
                    largeRockPositions,
                    rootHollowPositions,
                    fireflyPositions,
                    floraHotspots,
                    stickHotspots: stickData.stickHotspots,
                    rockHotspots: rockData.rockHotspots,

                    // Stubbed data for empty chunk
                    vegetationData: {},
                    meshPositions: new Float32Array(0),
                    meshIndices: new Uint32Array(0),
                    meshMatWeightsA: new Float32Array(0),
                    meshMatWeightsB: new Float32Array(0),
                    meshMatWeightsC: new Float32Array(0),
                    meshMatWeightsD: new Float32Array(0),
                    meshNormals: new Float32Array(0),
                    meshWetness: new Float32Array(0),
                    meshMossiness: new Float32Array(0),
                    meshCavity: new Float32Array(0),
                    meshWaterPositions: water.positions,
                    meshWaterIndices: water.indices,
                    meshWaterNormals: water.normals,
                    meshWaterShoreMask: waterShoreMask
                };

                ctx.postMessage({ type: 'GENERATED', payload: emptyResponse }, [
                    floraHotspots.buffer,
                    stickData.stickHotspots.buffer,
                    stickData.drySticks.buffer,
                    stickData.jungleSticks.buffer,
                    rockData.rockHotspots.buffer,
                    ...rockData.rockBuffers,
                    ...treeInstanceData.treeMatrixBuffers,
                    density.buffer,
                    material.buffer,
                    metadata.wetness.buffer,
                    metadata.mossiness.buffer,
                    floraPositions.buffer,
                    treePositions.buffer,
                    stickPositions.buffer,
                    rockPositions.buffer,
                    largeRockPositions.buffer,
                    rootHollowPositions.buffer,
                    fireflyPositions.buffer,
                    water.positions.buffer,
                    water.indices.buffer,
                    water.normals.buffer,
                    waterShoreMask.buffer
                ]);
                return;
            }

            // 3. Compute Light Clusters (Async in Worker)
            // const lightPositions = TerrainService.computeLightClusters(floraPositions);

            // --- AMBIENT VEGETATION GENERATION ---
            const vegetationBuckets: Record<number, number[]> = {};

            for (let z = 0; z < CHUNK_SIZE_XZ; z++) {
                for (let x = 0; x < CHUNK_SIZE_XZ; x++) {
                    const worldX = cx * CHUNK_SIZE_XZ + x;
                    const worldZ = cz * CHUNK_SIZE_XZ + z;

                    const biome = BiomeManager.getBiomeAt(worldX, worldZ);
                    let biomeDensity = BiomeManager.getVegetationDensity(worldX, worldZ);
                    if (biome === 'BEACH') biomeDensity *= 0.1;

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
                        const sizeZ = TOTAL_SIZE_XZ;

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
                            const cX = Math.floor(dx);
                            const cY = Math.floor(surfaceY);
                            const cZ = Math.floor(dz);
                            const getD = (ox: number, oy: number, oz: number) => {
                                const ix = Math.max(0, Math.min(sizeX - 1, cX + ox));
                                const iy = Math.max(0, Math.min(sizeY - 1, cY + oy));
                                const iz = Math.max(0, Math.min(sizeZ - 1, cZ + oz));
                                return density[ix + iy * sizeX + iz * sizeX * sizeY];
                            };

                            const nx = -(getD(1, 0, 0) - getD(-1, 0, 0));
                            const ny = -(getD(0, 1, 0) - getD(0, -1, 0));
                            const nz = -(getD(0, 0, 1) - getD(0, 0, -1));
                            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                            const invLen = len > 0.0001 ? 1.0 / len : 0;
                            const nx_val = len > 0.0001 ? nx * invLen : 0;
                            const ny_val = len > 0.0001 ? ny * invLen : 1;
                            const nz_val = len > 0.0001 ? nz * invLen : 0;

                            let numPlants = 1;
                            if (biome === 'JUNGLE' || biome === 'THE_GROVE') {
                                if (finalDensity > threshold + 0.30) numPlants = 7;
                                else if (finalDensity > threshold + 0.15) numPlants = 5;
                                else if (finalDensity > threshold + 0.05) numPlants = 3;
                            } else {
                                if (finalDensity > threshold + 0.4) numPlants = 3;
                                else if (finalDensity > threshold + 0.2) numPlants = 2;
                            }

                            const typeNoise = noise(worldX * 0.1 + 100, 0, worldZ * 0.1 + 100);
                            const normalizedType = (typeNoise + 1) * 0.5;
                            const vegType = getVegetationForBiome(biome, normalizedType);

                            if (vegType !== null) {
                                if (!vegetationBuckets[vegType]) vegetationBuckets[vegType] = [];
                                for (let i = 0; i < numPlants; i++) {
                                    const seed = (worldX * 31 + worldZ * 17 + i * 13);
                                    const r1 = Math.sin(seed) * 43758.5453;
                                    const r2 = Math.cos(seed) * 43758.5453;
                                    const offX = (r1 - Math.floor(r1) - 0.5) * 1.4;
                                    const offZ = (r2 - Math.floor(r2) - 0.5) * 1.4;
                                    const offY = ((r1 + r2) % 1) * -0.15;

                                    let slopeY = 0;
                                    if (ny_val > 0.1) slopeY = -(nx_val * offX + nz_val * offZ) / ny_val;
                                    slopeY = Math.max(-1.0, Math.min(1.0, slopeY));

                                    vegetationBuckets[vegType].push(
                                        x + offX, worldY - 0.1 + offY + slopeY, z + offZ,
                                        nx_val, ny_val, nz_val
                                    );
                                }
                            }
                        }
                    }
                }
            }

            // --- OPTIMIZATION: BATCH ENTITIES & HOTSPOTS IN WORKER ---
            const floraHotspots = buildFloraHotspotsPacked(floraPositions);
            const stickData = buildStickData(stickPositions, cx, cz);
            const rockData = buildRockData(rockPositions, cx, cz);
            // Pre-compute tree instance matrices to avoid main-thread loops
            const treeInstanceData = buildTreeInstanceData(treePositions);

            const mesh = generateMesh(density, material, metadata.wetness, metadata.mossiness) as MeshData;

            // Flatten buckets to Float32Arrays
            const vegetationData: Record<number, Float32Array> = {};
            const vegetationBuffers: ArrayBuffer[] = [];
            for (const [vKey, points] of Object.entries(vegetationBuckets)) {
                const f32 = new Float32Array(points);
                vegetationData[parseInt(vKey)] = f32;
                vegetationBuffers.push(f32.buffer);
            }

            const response = {
                key: `${cx},${cz}`,
                cx, cz,
                density, material, metadata,
                terrainVersion: 0,
                visualVersion: 0,
                vegetationData,
                floraPositions, treePositions,
                treeInstanceBatches: treeInstanceData.treeInstanceBatches,
                rootHollowPositions,
                stickPositions, rockPositions,
                drySticks: stickData.drySticks,
                jungleSticks: stickData.jungleSticks,
                rockDataBuckets: rockData.rockDataBuckets,
                largeRockPositions,
                fireflyPositions,
                floraHotspots,
                stickHotspots: stickData.stickHotspots,
                rockHotspots: rockData.rockHotspots,
                meshPositions: mesh.positions,
                meshIndices: mesh.indices,
                meshMatWeightsA: mesh.matWeightsA,
                meshMatWeightsB: mesh.matWeightsB,
                meshMatWeightsC: mesh.matWeightsC,
                meshMatWeightsD: mesh.matWeightsD,
                meshNormals: mesh.normals,
                meshWetness: mesh.wetness,
                meshMossiness: mesh.mossiness,
                meshCavity: mesh.cavity,
                meshWaterPositions: mesh.waterPositions,
                meshWaterIndices: mesh.waterIndices,
                meshWaterNormals: mesh.waterNormals,
                meshWaterShoreMask: mesh.waterShoreMask
            };

            ctx.postMessage({ type: 'GENERATED', payload: response }, [
                ...vegetationBuffers,
                ...rockData.rockBuffers,
                ...treeInstanceData.treeMatrixBuffers,
                floraHotspots.buffer,
                stickData.stickHotspots.buffer,
                stickData.drySticks.buffer,
                stickData.jungleSticks.buffer,
                rockData.rockHotspots.buffer,
                density.buffer,
                material.buffer,
                metadata.wetness.buffer,
                metadata.mossiness.buffer,
                floraPositions.buffer,
                treePositions.buffer,
                rootHollowPositions.buffer,
                stickPositions.buffer,
                rockPositions.buffer,
                largeRockPositions.buffer,
                fireflyPositions.buffer,
                mesh.positions.buffer,
                mesh.indices.buffer,
                mesh.matWeightsA.buffer,
                mesh.matWeightsB.buffer,
                mesh.matWeightsC.buffer,
                mesh.matWeightsD.buffer,
                mesh.normals.buffer,
                mesh.wetness.buffer,
                mesh.mossiness.buffer,
                mesh.cavity.buffer,
                mesh.waterPositions.buffer,
                mesh.waterIndices.buffer,
                mesh.waterNormals.buffer,
                mesh.waterShoreMask.buffer
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
                meshCavity: mesh.cavity,
                // Keep `meshWater*` naming consistent with ChunkState.
                meshWaterPositions: mesh.waterPositions,
                meshWaterIndices: mesh.waterIndices,
                meshWaterNormals: mesh.waterNormals,
                meshWaterShoreMask: mesh.waterShoreMask
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
                mesh.cavity.buffer,
                mesh.waterPositions.buffer,
                mesh.waterIndices.buffer,
                mesh.waterNormals.buffer,
                mesh.waterShoreMask.buffer
            ]);
        }
    } catch (error) {
        console.error('Worker Error:', error);
    }
};
