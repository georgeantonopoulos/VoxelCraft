
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, ISO_LEVEL, MESH_Y_OFFSET, SNAP_EPSILON } from '@/constants';
import { noise as noise3D } from '@core/math/noise';
import { MaterialType, ChunkMetadata } from '@/types';
import { BiomeManager, BiomeType, getCaveSettings } from './BiomeManager';

export const MATERIAL_HARDNESS: Record<number, number> = {
    [MaterialType.DIRT]: 1.0,
    [MaterialType.GRASS]: 1.0,
    [MaterialType.SAND]: 1.0,
    [MaterialType.RED_SAND]: 1.0,
    [MaterialType.CLAY]: 0.8,
    [MaterialType.MOSSY_STONE]: 0.4,
    [MaterialType.STONE]: 0.3,
    [MaterialType.TERRACOTTA]: 0.3,
    [MaterialType.OBSIDIAN]: 0.1,
    [MaterialType.GLOW_STONE]: 0.2,
    [MaterialType.BEDROCK]: 0.0,
    [MaterialType.SNOW]: 0.8,
    [MaterialType.ICE]: 0.5,
    [MaterialType.JUNGLE_GRASS]: 1.0,
    [MaterialType.WATER]: 1.0,
    [MaterialType.AIR]: 1.0
};
import { getTreeForBiome } from './VegetationConfig';
import { ChunkModification } from '@/state/WorldDB';

// Helper to find surface height at specific world coordinates
// Helper to find surface height at specific world coordinates
// Returns a Signed Distance Field (SDF) approximation
// Negative = Inside Cave (Air), Positive = Outside Cave (Solid)
function getCavernModifier(wx: number, wy: number, wz: number, biomeId: string): number {
    const settings = getCaveSettings(biomeId);

    // Warp and Noise calculation
    const warpStrength = 4.0;
    const warpX = wx + noise3D(wx * 0.01, wy * 0.01, wz * 0.01) * warpStrength;
    const warpZ = wz + noise3D(wx * 0.01 + 100, wy * 0.01, wz * 0.01) * warpStrength;

    // Tube Algorithm: Sample two independent noise fields
    const noiseA = noise3D(
        warpX * settings.scale,
        wy * settings.scale * 1.5 * settings.frequency,
        warpZ * settings.scale
    );

    const noiseB = noise3D(
        (warpX + 123.45) * settings.scale,
        (wy + 123.45) * settings.scale * 1.5 * settings.frequency,
        (warpZ + 123.45) * settings.scale
    );

    // Calculate distance from "center" of the tube
    const tunnelVal = Math.sqrt(noiseA * noiseA + noiseB * noiseB);

    // SDF Conversion:
    // (val - threshold) is negative inside, positive outside.
    // We multiply by a factor (e.g., 50.0) to convert "noise units" to "density units".
    // This creates a smooth gradient across the cave wall.
    return (tunnelVal - settings.threshold) * 50.0;
}

export class TerrainService {

    // Helper to find surface height at specific world coordinates
    // Now delegates to BiomeManager's parameter system
    static getHeightAt(wx: number, wz: number): number {
        // We use the same logic as the loop, but simplified for single point
        const { baseHeight, amp, freq, warp } = BiomeManager.getTerrainParameters(wx, wz);

        const qx = noise3D(wx * 0.008, 0, wz * 0.008) * warp;
        const qz = noise3D(wx * 0.008 + 5.2, 0, wz * 0.008 + 1.3) * warp;

        const px = wx + qx;
        const pz = wz + qz;

        // Base 2D noise for the biome
        const baseNoise = noise3D(px * 0.01 * freq, 0, pz * 0.01 * freq);

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

                        const n3d = noise3D(wx * 0.05, wy * 0.05, wz * 0.05);
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
                        const qx = noise3D(wx * 0.008, 0, wz * 0.008) * warp;
                        const qz = noise3D(wx * 0.008 + 5.2, 0, wz * 0.008 + 1.3) * warp;

                        const px = wx + qx;
                        const pz = wz + qz;

                        const baseNoise = noise3D(px * 0.01 * freq, 0, pz * 0.01 * freq);

                        // Add some detail noise
                        const detail = noise3D(px * 0.05, 0, pz * 0.05) * (amp * 0.1);

                        // Calculate Height
                        surfaceHeight = baseHeight + (baseNoise * amp) + detail;

                        // Cliff/Overhang noise
                        const cliffNoise = noise3D(wx * 0.06, wy * 0.08, wz * 0.06);
                        overhang = cliffNoise * 6; // Assign to outer variable

                        d = surfaceHeight - wy + overhang;

                        // --- NEW CAVE LOGIC (SDF) ---
                        const caveMod = getCavernModifier(wx, wy, wz, biome);

                        // Congruent Breach Logic
                        const settings = getCaveSettings(biome);
                        const breachNoise = noise3D(wx * 0.005, 0, wz * 0.005);
                        const normBreach = (breachNoise + 1) * 0.5;

                        let crustThickness = 4.0;
                        const isSteep = (cliffNoise > 0.4);
                        const isBreachZone = (normBreach < settings.surfaceBreachChance);

                        if (isSteep || isBreachZone) {
                            crustThickness = 0.5;
                        }

                        // SDF BLENDING:
                        // Only apply cave if we are below the crust (d > crustThickness).
                        // We use Math.min(d, caveMod) to carve.
                        // Since caveMod is negative inside the cave, it will pull the density down.
                        if (d > crustThickness) {
                            // Smooth union (min) of terrain and cave
                            d = Math.min(d, caveMod);
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
                    // AAA FIX: Only spawn in THE_GROVE, on flat terrain, and near surface (not caves)
                    if (!isSkyIsland && y > 0 && y < sizeY - 1 && biome === 'THE_GROVE') {
                        const idxBelow = idx - sizeX;
                        const dBelow = density[idxBelow];

                        if (d <= ISO_LEVEL && dBelow > ISO_LEVEL) {
                            // 1. Surface Check: Ensure we are close to the calculated surface height 
                            // (avoids spawning in deep caves or bubbles)
                            if (Math.abs(wy - surfaceHeight) > 4.0) continue;

                            // 2. Flatness Check: Avoid cliffs
                            // Re-calculate cliffNoise if needed, or use 'overhang' proxy? 
                            // We have 'overhang' from line 150. overhang = cliffNoise * 6.
                            // If overhang is high, it's a cliff or steep area.
                            // cliffNoise > 0.4 is considered steep in line 163.
                            // Let's use a strict threshold for stumps.
                            if (Math.abs(overhang) > 1.5) continue;

                            const sparsity = noise3D(wx * 0.5, wy * 0.5, wz * 0.5);
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
                        // AAA FEATURE: "Lumina Depths" - Obsidian & Glowstone Caverns
                        if (wy < -20 && !isSkyIsland) {
                            // 3D Noise for large obsidian structures
                            const luminaNoise = noise3D(wx * 0.05, wy * 0.05, wz * 0.05);
                            const veinNoise = noise3D(wx * 0.15, wy * 0.15, wz * 0.15);

                            if (luminaNoise > 0.0) {
                                // Primary Lumina Material: Obsidian
                                material[idx] = MaterialType.OBSIDIAN;

                                // Veins of Glowstone
                                if (veinNoise > 0.6) {
                                    material[idx] = MaterialType.GLOW_STONE;
                                }
                            } else {
                                // Transition zone / fallback to standard dark stone or bedrock if very deep
                                if (wy < -40) material[idx] = MaterialType.BEDROCK;
                                else material[idx] = MaterialType.STONE;
                            }

                        } else if (isSkyIsland) {
                            material[idx] = MaterialType.STONE;
                            if (noise3D(wx * 0.1, wy * 0.1, wz * 0.1) > 0.2) material[idx] = MaterialType.GRASS;
                        } else {
                            // --- Standard Surface & Cavern Materials ---
                            const biomeMat = BiomeManager.getSurfaceMaterial(biome);

                            const soilNoise = noise3D(wx * 0.1, wy * 0.1, wz * 0.1);
                            const soilDepth = 6.0 + soilNoise * 3.0; // depth of surface soil
                            const depth = (surfaceHeight + overhang) - wy;

                            if (wy <= MESH_Y_OFFSET + 4) {
                                material[idx] = MaterialType.BEDROCK;
                            } else if (depth > soilDepth) {
                                // --- UNDERGROUND / CAVERN WALLS ---
                                // AAA FEATURE: Biome-Specific Caverns
                                const { primary, secondary } = BiomeManager.getUndergroundMaterials(biome);

                                // Mix primary and secondary materials
                                const matNoise = noise3D(wx * 0.08, wy * 0.08, wz * 0.08);
                                if (matNoise > 0.4) {
                                    material[idx] = secondary;
                                } else {
                                    material[idx] = primary;
                                }

                            } else {
                                // --- SURFACE SOIL ---
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
        // Place flora in Lumina Depths (deep underground) on restricted materials.
        const cavernMinWorldY = -40; // Bottom of chunk
        const cavernMaxWorldY = -20; // Start of Lumina Depths
        const cavernMinY = Math.max(1, Math.floor(cavernMinWorldY - MESH_Y_OFFSET + PAD));
        const cavernMaxY = Math.min(sizeY - 3, Math.ceil(cavernMaxWorldY - MESH_Y_OFFSET + PAD));
        const maxFloraPerChunk = 60;
        let floraPlaced = 0;

        // RELAXED STEP: Use a finer grid (3) to find more spots
        for (let z = 0; z < sizeZ && floraPlaced < maxFloraPerChunk; z += 3) {
            for (let x = 0; x < sizeX && floraPlaced < maxFloraPerChunk; x += 3) {
                const wx = (x - PAD) + worldOffsetX;
                const wz = (z - PAD) + worldOffsetZ;

                const biome = BiomeManager.getBiomeAt(wx, wz);
                // Skip barren biomes for cavern flora logic if needed, but deep underground biome might be less relevant?
                // Keeping check for now as optimization.
                if (biome === 'DESERT' || biome === 'RED_DESERT' || biome === 'ICE_SPIKES') continue;

                // Low frequency noise to pick cluster centers
                // Lower threshold (0.55) to allow more clusters
                const clusterNoise = noise3D(wx * 0.15, 0, wz * 0.15);
                if (clusterNoise < 0.55) continue;

                // Find a cavern floor within the target band (air with solid below and headroom above)
                let centerFloorWy = Number.NEGATIVE_INFINITY;
                let foundCenter = false;
                let centerYIndex = -1;

                for (let y = cavernMaxY; y >= cavernMinY; y--) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    const idxBelow = idx - sizeX;
                    const idxAbove = idx + sizeX;
                    const idxAbove2 = idx + sizeX * 2;

                    if (idxAbove2 >= density.length || idxBelow < 0) continue;

                    if (density[idx] <= ISO_LEVEL && density[idxBelow] > ISO_LEVEL && density[idxAbove] <= ISO_LEVEL && density[idxAbove2] <= ISO_LEVEL) {
                        // Strict Material Check for Center Finding
                        // We only want to start clusters on correct materials
                        const matBelow = material[idxBelow];
                        if (matBelow === MaterialType.GLOW_STONE || matBelow === MaterialType.OBSIDIAN) {
                            // Interpolate for smoother placement on the floor
                            const dAir = density[idx];
                            const dSolid = density[idxBelow];
                            const t = (ISO_LEVEL - dSolid) / (dAir - dSolid);
                            centerFloorWy = (y - PAD - 1 + t) + MESH_Y_OFFSET;
                            centerYIndex = y;
                            foundCenter = true;
                            break;
                        }
                    }
                }

                if (!foundCenter) continue;

                const seed = Math.abs(noise3D(wx * 1.31, centerFloorWy * 0.77, wz * 1.91));
                const clusterCount = 4 + Math.floor(seed * 5); // 4..8 per cluster
                const spread = 3.0 + seed * 2.0; // Wider spread

                for (let i = 0; i < clusterCount && floraPlaced < maxFloraPerChunk; i++) {
                    const angle = seed * 12.9898 + i * 1.3;
                    const r = spread * (0.3 + ((i + 1) / (clusterCount + 1))); // Don't start at 0
                    const offX = Math.sin(angle) * r;
                    const offZ = Math.cos(angle) * r;

                    const candLocalX = x + offX;
                    const candLocalZ = z + offZ;

                    // Bounds check
                    if (candLocalX < 0 || candLocalX >= sizeX || candLocalZ < 0 || candLocalZ >= sizeZ) continue;

                    // SNAP TO GROUND: Raycast at the candidate position
                    // We search around the center Y index +/- 3 blocks to handle slopes
                    let flowerY = Number.NEGATIVE_INFINITY;
                    let foundGround = false;

                    const ix = Math.floor(candLocalX);
                    const iz = Math.floor(candLocalZ);

                    const searchRange = 5; // Increased range to find ground on slopes
                    const startY = Math.min(sizeY - 2, centerYIndex + searchRange);
                    const endY = Math.max(1, centerYIndex - searchRange);

                    for (let fy = startY; fy >= endY; fy--) {
                        const idx = ix + fy * sizeX + iz * sizeX * sizeY;
                        const idxBelow = idx - sizeX;

                        // Simple check: Air above, Solid below
                        if (density[idx] <= ISO_LEVEL && density[idxBelow] > ISO_LEVEL) {
                            // STRICT MATERIAL CHECK FOR INDIVIDUAL FLORA
                            const matBelow = material[idxBelow];
                            if (matBelow === MaterialType.GLOW_STONE || matBelow === MaterialType.OBSIDIAN) {
                                const dAir = density[idx];
                                const dSolid = density[idxBelow];
                                const t = (ISO_LEVEL - dSolid) / (dAir - dSolid);
                                flowerY = (fy - PAD - 1 + t) + MESH_Y_OFFSET;
                                foundGround = true;
                                break;
                            }
                        }
                    }

                    if (foundGround) {
                        floraCandidates.push(
                            (candLocalX - PAD) + worldOffsetX,
                            flowerY - 0.1, // Sink slightly into ground to avoid floating
                            (candLocalZ - PAD) + worldOffsetZ,
                            0
                        );
                        floraPlaced++;
                    }
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
                const cellHash = Math.abs(noise3D(cellWx * 0.13, 0, cellWz * 0.13));

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
                const nFlora = noise3D(wx * 0.12, 0, wz * 0.12); // 2D noise for distribution

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
                        const hash = Math.abs(noise3D(wx * 12.3, wy * 12.3, wz * 12.3));
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
        brushMaterial: MaterialType = MaterialType.DIRT,
        cx: number = 0, // World Chunk coords for noise consistency
        cz: number = 0
    ): boolean {
        const sizeX = TOTAL_SIZE_XZ;
        const sizeY = TOTAL_SIZE_Y;
        const sizeZ = TOTAL_SIZE_XZ;

        const hx = localPoint.x + PAD;
        const hy = localPoint.y - MESH_Y_OFFSET + PAD;
        const hz = localPoint.z + PAD;

        const rSq = radius * radius;
        // Optimization: Pre-calculate world offset
        const worldOffsetX = cx * CHUNK_SIZE_XZ - PAD; // -PAD because loop x includes PAD
        const worldOffsetZ = cz * CHUNK_SIZE_XZ - PAD;

        const iRad = Math.ceil(radius + 1.0); // Slightly larger for noise
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
                    let distSq = dx * dx + dy * dy + dz * dz;

                    // --- NOISE JITTER ---
                    // "Chipped" look for digging
                    if (delta < 0) { // Only when digging
                        const wx = x + worldOffsetX;
                        const wy = y - PAD + MESH_Y_OFFSET;
                        const wz = z + worldOffsetZ;
                        const jitter = noise3D(wx * 0.8, wy * 0.8, wz * 0.8) * 0.3; // +/- 0.3 units
                        // Effectively modifies the distance check
                        // If jitter is positive, we think we are closer (digs more).
                        // If negative, we think we are further (digs less).
                        // We apply it to the distance check threshold, or modify distSq?
                        // Modifying radius check is easier:
                        // dist < radius + jitter
                        // But here we rely on distSq.
                        // Let's modify the calculated distance
                        const dist = Math.sqrt(distSq);
                        const effectiveDist = dist - jitter; // "Rough" distance
                        // Overwrite distSq with effective squared (approx)
                        // Or just use effectiveDist for the check
                        if (effectiveDist < radius) {
                            distSq = effectiveDist * effectiveDist; // Update for falloff calc
                        } else {
                            continue; // Skip
                        }
                    } else if (distSq >= rSq) {
                        continue;
                    }

                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    const dist = Math.sqrt(distSq);
                    const t = dist / radius;
                    const falloff = Math.pow(1.0 - t, 3);

                    // --- HARDNESS LOGIC ---
                    let hardness = 1.0;
                    if (delta < 0) { // Only apply hardness when digging
                        const mat = materialData[idx];
                        hardness = MATERIAL_HARDNESS[mat] ?? 1.0;
                        // Min impact so play still feels *some* response
                        if (hardness < 0.1 && hardness > 0) hardness = 0.1;
                    }

                    const strength = falloff * delta * hardness;
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
        return modified;
    }
}
