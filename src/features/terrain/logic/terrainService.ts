
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, ISO_LEVEL, MESH_Y_OFFSET, SNAP_EPSILON } from '@/constants';
import { noise } from '@core/math/noise';
import { MaterialType, ChunkMetadata } from '@/types';
import { BiomeManager, BiomeType } from './BiomeManager';
import { getTreeForBiome } from './VegetationConfig';
import { ChunkModification } from '@/state/WorldDB';

export class TerrainService {

    // Helper to find surface height at specific world coordinates
    // Now delegates to BiomeManager's parameter system
    static getHeightAt(wx: number, wz: number): number {
        // We use the same logic as the loop, but simplified for single point
        const { baseHeight, amp, freq, warp } = BiomeManager.getTerrainParameters(wx, wz);

        const qx = noise(wx * 0.008, 0, wz * 0.008) * warp;
        const qz = noise(wx * 0.008 + 5.2, 0, wz * 0.008 + 1.3) * warp;

        const px = wx + qx;
        const pz = wz + qz;

        // Base 2D noise for the biome
        const baseNoise = noise(px * 0.01 * freq, 0, pz * 0.01 * freq);

        return baseHeight + (baseNoise * amp);
    }

    static generateChunk(cx: number, cz: number, modifications: ChunkModification[] = []): {
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
                    const wy = (y - PAD) + MESH_Y_OFFSET;
                    const wz = (z - PAD) + worldOffsetZ;

                    const biome = BiomeManager.getBiomeAt(wx, wz);
                    const { baseHeight, amp, freq, warp } = BiomeManager.getTerrainParameters(wx, wz);

                    let d = 0;
                    let surfaceHeight = 0;
                    let isSkyIsland = (biome === 'SKY_ISLANDS');

                    // Initialize overhang to avoid ReferenceError
                    let overhang = 0;

                    if (isSkyIsland) {
                        // --- Sky Archipelago Logic ---
                        const islandCenterY = 40;
                        const islandHeight = 30; // Radius roughly

                        const n3d = noise(wx * 0.05, wy * 0.05, wz * 0.05);
                        // Gradient: 1.0 at center, 0.0 at edges
                        const distY = Math.abs(wy - islandCenterY);
                        const grad = 1.0 - (distY / islandHeight);

                        // If grad is negative, we are far away
                        if (grad < 0) {
                            d = -100;
                        } else {
                            d = n3d + (grad * 2.0) - 1.0;
                        }

                        // Hard bottom limit
                        if (wy < -10) d = -100;

                        // Fake "Surface Height"
                        surfaceHeight = islandCenterY;
                    } else {
                        // --- Standard Terrain Logic ---

                        // Domain Warping
                        const qx = noise(wx * 0.008, 0, wz * 0.008) * warp;
                        const qz = noise(wx * 0.008 + 5.2, 0, wz * 0.008 + 1.3) * warp;

                        const px = wx + qx;
                        const pz = wz + qz;

                        const baseNoise = noise(px * 0.01 * freq, 0, pz * 0.01 * freq);

                        // Add some detail noise
                        const detail = noise(px * 0.05, 0, pz * 0.05) * (amp * 0.1);

                        // Calculate Height
                        surfaceHeight = baseHeight + (baseNoise * amp) + detail;

                        // Cliff/Overhang noise
                        const cliffNoise = noise(wx * 0.06, wy * 0.08, wz * 0.06);
                        overhang = cliffNoise * 6; // Assign to outer variable

                        d = surfaceHeight - wy + overhang;

                        // Caves
                        if (wy < surfaceHeight - 4) {
                            const caveFreq = 0.08;
                            const c1 = noise(wx * caveFreq, wy * caveFreq, wz * caveFreq);
                            if (Math.abs(c1) < 0.12) {
                                d -= 20.0;
                                // Deep cave expansion
                                if (wy < MESH_Y_OFFSET + 8) d -= 6.0;
                            }
                        }

                        // Bedrock
                        if (wy <= MESH_Y_OFFSET) d += 100.0;
                        else if (wy <= MESH_Y_OFFSET + 3) d += 20.0;
                    }

                    // --- AAA FIX: GENERATION HYSTERESIS ---
                    if (Math.abs(d - ISO_LEVEL) < SNAP_EPSILON) {
                        d = (d < ISO_LEVEL)
                            ? ISO_LEVEL - SNAP_EPSILON
                            : ISO_LEVEL + SNAP_EPSILON;
                    }

                    density[idx] = d;

                    // --- Root Hollow Scanning (Skip for Sky Islands) ---
                    if (!isSkyIsland && y > 0 && y < sizeY - 1) {
                        const idxBelow = idx - sizeX;
                        const dBelow = density[idxBelow];
                        if (d <= ISO_LEVEL && dBelow > ISO_LEVEL) {
                            const sparsity = noise(wx * 0.5, wy * 0.5, wz * 0.5);
                            if (sparsity > 0.8 && wy > MESH_Y_OFFSET + 5) { // Ensure not in bedrock
                                const localX = (x - PAD) + 0.5;
                                const localY = wy - 0.8;
                                const localZ = (z - PAD) + 0.5;
                                // Simple up normal for now
                                rootHollowCandidates.push(localX, localY, localZ, 0, 1, 0);
                            }
                        }
                    }

                    // --- 3. Material Generation ---

                    if (d > ISO_LEVEL) { // If solid
                        // --- Lumina Depths Logic (Deep Underground) ---
                        if (wy < -20 && !isSkyIsland) {
                            const vein = noise(wx * 0.1, wy * 0.1, wz * 0.1);
                            if (vein > 0.6) {
                                material[idx] = MaterialType.GLOW_STONE;
                            } else if (vein < -0.6) {
                                material[idx] = MaterialType.OBSIDIAN;
                            } else {
                                material[idx] = MaterialType.STONE;
                            }
                        } else if (isSkyIsland) {
                            material[idx] = MaterialType.STONE;
                            if (noise(wx * 0.1, wy * 0.1, wz * 0.1) > 0.2) material[idx] = MaterialType.GRASS;
                        } else {
                            // --- Standard Surface Biome Materials ---
                            const biomeMat = BiomeManager.getSurfaceMaterial(biome);

                            const soilNoise = noise(wx * 0.1, wy * 0.1, wz * 0.1);
                            const soilDepth = 6.0 + soilNoise * 3.0;
                            const depth = (surfaceHeight + overhang) - wy;

                            if (wy <= MESH_Y_OFFSET + 4) {
                                material[idx] = MaterialType.BEDROCK;
                            } else if (depth > soilDepth) {
                                material[idx] = MaterialType.STONE;
                            } else {
                                if (biomeMat === MaterialType.SAND || biomeMat === MaterialType.RED_SAND) {
                                    material[idx] = biomeMat;
                                    if (depth > 2) material[idx] = (biomeMat === MaterialType.SAND) ? MaterialType.STONE : MaterialType.TERRACOTTA;
                                } else if (biomeMat === MaterialType.SNOW || biomeMat === MaterialType.ICE) {
                                    material[idx] = biomeMat;
                                } else {
                                    if (depth < 1.5) {
                                        material[idx] = biomeMat;
                                    } else {
                                        material[idx] = MaterialType.DIRT;
                                    }
                                }
                            }
                        }
                    } else {
                        // --- Water / Air ---
                        if (wy <= WATER_LEVEL && !isSkyIsland) {
                            if (biome === 'SNOW' || biome === 'ICE_SPIKES') {
                                material[idx] = MaterialType.ICE; // Frozen ocean
                            } else {
                                material[idx] = MaterialType.WATER;
                                wetness[idx] = 255;
                            }
                        } else {
                            material[idx] = MaterialType.AIR;
                        }

                    }
                }
            }
        }

        // --- 3.5 Flora Generation (Post-Pass) ---
        // We do this after density is fully generated so we can scan from top-down
        // to ensure we only place trees on the actual surface (not in caves).

        // We need to check a grid of positions.
        // Since trees are sparse, we can iterate with a step or just check every X/Z.
        // Let's check every coordinate but use noise to decide placement.

        for (let z = 0; z < sizeZ; z++) {
            for (let x = 0; x < sizeX; x++) {
                const wx = (x - PAD) + worldOffsetX;
                const wz = (z - PAD) + worldOffsetZ;

                // Check biome for tree density/chance first to avoid unnecessary scans
                const biome = BiomeManager.getBiomeAt(wx, wz);

                // Optimization: Quick noise check before scanning height
                const nFlora = noise(wx * 0.12, 0, wz * 0.12); // 2D noise for distribution

                let treeThreshold = 0.6; // Default increased density (was 0.7)
                if (biome === 'JUNGLE') {
                    treeThreshold = 0.3; // Much higher density for Jungle
                } else if (biome === 'DESERT' || biome === 'RED_DESERT' || biome === 'ICE_SPIKES') {
                    treeThreshold = 0.98; // Very sparse
                } else if (biome === 'SAVANNA') {
                    treeThreshold = 0.8;
                }

                if (nFlora > treeThreshold) {
                    // Potential tree spot. Now find the surface.
                    let surfaceY = -1;

                    // Scan from top down
                    for (let y = sizeY - 2; y >= 0; y--) {
                        const idx = x + y * sizeX + z * sizeX * sizeY;
                        const d = density[idx];
                        if (d > ISO_LEVEL) {
                            // Found surface
                            // Check if it's not bedrock/too low
                            const wy = (y - PAD) + MESH_Y_OFFSET;
                            if (wy > MESH_Y_OFFSET + 5) {
                                surfaceY = y;

                                // Interpolate
                                const idxAbove = x + (y + 1) * sizeX + z * sizeX * sizeY;
                                const dAbove = density[idxAbove];
                                const t = (ISO_LEVEL - d) / (dAbove - d);
                                surfaceY += t;
                            }
                            break; // Stop at first surface (highest)
                        }
                    }

                    if (surfaceY !== -1) {
                        const wy = (surfaceY - PAD) + MESH_Y_OFFSET;
                        const hash = Math.abs(noise(wx * 12.3, wy * 12.3, wz * 12.3));
                        const treeType = getTreeForBiome(biome, hash) || 0;

                        floraCandidates.push(
                            (x - PAD) + (hash * 0.4 - 0.2),
                            wy - 0.2, // Slight sink
                            (z - PAD) + (hash * 0.4 - 0.2),
                            treeType
                        );
                    }
                }
            }
        }

        // --- 4. Apply Persistence Modifications ---
        if (modifications && modifications.length > 0) {
            for (const mod of modifications) {
                if (mod.voxelIndex >= 0 && mod.voxelIndex < density.length) {
                    density[mod.voxelIndex] = mod.density;
                    material[mod.voxelIndex] = mod.material;
                }
            }
        }

        const metadata: ChunkMetadata = {
            wetness,
            mossiness
        };

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
                        const falloff = Math.pow(1.0 - t, 3);
                        const strength = falloff * delta;
                        const oldDensity = density[idx];

                        density[idx] += strength;

                        if (Math.abs(density[idx] - ISO_LEVEL) < SNAP_EPSILON) {
                            density[idx] = (delta < 0) ? ISO_LEVEL - SNAP_EPSILON : ISO_LEVEL + SNAP_EPSILON;
                        }

                        if (delta > 0 && density[idx] > ISO_LEVEL) {
                            if (oldDensity <= ISO_LEVEL) {
                                materialData[idx] = brushMaterial;
                            }
                        }
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
