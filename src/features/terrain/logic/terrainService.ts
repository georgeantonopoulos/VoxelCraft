
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
        floraPositions: Float32Array, // Lumina flora (collectibles) in caverns
        treePositions: Float32Array,  // Surface trees
        rootHollowPositions: Float32Array
    } {
        const sizeX = TOTAL_SIZE_XZ;
        const sizeY = TOTAL_SIZE_Y;
        const sizeZ = TOTAL_SIZE_XZ;

        const density = new Float32Array(sizeX * sizeY * sizeZ);
        const material = new Uint8Array(sizeX * sizeY * sizeZ);
        const wetness = new Uint8Array(sizeX * sizeY * sizeZ);
        const mossiness = new Uint8Array(sizeX * sizeY * sizeZ);
        const floraCandidates: number[] = []; // Cavern lumina flora
        const treeCandidates: number[] = [];  // Surface trees
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
        // Place flora in shallow caverns (world Y: -3..0) and cluster them for readability.
        const cavernMinWorldY = -3;
        const cavernMaxWorldY = 0;
        const cavernMinY = Math.max(1, Math.floor(cavernMinWorldY - MESH_Y_OFFSET + PAD));
        const cavernMaxY = Math.min(sizeY - 3, Math.ceil(cavernMaxWorldY - MESH_Y_OFFSET + PAD)); // leave headroom checks
        const maxFloraPerChunk = 40; // lower cap to avoid perf spikes
        let floraPlaced = 0;

        for (let z = 0; z < sizeZ && floraPlaced < maxFloraPerChunk; z += 2) {
            for (let x = 0; x < sizeX && floraPlaced < maxFloraPerChunk; x += 2) {
                const wx = (x - PAD) + worldOffsetX;
                const wz = (z - PAD) + worldOffsetZ;

                const biome = BiomeManager.getBiomeAt(wx, wz);
                // Skip barren biomes for cavern flora
                if (biome === 'DESERT' || biome === 'RED_DESERT' || biome === 'ICE_SPIKES') continue;

                // Low frequency noise to pick cluster centers
                const clusterNoise = noise(wx * 0.07, 0, wz * 0.07);
                if (clusterNoise < 0.55) continue;

                // Find a cavern floor within the target band (air with solid below and headroom above)
                let floorWy = Number.NEGATIVE_INFINITY;
                let found = false;

                for (let y = cavernMaxY; y >= cavernMinY; y--) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    const idxBelow = idx - sizeX;
                    const idxAbove = idx + sizeX;
                    const idxAbove2 = idx + sizeX * 2;

                    if (idxAbove2 >= density.length || idxBelow < 0) continue;

                    if (density[idx] <= ISO_LEVEL && density[idxBelow] > ISO_LEVEL && density[idxAbove] <= ISO_LEVEL && density[idxAbove2] <= ISO_LEVEL) {
                        // Interpolate for smoother placement on the floor
                        const dAir = density[idx];
                        const dSolid = density[idxBelow];
                        const t = (ISO_LEVEL - dAir) / (dSolid - dAir);
                        floorWy = (y - PAD - 1 + t) + MESH_Y_OFFSET;
                        found = true;
                        break;
                    }
                }

                if (!found) continue;

                const seed = Math.abs(noise(wx * 1.31, floorWy * 0.77, wz * 1.91));
                const clusterCount = 3 + Math.floor(seed * 4); // 3..6 per cluster
                const spread = 2.2 + seed * 1.2;

                for (let i = 0; i < clusterCount && floraPlaced < maxFloraPerChunk; i++) {
                    const angle = seed * 12.9898 + i * 1.3;
                    const r = spread * (0.4 + ((i + 1) / (clusterCount + 1)));
                    const offX = Math.sin(angle) * r;
                    const offZ = Math.cos(angle) * r;

                    floraCandidates.push(
                        (x - PAD) + offX,
                        floorWy + 0.15,
                        (z - PAD) + offZ,
                        0 // type placeholder for lumina flora (could encode rarity later)
                    );
                    floraPlaced++;
                }
            }
        }

        // --- 3.6 Tree Generation (Surface Pass) ---
        // Restores original surface tree placement (separate from lumina flora).
        // AAA FIX: Use Jittered Grid Sampling to prevent clumping
        const GRID_SIZE = 4; // 4x4 voxel cells

        for (let z = 0; z < sizeZ; z += GRID_SIZE) {
            for (let x = 0; x < sizeX; x += GRID_SIZE) {
                // Calculate grid cell origin in world space
                const cellWx = (x - PAD) + worldOffsetX;
                const cellWz = (z - PAD) + worldOffsetZ;

                // Hash for this cell to pick a random spot within it
                const cellHash = Math.abs(noise(cellWx * 0.13, 0, cellWz * 0.13));

                // Pick a random offset within the cell (0..GRID_SIZE)
                const offX = (cellHash * 12.9898) % GRID_SIZE;
                const offZ = (cellHash * 78.233) % GRID_SIZE;

                const localX = x + offX;
                const localZ = z + offZ;

                if (localX >= sizeX || localZ >= sizeZ) continue;

                const wx = (localX - PAD) + worldOffsetX;
                const wz = (localZ - PAD) + worldOffsetZ;

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
                        const idx = Math.floor(localX) + y * sizeX + Math.floor(localZ) * sizeX * sizeY;
                        const d = density[idx];
                        if (d > ISO_LEVEL) {
                            // Found surface
                            // Check if it's not bedrock/too low
                            const wy = (y - PAD) + MESH_Y_OFFSET;
                            if (wy > MESH_Y_OFFSET + 5) {
                                surfaceY = y;

                                // Interpolate
                                const idxAbove = Math.floor(localX) + (y + 1) * sizeX + Math.floor(localZ) * sizeX * sizeY;
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

                        treeCandidates.push(
                            (localX - PAD) + (hash * 0.4 - 0.2),
                            wy - 0.2, // Slight sink
                            (localZ - PAD) + (hash * 0.4 - 0.2),
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
            treePositions: new Float32Array(treeCandidates),
            rootHollowPositions: new Float32Array(rootHollowCandidates)
        };
    }

    // Helper to cluster lights for performance (run in worker)
    static computeLightClusters(floraPositions: Float32Array): Float32Array {
        const positions: number[] = [];
        const CLUSTER_RADIUS_SQ = 5.0 * 5.0;

        for (let i = 0; i < floraPositions.length; i += 4) {
            const x = floraPositions[i];
            const y = floraPositions[i + 1];
            const z = floraPositions[i + 2];

            // Check if close to any existing light
            let found = false;
            // Iterate backwards for better locality? No, simple scan is fine for < 50 lights
            for (let j = 0; j < positions.length; j += 3) {
                const lx = positions[j];
                const ly = positions[j + 1];
                const lz = positions[j + 2];
                const distSq = (x - lx) ** 2 + (y - ly) ** 2 + (z - lz) ** 2;

                if (distSq < CLUSTER_RADIUS_SQ) {
                    found = true;
                    break;
                }
            }

            if (!found) {
                // Add new light center (slightly raised)
                positions.push(x, y + 1.5, z);
            }
        }
        return new Float32Array(positions);
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
