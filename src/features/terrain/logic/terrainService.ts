
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, ISO_LEVEL, MESH_Y_OFFSET, SNAP_EPSILON } from '@/constants';
import { noise } from '@core/math/noise';
import { MaterialType, ChunkMetadata } from '@/types';

export class TerrainService {
    // Helper to find surface height at specific world coordinates
    static getHeightAt(wx: number, wz: number): number {
        // Directly compute the analytic surface (no cave carving) so we always get the true top
        const warpScale = 0.008;
        const warpStr = 15.0;
        const qx = noise(wx * warpScale, 0, wz * warpScale) * warpStr;
        const qz = noise(wx * warpScale + 5.2, 0, wz * warpScale + 1.3) * warpStr;

        const px = wx + qx;
        const pz = wz + qz;

        const continental = noise(px * 0.01, 0, pz * 0.01) * 8;
        let mountains = noise(px * 0.05, 0, pz * 0.05) * 4;
        mountains += noise(px * 0.15, 0, pz * 0.15) * 1.5;

        const surfaceHeight = 14 + continental + mountains;
        // Sample cliff overhang at the surface height
        const cliffNoise = noise(wx * 0.06, surfaceHeight * 0.08, wz * 0.06);
        const overhang = cliffNoise * 6;

        return surfaceHeight + overhang;
    }

    static generateChunk(cx: number, cz: number): {
        density: Float32Array,
        material: Uint8Array,
        metadata: ChunkMetadata,
        floraPositions: Float32Array,
        rootHollowPositions: Float32Array
    } {
        const sizeX = TOTAL_SIZE_XZ;
        const sizeY = TOTAL_SIZE_Y;
        const sizeZ = TOTAL_SIZE_XZ;

        const density = new Float32Array(sizeX * sizeY * sizeZ);
        const material = new Uint8Array(sizeX * sizeY * sizeZ);
        const wetness = new Uint8Array(sizeX * sizeY * sizeZ);
        const mossiness = new Uint8Array(sizeX * sizeY * sizeZ);
        const floraCandidates: number[] = [];
        const rootHollowCandidates: number[] = [];

        const worldOffsetX = cx * CHUNK_SIZE_XZ;
        const worldOffsetZ = cz * CHUNK_SIZE_XZ;

        for (let z = 0; z < sizeZ; z++) {
            for (let y = 0; y < sizeY; y++) {
                for (let x = 0; x < sizeX; x++) {

                    const idx = x + y * sizeX + z * sizeX * sizeY;

                    // World Coordinates
                    const wx = (x - PAD) + worldOffsetX;
                    // Apply vertical offset
                    const wy = (y - PAD) + MESH_Y_OFFSET;
                    const wz = (z - PAD) + worldOffsetZ;

                    // --- 1. Domain Warping ---
                    const warpScale = 0.008;
                    const warpStr = 15.0;
                    const qx = noise(wx * warpScale, 0, wz * warpScale) * warpStr;
                    const qz = noise(wx * warpScale + 5.2, 0, wz * warpScale + 1.3) * warpStr;

                    const px = wx + qx;
                    const pz = wz + qz;

                    // --- 2. Density / Height Generation ---
                    const continental = noise(px * 0.01, 0, pz * 0.01) * 8;

                    let mountains = noise(px * 0.05, 0, pz * 0.05) * 4;
                    mountains += noise(px * 0.15, 0, pz * 0.15) * 1.5;

                    const cliffNoise = noise(wx * 0.06, wy * 0.08, wz * 0.06);
                    const overhang = cliffNoise * 6;

                    const surfaceHeight = 14 + continental + mountains;

                    let d = surfaceHeight - wy + overhang;

                    // Caves
                    if (wy < surfaceHeight - 4) {
                        const caveFreq = 0.08;
                        const c1 = noise(wx * caveFreq, wy * caveFreq, wz * caveFreq);
                        if (Math.abs(c1) < 0.12) {
                            d -= 20.0;
                            // Let deep caves reach near bedrock; carve a bit more in the lowest band
                            if (wy < MESH_Y_OFFSET + 8) d -= 6.0;
                        }
                    }

                    // Hard floor (Bedrock) — thin but solid
                    if (wy <= MESH_Y_OFFSET) d += 100.0;
                    else if (wy <= MESH_Y_OFFSET + 3) d += 20.0;

                    // --- AAA FIX: GENERATION HYSTERESIS ---
                    if (Math.abs(d - ISO_LEVEL) < SNAP_EPSILON) {
                        d = (d < ISO_LEVEL)
                            ? ISO_LEVEL - SNAP_EPSILON
                            : ISO_LEVEL + SNAP_EPSILON;
                    }
                    // --------------------------------------

                    density[idx] = d;

                    // --- Root Hollow Scanning ---
                    // Only check surface voxels (not every voxel)
                    if (y > 0 && y < sizeY - 1) {
                        const idxBelow = idx - sizeX;
                        const dBelow = density[idxBelow];
                        // Detect Surface: Current is Air (<= ISO), Below is Solid (> ISO)
                        if (d <= ISO_LEVEL && dBelow > ISO_LEVEL) {
                            // Relaxed Valley Conditions (lower/valley areas, but not too strict)
                            // Debug: Track how many surface voxels pass each condition
                            if (continental < 0.0 && mountains < 1.5) {
                                // Calculate local slope to ensure flat-ish areas
                                // Sample neighboring heights to check flatness
                                let maxHeightDiff = 0.0;
                                const sampleRadius = 2;
                                const centerHeight = wy;

                                for (let dz = -sampleRadius; dz <= sampleRadius; dz++) {
                                    for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
                                        if (dx === 0 && dz === 0) continue;
                                        const sampleX = Math.max(0, Math.min(sizeX - 1, x + dx));
                                        const sampleZ = Math.max(0, Math.min(sizeZ - 1, z + dz));
                                        // Find surface height at sample point
                                        for (let sy = y - 2; sy <= y + 2; sy++) {
                                            if (sy < 0 || sy >= sizeY) continue;
                                            const sampleIdx = sampleX + sy * sizeX + sampleZ * sizeX * sizeY;
                                            const sampleD = density[sampleIdx];
                                            const sampleDBelow = (sy > 0) ? density[sampleIdx - sizeX] : sampleD;
                                            if (sampleD <= ISO_LEVEL && sampleDBelow > ISO_LEVEL) {
                                                const sampleHeight = (sy - PAD) + MESH_Y_OFFSET;
                                                const heightDiff = Math.abs(sampleHeight - centerHeight);
                                                maxHeightDiff = Math.max(maxHeightDiff, heightDiff);
                                                break;
                                            }
                                        }
                                    }
                                }

                                // Relaxed flatness check (slope < 3.5 units to allow placement on slopes)
                                if (maxHeightDiff < 3.5) {
                                    // Moderate spawn rate (~25% chance)
                                    const sparsityNoise = noise(wx * 0.5, wy * 0.5, wz * 0.5);
                                    if (sparsityNoise > 0.75) {
                                        // Place slightly embedded underground (roots go down)
                                        // Use local coordinates relative to the chunk (ChunkMesh applies the world offset)
                                        const localX = (x - PAD) + 0.5;
                                        const localY = wy - 0.8;
                                        const localZ = (z - PAD) + 0.5;

                                        // --- Calculate Surface Normal via Central Differences ---
                                        // Calculate gradient at the SOLID voxel below (y-1), not the air voxel
                                        // We use a wider stride (2 voxels) to get a smoother "average" slope that ignores small noise bumps
                                        const solidY = y - 1;
                                        const stride = 2; // Widen sampling to smooth out normals

                                        const idxXp = Math.min(sizeX - 1, x + stride) + solidY * sizeX + z * sizeX * sizeY;
                                        const idxXm = Math.max(0, x - stride) + solidY * sizeX + z * sizeX * sizeY;
                                        const idxYp = x + Math.min(sizeY - 1, solidY + stride) * sizeX + z * sizeX * sizeY;
                                        const idxYm = x + Math.max(0, solidY - stride) * sizeX + z * sizeX * sizeY;
                                        const idxZp = x + solidY * sizeX + Math.min(sizeZ - 1, z + stride) * sizeX * sizeY;
                                        const idxZm = x + solidY * sizeX + Math.max(0, z - stride) * sizeX * sizeY;

                                        const dx = density[idxXp] - density[idxXm];
                                        const dy = density[idxYp] - density[idxYm];
                                        const dz = density[idxZp] - density[idxZm];

                                        // The gradient points towards higher density (solid), so the Normal points away (negative gradient)
                                        // Normalize the vector
                                        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                                        const nx = len > 0.001 ? -dx / len : 0;
                                        const ny = len > 0.001 ? -dy / len : 1; // Default to up if gradient is too small
                                        const nz = len > 0.001 ? -dz / len : 0;

                                        // Push 6 values: Position (x,y,z) AND Normal (nx,ny,nz)
                                        rootHollowCandidates.push(localX, localY, localZ, nx, ny, nz);

                                        // Debug logging
                                        console.log(`[TerrainService] Root generated at chunk (${cx},${cz}) world pos (${wx.toFixed(1)}, ${wy.toFixed(1)}, ${wz.toFixed(1)}) local (${localX.toFixed(1)}, ${localY.toFixed(1)}, ${localZ.toFixed(1)}) normal (${nx.toFixed(2)}, ${ny.toFixed(2)}, ${nz.toFixed(2)}) - continental: ${continental.toFixed(2)}, mountains: ${mountains.toFixed(2)}, flatness: ${maxHeightDiff.toFixed(2)}`);
                                    }
                                }
                            }
                        }
                    }

                    // --- 3. Material Generation ---

                    if (d > ISO_LEVEL) { // If solid
                        const soilNoise = noise(wx * 0.1, wy * 0.1, wz * 0.1);
                        const soilDepth = 8.0 + soilNoise * 4.0;

                        const depth = (surfaceHeight + overhang) - wy;

                        // Deep Bedrock
                        if (wy <= MESH_Y_OFFSET + 4) {
                            material[idx] = MaterialType.BEDROCK;
                        }
                        else if (depth > soilDepth) {
                            material[idx] = MaterialType.STONE;
                        } else {
                            // Surface Layers
                            if (wy > 24 + noise(wx * 0.1, 0, wz * 0.1) * 4) {
                                material[idx] = MaterialType.SNOW;
                            }
                            else if (wy < WATER_LEVEL + 2.0) {
                                if (wy < WATER_LEVEL + 1.0) material[idx] = MaterialType.SAND;
                                else material[idx] = (noise(wx * 0.5, 0, wz * 0.5) > 0) ? MaterialType.SAND : MaterialType.DIRT;
                            }
                            else {
                                if (depth < 3.5) {
                                    material[idx] = MaterialType.GRASS;
                                } else {
                                    material[idx] = MaterialType.DIRT;
                                }
                            }
                        }
                    } else {
                        // --- Water Generation ---
                        if (wy <= WATER_LEVEL) {
                            material[idx] = MaterialType.WATER;
                            wetness[idx] = 255;
                        } else {
                            material[idx] = MaterialType.AIR;
                        }

                        // --- Flora Generation Pass ---
                        // Check if this is a cave floor (air above solid stone/bedrock)
                        // Caves are any enclosed space below the surface
                        if (wy < surfaceHeight - 5 && wy > MESH_Y_OFFSET + 3) {
                            if (y > 0) {
                                const idxBelow = x + (y - 1) * sizeX + z * sizeX * sizeY;
                                const dBelow = density[idxBelow];

                                // Current is Air, Below is Solid
                                if (dBelow > ISO_LEVEL) {
                                    const matBelow = material[idxBelow];
                                    // Allow Stone, Mossy Stone, Bedrock
                                    if (matBelow === MaterialType.STONE || matBelow === MaterialType.MOSSY_STONE ||
                                        matBelow === MaterialType.BEDROCK) {

                                        // Sparsity Noise - controls how frequently flora spawns
                                        const nFlora = noise(wx * 0.12, wy * 0.12, wz * 0.12);
                                        if (nFlora > 0.7) { // Lower threshold for more visibility
                                            // Random hash for placement jitter
                                            const hash = Math.abs(noise(wx * 12.3, wy * 12.3, wz * 12.3));
                                            floraCandidates.push(
                                                (x - PAD) + (hash * 0.4 - 0.2),
                                                (y - PAD) + MESH_Y_OFFSET + 0.1, // Slightly above floor
                                                (z - PAD) + (hash * 0.4 - 0.2)
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        const metadata: ChunkMetadata = {
            wetness,
            mossiness
        };

        // Debug: log flora generation
        if (floraCandidates.length > 0) {
            console.log(`[TerrainService] Chunk (${cx},${cz}) generated ${floraCandidates.length / 3} flora positions`);
        }

        // Debug: log root hollow generation (now 6 values per root: position + normal)
        const rootCount = rootHollowCandidates.length / 6;
        if (rootCount > 0) {
            console.log(`[TerrainService] Chunk (${cx},${cz}) generated ${rootCount} root hollow positions`);
        } else {
            console.log(`[TerrainService] Chunk (${cx},${cz}) generated 0 root hollow positions (conditions too strict?)`);
        }

        return {
            density,
            material,
            metadata,
            floraPositions: new Float32Array(floraCandidates),
            rootHollowPositions: new Float32Array(rootHollowCandidates)
        };
    }

    static modifyChunk(
        density: Float32Array,
        materialData: Uint8Array,
        localPoint: { x: number, y: number, z: number },
        radius: number,
        delta: number,
        brushMaterial: MaterialType = MaterialType.DIRT
    ): boolean {
        const sizeX = TOTAL_SIZE_XZ;
        const sizeY = TOTAL_SIZE_Y;
        const sizeZ = TOTAL_SIZE_XZ;

        const hx = localPoint.x + PAD;
        // Map World Y to Grid Y
        const hy = localPoint.y - MESH_Y_OFFSET + PAD;
        const hz = localPoint.z + PAD;

        const rSq = radius * radius;
        const iRad = Math.ceil(radius);
        const minX = Math.max(0, Math.floor(hx - iRad));
        const maxX = Math.min(sizeX - 1, Math.ceil(hx + iRad));
        const minY = Math.max(0, Math.floor(hy - iRad));
        const maxY = Math.min(sizeY - 1, Math.ceil(hy + iRad));
        const minZ = Math.max(0, Math.floor(hz - iRad));
        const maxZ = Math.min(sizeZ - 1, Math.ceil(hz + iRad));

        let modified = false;

        for (let z = minZ; z <= maxZ; z++) {
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const dx = x - hx;
                    const dy = y - hy;
                    const dz = z - hz;
                    const distSq = dx * dx + dy * dy + dz * dz;

                    if (distSq < rSq) {
                        const idx = x + y * sizeX + z * sizeX * sizeY;
                        const dist = Math.sqrt(distSq);
                        const t = dist / radius;

                        // Tweak: Use a cubic falloff (pow 3) instead of quadratic (pow 2).
                        const falloff = Math.pow(1.0 - t, 3);

                        const strength = falloff * delta;
                        const oldDensity = density[idx];

                        density[idx] += strength;

                        // --- DENSITY HYSTERESIS ---
                        if (Math.abs(density[idx] - ISO_LEVEL) < SNAP_EPSILON) {
                            density[idx] = (delta < 0)
                                ? ISO_LEVEL - SNAP_EPSILON  // Force Air
                                : ISO_LEVEL + SNAP_EPSILON; // Force Solid
                        }

                        // Apply material when building
                        if (delta > 0 && density[idx] > ISO_LEVEL) {
                            if (oldDensity <= ISO_LEVEL) {
                                materialData[idx] = brushMaterial;
                            }
                        }
                        // Clear material when digging
                        if (delta < 0 && density[idx] <= ISO_LEVEL) {
                            materialData[idx] = MaterialType.AIR;
                        }

                        if (density[idx] > 20.0) density[idx] = 20.0;
                        if (density[idx] < -20.0) density[idx] = -20.0;
                        modified = true;
                    }
                }
            }
        }
        return modified;
    }
}
