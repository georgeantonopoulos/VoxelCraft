import { TerrainService } from '@features/terrain/logic/terrainService';
import { generateMesh, generateWaterSurfaceMesh } from '@features/terrain/logic/mesher';
import { MeshData } from '@/types';
import { getChunkModifications } from '@/state/WorldDB';
import { CACHE_VERSION, getCachedChunk } from '@/state/ChunkCache';
import { BiomeManager } from '../logic/BiomeManager';
import { getVegetationForBiome } from '../logic/VegetationConfig';
import { noise } from '@core/math/noise';
import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, ISO_LEVEL } from '@/constants';
import { generateLightGrid, extractLuminaLights, getSkyLightConfig } from '@core/lighting/lightPropagation';

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

const buildTreeInstanceData = (treePositions: Float32Array) => {
    const batches = new Map<string, { type: number; variant: number; positions: number[]; scales: number[]; originalIndices: number[] }>();
    const STRIDE = 5;
    for (let i = 0; i < treePositions.length; i += STRIDE) {
        const x = treePositions[i], y = treePositions[i + 1], z = treePositions[i + 2], type = treePositions[i + 3], scaleFactor = treePositions[i + 4];
        let variant = 0;
        if (type === 5) {
            const seed = x * 12.9898 + z * 78.233;
            const h = Math.abs(Math.sin(seed)) * 43758.5453;
            variant = Math.floor((h % 1) * 4);
        }
        const key = `${type}:${variant}`;
        if (!batches.has(key)) batches.set(key, { type, variant, positions: [], scales: [], originalIndices: [] });
        const b = batches.get(key)!;
        b.positions.push(x, y, z); b.scales.push(scaleFactor); b.originalIndices.push(i);
    }
    const result: Record<string, any> = {};
    const buffers: ArrayBuffer[] = [];
    for (const [key, batch] of batches.entries()) {
        const count = batch.positions.length / 3;
        const matrices = new Float32Array(count * 16), originalIndices = new Int32Array(batch.originalIndices);
        for (let i = 0; i < count; i++) {
            const x = batch.positions[i * 3], y = batch.positions[i * 3 + 1], z = batch.positions[i * 3 + 2], scale = batch.scales[i];
            const seed = x * 12.9898 + z * 78.233, rotY = (seed % 1) * Math.PI * 2, c = Math.cos(rotY), s = Math.sin(rotY);
            const offset = i * 16;
            matrices[offset + 0] = c * scale; matrices[offset + 2] = -s * scale; matrices[offset + 5] = scale; matrices[offset + 8] = s * scale; matrices[offset + 10] = c * scale;
            matrices[offset + 12] = x; matrices[offset + 13] = y; matrices[offset + 14] = z; matrices[offset + 15] = 1;
        }
        result[key] = { type: batch.type, variant: batch.variant, count, matrices, originalIndices };
        buffers.push(matrices.buffer); buffers.push(originalIndices.buffer);
    }
    return { treeInstanceBatches: result, treeMatrixBuffers: buffers };
};

ctx.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;
    try {
        if (type === 'CONFIGURE') {
            const { worldType, seed } = payload;
            if (seed !== undefined) {
                BiomeManager.reinitialize(seed);
                // Also reinitialize Perlin noise for terrain generation
                const { initializeNoise } = await import('@core/math/noise');
                initializeNoise(seed);
                (self as any).worldSeed = seed;
            }
            if (worldType !== undefined) {
                BiomeManager.setWorldType(worldType);
                (self as any).worldType = worldType;
            }
        } else if (type === 'GENERATE') {
            const { cx, cz } = payload;
            let modifications: any[] = [];
            try { modifications = await getChunkModifications(cx, cz); } catch (err) { console.error('[terrain.worker] DB Read Error:', err); }
            const worldType = (self as any).worldType || 'DEFAULT';
            if (modifications.length === 0) {
                const cached = await getCachedChunk(cx, cz, worldType, CACHE_VERSION);
                if (cached) {
                    const response = {
                        key: `${cx},${cz}`, cx, cz, density: cached.density, material: cached.material, terrainVersion: 0, visualVersion: 0,
                        metadata: { wetness: cached.meshWetness, mossiness: cached.meshMossiness },
                        floraPositions: cached.floraPositions || new Float32Array(0),
                        treePositions: cached.treePositions || new Float32Array(0),
                        treeInstanceBatches: cached.treeInstanceBatches || {},
                        rootHollowPositions: cached.rootHollowPositions || new Float32Array(0),
                        stickPositions: cached.stickPositions || new Float32Array(0),
                        rockPositions: cached.rockPositions || new Float32Array(0),
                        drySticks: cached.drySticks || new Float32Array(0),
                        jungleSticks: cached.jungleSticks || new Float32Array(0),
                        rockDataBuckets: cached.rockDataBuckets || {},
                        largeRockPositions: cached.largeRockPositions || new Float32Array(0),
                        fireflyPositions: cached.fireflyPositions || new Float32Array(0),
                        floraHotspots: cached.floraHotspots || new Float32Array(0),
                        stickHotspots: cached.stickHotspots || new Float32Array(0),
                        rockHotspots: cached.rockHotspots || new Float32Array(0),
                        vegetationData: cached.vegetationData || {},
                        meshPositions: cached.meshPositions, meshIndices: cached.meshIndices, meshMatWeightsA: cached.meshMatWeightsA, meshMatWeightsB: cached.meshMatWeightsB,
                        meshMatWeightsC: cached.meshMatWeightsC, meshMatWeightsD: cached.meshMatWeightsD, meshNormals: cached.meshNormals, meshWetness: cached.meshWetness,
                        meshMossiness: cached.meshMossiness, meshCavity: cached.meshCavity, meshWaterPositions: cached.meshWaterPositions, meshWaterIndices: cached.meshWaterIndices,
                        meshWaterNormals: cached.meshWaterNormals, meshWaterShoreMask: cached.meshWaterShoreMask,
                        colliderPositions: cached.colliderPositions, colliderIndices: cached.colliderIndices, colliderHeightfield: cached.colliderHeightfield, isHeightfield: cached.isHeightfield
                    };
                    const buffers: ArrayBuffer[] = [
                        cached.density.buffer as ArrayBuffer, cached.material.buffer as ArrayBuffer, cached.meshPositions.buffer as ArrayBuffer, cached.meshIndices.buffer as ArrayBuffer,
                        cached.meshNormals.buffer as ArrayBuffer, cached.meshMatWeightsA.buffer as ArrayBuffer, cached.meshMatWeightsB.buffer as ArrayBuffer, cached.meshMatWeightsC.buffer as ArrayBuffer,
                        cached.meshMatWeightsD.buffer as ArrayBuffer, cached.meshWetness.buffer as ArrayBuffer, cached.meshMossiness.buffer as ArrayBuffer, cached.meshCavity.buffer as ArrayBuffer,
                        cached.meshWaterPositions.buffer as ArrayBuffer, cached.meshWaterIndices.buffer as ArrayBuffer, cached.meshWaterNormals.buffer as ArrayBuffer, cached.meshWaterShoreMask.buffer as ArrayBuffer
                    ];
                    if (cached.floraPositions) buffers.push(cached.floraPositions.buffer as ArrayBuffer);
                    if (cached.treePositions) buffers.push(cached.treePositions.buffer as ArrayBuffer);
                    if (cached.rootHollowPositions) buffers.push(cached.rootHollowPositions.buffer as ArrayBuffer);
                    if (cached.stickPositions) buffers.push(cached.stickPositions.buffer as ArrayBuffer);
                    if (cached.rockPositions) buffers.push(cached.rockPositions.buffer as ArrayBuffer);
                    if (cached.largeRockPositions) buffers.push(cached.largeRockPositions.buffer as ArrayBuffer);
                    if (cached.drySticks) buffers.push(cached.drySticks.buffer as ArrayBuffer);
                    if (cached.jungleSticks) buffers.push(cached.jungleSticks.buffer as ArrayBuffer);
                    if (cached.fireflyPositions) buffers.push(cached.fireflyPositions.buffer as ArrayBuffer);
                    if (cached.floraHotspots) buffers.push(cached.floraHotspots.buffer as ArrayBuffer);
                    if (cached.stickHotspots) buffers.push(cached.stickHotspots.buffer as ArrayBuffer);
                    if (cached.rockHotspots) buffers.push(cached.rockHotspots.buffer as ArrayBuffer);
                    if (cached.colliderPositions) buffers.push(cached.colliderPositions.buffer as ArrayBuffer);
                    if (cached.colliderIndices) buffers.push(cached.colliderIndices.buffer as ArrayBuffer);
                    if (cached.colliderHeightfield) buffers.push(cached.colliderHeightfield.buffer as ArrayBuffer);
                    if (cached.rockDataBuckets) { for (const b of Object.values(cached.rockDataBuckets)) buffers.push((b as any).buffer); }
                    if (cached.vegetationData) { for (const b of Object.values(cached.vegetationData)) buffers.push((b as any).buffer); }
                    if (cached.treeInstanceBatches) { for (const b of Object.values(cached.treeInstanceBatches as any)) { const batch = b as any; if (batch.matrices) buffers.push(batch.matrices.buffer); if (batch.originalIndices) buffers.push(batch.originalIndices.buffer); } }
                    ctx.postMessage({ type: 'GENERATED', payload: response }, buffers);
                    return;
                }
            }
            const { density, material, metadata, floraPositions, treePositions, stickPositions, rockPositions, largeRockPositions, rootHollowPositions, fireflyPositions } = TerrainService.generateChunk(cx, cz, modifications);
            let isEmpty = true;
            for (let i = 0; i < density.length; i++) { if (density[i] > ISO_LEVEL) { isEmpty = false; break; } }
            if (isEmpty) {
                const water = generateWaterSurfaceMesh(density, material);
                const stickData = buildStickData(stickPositions, cx, cz), rockData = buildRockData(rockPositions, cx, cz), treeInstanceData = buildTreeInstanceData(treePositions);
                // Generate light grid even for empty chunks (sky light still applies)
                const emptyLuminaLights = extractLuminaLights(floraPositions);
                const emptySkyLight = getSkyLightConfig(0.5);
                const emptyLightGrid = generateLightGrid(density, emptyLuminaLights, emptySkyLight);
                const emptyResponse = {
                    key: `${cx},${cz}`, cx, cz, density, material, terrainVersion: 0, visualVersion: 0, metadata,
                    floraPositions, treePositions, treeInstanceBatches: treeInstanceData.treeInstanceBatches, stickPositions, rockPositions, drySticks: stickData.drySticks, jungleSticks: stickData.jungleSticks,
                    rockDataBuckets: rockData.rockDataBuckets, largeRockPositions, rootHollowPositions, fireflyPositions, floraHotspots: buildFloraHotspotsPacked(floraPositions),
                    stickHotspots: stickData.stickHotspots, rockHotspots: rockData.rockHotspots, vegetationData: {}, meshPositions: new Float32Array(0), meshIndices: new Uint32Array(0),
                    meshMatWeightsA: new Float32Array(0), meshMatWeightsB: new Float32Array(0), meshMatWeightsC: new Float32Array(0), meshMatWeightsD: new Float32Array(0),
                    meshNormals: new Float32Array(0), meshWetness: new Float32Array(0), meshMossiness: new Float32Array(0), meshCavity: new Float32Array(0),
                    meshWaterPositions: water.positions, meshWaterIndices: water.indices, meshWaterNormals: water.normals, meshWaterShoreMask: water.indices.length > 0 ? water.shoreMask : new Uint8Array(0),
                    lightGrid: emptyLightGrid
                };
                ctx.postMessage({ type: 'GENERATED', payload: emptyResponse }, [
                    ...rockData.rockBuffers, ...treeInstanceData.treeMatrixBuffers, density.buffer, material.buffer, metadata.wetness.buffer, metadata.mossiness.buffer, floraPositions.buffer, treePositions.buffer, stickPositions.buffer, rockPositions.buffer, largeRockPositions.buffer, rootHollowPositions.buffer, fireflyPositions.buffer, water.positions.buffer, water.indices.buffer, water.normals.buffer, emptyResponse.meshWaterShoreMask.buffer, emptyResponse.floraHotspots.buffer, stickData.stickHotspots.buffer, stickData.drySticks.buffer, stickData.jungleSticks.buffer, rockData.rockHotspots.buffer, emptyLightGrid.buffer
                ]);
                return;
            }
            const vegetationBuckets: Record<number, number[]> = {};
            for (let z = 0; z < CHUNK_SIZE_XZ; z++) {
                for (let x = 0; x < CHUNK_SIZE_XZ; x++) {
                    const worldX = cx * CHUNK_SIZE_XZ + x, worldZ = cz * CHUNK_SIZE_XZ + z;
                    const biome = BiomeManager.getBiomeAt(worldX, worldZ);
                    let bDensity = BiomeManager.getVegetationDensity(worldX, worldZ); if (biome === 'BEACH') bDensity *= 0.1;
                    if ((noise(worldX * 0.15, 0, worldZ * 0.15) + 1) * 0.5 + noise(worldX * 0.8, 0, worldZ * 0.8) * 0.3 > 1.0 - bDensity) {
                        let surfaceY = -1; const pad = 2, dx = x + pad, dz = z + pad, sizeX = TOTAL_SIZE_XZ, sizeY = TOTAL_SIZE_Y;
                        for (let y = sizeY - 2; y >= 0; y--) {
                            const idx = dx + y * sizeX + dz * sizeX * sizeY;
                            if (density[idx] > ISO_LEVEL) { surfaceY = y + (ISO_LEVEL - density[idx]) / (density[idx + sizeX] - density[idx]); break; }
                        }
                        const worldY = (surfaceY - pad) - 35;
                        if (surfaceY > 0 && worldY > 11) {
                            const cX = Math.floor(dx), cY = Math.floor(surfaceY), cZ = Math.floor(dz);
                            const getD = (ox: number, oy: number, oz: number) => density[Math.max(0, Math.min(sizeX - 1, cX + ox)) + Math.max(0, Math.min(sizeY - 1, cY + oy)) * sizeX + Math.max(0, Math.min(sizeX - 1, cZ + oz)) * sizeX * sizeY];
                            const nx = -(getD(1, 0, 0) - getD(-1, 0, 0)), ny = -(getD(0, 1, 0) - getD(0, -1, 0)), nz = -(getD(0, 0, 1) - getD(0, 0, -1)), len = Math.sqrt(nx * nx + ny * ny + nz * nz), invLen = len > 0.0001 ? 1.0 / len : 0;
                            const nxV = nx * invLen, nyV = len > 0.0001 ? ny * invLen : 1, nzV = nz * invLen;
                            let numPlants = (biome === 'JUNGLE' || biome === 'THE_GROVE') ? 3 : 1;
                            const vegType = getVegetationForBiome(biome, (noise(worldX * 0.1 + 100, 0, worldZ * 0.1 + 100) + 1) * 0.5);
                            if (vegType !== null) {
                                if (!vegetationBuckets[vegType]) vegetationBuckets[vegType] = [];
                                for (let i = 0; i < numPlants; i++) {
                                    const seed = worldX * 31 + worldZ * 17 + i * 13, r1 = Math.sin(seed) * 43758.5453, r2 = Math.cos(seed) * 43758.5453;
                                    const offX = (r1 - Math.floor(r1) - 0.5) * 1.4, offZ = (r2 - Math.floor(r2) - 0.5) * 1.4, offY = ((r1 + r2) % 1) * -0.15;
                                    let slopeY = nyV > 0.1 ? -(nxV * offX + nzV * offZ) / nyV : 0;
                                    vegetationBuckets[vegType].push(x + offX, worldY - 0.1 + offY + Math.max(-1.0, Math.min(1.0, slopeY)), z + offZ, nxV, nyV, nzV);
                                }
                            }
                        }
                    }
                }
            }
            // Generate voxel-based light grid for GI (must be before mesh generation)
            const luminaLights = extractLuminaLights(floraPositions);
            // Use default daylight sky - the main thread can update this dynamically if needed
            const skyLight = getSkyLightConfig(0.5); // 0.5 = midday sun
            const lightGrid = generateLightGrid(density, luminaLights, skyLight);

            // Generate mesh with light grid for per-vertex GI baking
            const mesh = generateMesh(density, material, metadata.wetness, metadata.mossiness, lightGrid) as MeshData;

            const vegetationData: Record<number, Float32Array> = {}, vegetationBuffers: ArrayBuffer[] = [];
            for (const [vKey, points] of Object.entries(vegetationBuckets)) { const f32 = new Float32Array(points); vegetationData[parseInt(vKey)] = f32; vegetationBuffers.push(f32.buffer); }
            const stickData = buildStickData(stickPositions, cx, cz), rockData = buildRockData(rockPositions, cx, cz), treeInstanceData = buildTreeInstanceData(treePositions);
            const response = {
                key: `${cx},${cz}`, cx, cz, density, material, metadata, terrainVersion: 0, visualVersion: 0, vegetationData, floraPositions, treePositions, treeInstanceBatches: treeInstanceData.treeInstanceBatches, rootHollowPositions, stickPositions, rockPositions, drySticks: stickData.drySticks, jungleSticks: stickData.jungleSticks, rockDataBuckets: rockData.rockDataBuckets, largeRockPositions, fireflyPositions, floraHotspots: buildFloraHotspotsPacked(floraPositions), stickHotspots: stickData.stickHotspots, rockHotspots: rockData.rockHotspots,
                meshPositions: mesh.positions, meshIndices: mesh.indices, meshMatWeightsA: mesh.matWeightsA, meshMatWeightsB: mesh.matWeightsB, meshMatWeightsC: mesh.matWeightsC, meshMatWeightsD: mesh.matWeightsD, meshNormals: mesh.normals, meshWetness: mesh.wetness, meshMossiness: mesh.mossiness, meshCavity: mesh.cavity, meshLightColors: mesh.lightColors, meshWaterPositions: mesh.waterPositions, meshWaterIndices: mesh.waterIndices, meshWaterNormals: mesh.waterNormals, meshWaterShoreMask: mesh.waterShoreMask,
                colliderPositions: mesh.colliderPositions, colliderIndices: mesh.colliderIndices, colliderHeightfield: mesh.colliderHeightfield, isHeightfield: mesh.isHeightfield,
                lightGrid
            };
            const transfers: any[] = [
                ...vegetationBuffers, ...rockData.rockBuffers, ...treeInstanceData.treeMatrixBuffers, response.floraHotspots.buffer, stickData.stickHotspots.buffer, stickData.drySticks.buffer, stickData.jungleSticks.buffer, rockData.rockHotspots.buffer, density.buffer, material.buffer, metadata.wetness.buffer, metadata.mossiness.buffer, floraPositions.buffer, treePositions.buffer, largeRockPositions.buffer, rootHollowPositions.buffer, fireflyPositions.buffer, mesh.positions.buffer, mesh.indices.buffer, mesh.matWeightsA.buffer, mesh.matWeightsB.buffer, mesh.matWeightsC.buffer, mesh.matWeightsD.buffer, mesh.normals.buffer, mesh.wetness.buffer, mesh.mossiness.buffer, mesh.cavity.buffer, mesh.lightColors.buffer, mesh.waterPositions.buffer, mesh.waterIndices.buffer, mesh.waterNormals.buffer, mesh.waterShoreMask.buffer, lightGrid.buffer
            ];
            if (mesh.colliderPositions) transfers.push(mesh.colliderPositions.buffer); if (mesh.colliderIndices) transfers.push(mesh.colliderIndices.buffer); if (mesh.colliderHeightfield) transfers.push(mesh.colliderHeightfield.buffer);
            ctx.postMessage({ type: 'GENERATED', payload: response }, transfers);
        } else if (type === 'REMESH') {
            const { density, material, wetness, mossiness, key, cx, cz, version } = payload;
            const mesh = generateMesh(density, material, wetness, mossiness) as MeshData;
            const response = {
                key, cx, cz, version, meshPositions: mesh.positions, meshIndices: mesh.indices, meshMatWeightsA: mesh.matWeightsA, meshMatWeightsB: mesh.matWeightsB, meshMatWeightsC: mesh.matWeightsC, meshMatWeightsD: mesh.matWeightsD, meshNormals: mesh.normals, meshWetness: mesh.wetness, meshMossiness: mesh.mossiness, meshCavity: mesh.cavity, meshWaterPositions: mesh.waterPositions, meshWaterIndices: mesh.waterIndices, meshWaterNormals: mesh.waterNormals, meshWaterShoreMask: mesh.waterShoreMask,
                colliderPositions: mesh.colliderPositions, colliderIndices: mesh.colliderIndices, colliderHeightfield: mesh.colliderHeightfield, isHeightfield: mesh.isHeightfield
            };
            const transfers: any[] = [
                mesh.positions.buffer, mesh.indices.buffer, mesh.matWeightsA.buffer, mesh.matWeightsB.buffer, mesh.matWeightsC.buffer, mesh.matWeightsD.buffer, mesh.normals.buffer, mesh.wetness.buffer, mesh.mossiness.buffer, mesh.cavity.buffer, mesh.waterPositions.buffer, mesh.waterIndices.buffer, mesh.waterNormals.buffer, mesh.waterShoreMask.buffer
            ];
            if (mesh.colliderPositions) transfers.push(mesh.colliderPositions.buffer); if (mesh.colliderIndices) transfers.push(mesh.colliderIndices.buffer); if (mesh.colliderHeightfield) transfers.push(mesh.colliderHeightfield.buffer);
            ctx.postMessage({ type: 'REMESHED', payload: response }, transfers);
        }
    } catch (error) { console.error('Worker Error:', error); }
};
