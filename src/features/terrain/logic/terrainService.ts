
import { CHUNK_SIZE_XZ, CHUNK_SIZE_Y, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, ISO_LEVEL, MESH_Y_OFFSET, SNAP_EPSILON } from '@/constants';
import { noise as noise3D } from '@core/math/noise';
import { MaterialType, ChunkMetadata } from '@/types';
import { BiomeManager, BiomeType, getCaveSettings } from './BiomeManager';
import { RockVariant } from './GroundItemKinds';

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

// The world currently uses a single vertical chunk stack. If the computed surface height goes
// above the top of the chunk volume, the column can become "all solid" and the surface won't
// be extracted by the mesher. Keep a small margin for overhang noise near the surface.
const MAX_SURFACE_Y = MESH_Y_OFFSET + (CHUNK_SIZE_Y - 1) - 7; // topVisible(=offset+127) minus ~max overhang
function clampSurfaceHeight(h: number): number {
    return Math.min(h, MAX_SURFACE_Y);
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

        return clampSurfaceHeight(baseHeight + (baseNoise * amp));
    }

    static generateChunk(cx: number, cz: number, modifications: ChunkModification[] = []): {
        density: Float32Array,
        material: Uint8Array,
        metadata: ChunkMetadata,
        floraPositions: Float32Array, // Lumina flora (collectibles) in caverns
        treePositions: Float32Array,  // Surface trees
        stickPositions: Float32Array, // Surface sticks (collectibles) near trees
        rockPositions: Float32Array,  // Stones (collectibles) on ground (surface/caves)
        largeRockPositions: Float32Array, // Large rocks (non-pickup) with collision
        rootHollowPositions: Float32Array,
        fireflyPositions: Float32Array // Ambient fireflies (surface swarms)
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
        const stickCandidates: number[] = []; // Surface sticks (collectible)
        const rockCandidates: number[] = []; // Stones (collectible)
        const largeRockCandidates: number[] = []; // Large rocks (non-pickup)
        const rootHollowCandidates: number[] = [];
        const fireflyCandidates: number[] = []; // Surface firefly motes (clustered swarms)

        const worldOffsetX = cx * CHUNK_SIZE_XZ;
        const worldOffsetZ = cz * CHUNK_SIZE_XZ;

        // NOTE: Avoid large generation-time hysteresis around ISO_LEVEL.
        // A big band can move the surface differently per chunk and create real cracks at borders.
        // If we need to avoid exact-ISO degenerates, use a tiny deterministic nudge instead.
        const ISO_NUDGE = 0.0001;

        for (let z = 0; z < sizeZ; z++) {
            for (let x = 0; x < sizeX; x++) {
                // Column Setup
                const wx = (x - PAD) + worldOffsetX;
                const wz = (z - PAD) + worldOffsetZ;

                // 1. Get Climate & Terrain Params (Column-Constant)
                const climate = BiomeManager.getClimate(wx, wz);

                // Use new metrics-based params (includes Continentalness/Erosion logic)
                const { baseHeight, amp, freq, warp } = BiomeManager.getTerrainParametersFromMetrics(
                    climate.temp,
                    climate.humid,
                    climate.continent,
                    climate.erosion
                );

                for (let y = 0; y < sizeY; y++) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    const wy = (y - PAD) + MESH_Y_OFFSET;

                    // AAA FIX: Value-Based Biome Dithering
                    // Dither varies with Y to hide transition seams in 3D
                    const DITHER_AMP = 0.05;
                    const ditherNoise = noise3D(wx * 0.1, wy * 0.1, wz * 0.1);

                    const ditheredTemp = climate.temp + ditherNoise * DITHER_AMP;
                    const ditheredHumid = climate.humid + ditherNoise * DITHER_AMP;

                    // IMPORTANT:
                    // Biome selection must include continentalness/erosion intercepts (e.g. BEACH),
                    // otherwise shoreline materials never switch to sand.
                    // We keep the existing Y-dithered temp/humid for 3D seam hiding, while using
                    // column-constant continent/erosion to keep coastlines coherent.
                    const biome = BiomeManager.getBiomeFromMetrics(
                        ditheredTemp,
                        ditheredHumid,
                        climate.continent,
                        climate.erosion
                    );

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
                        surfaceHeight = clampSurfaceHeight(baseHeight + (baseNoise * amp) + detail);

                        // Cliff/Overhang noise
                        const cliffNoise = noise3D(wx * 0.06, wy * 0.08, wz * 0.06);
                        overhang = cliffNoise * 6; // Assign to outer variable

                        d = surfaceHeight - wy + overhang;

                        // --- NEW CAVE LOGIC (SDF) ---
                        // Only calc caves if we are somewhat near ground or deep?
                        // Optimization: Skip cave calc if d is huge (sky) or tiny (deep underground bedrock)?
                        // No, deep underground needs caves.
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
                        if (d > crustThickness) {
                            d = Math.min(d, caveMod);
                        }

                        // Bedrock
                        if (wy <= MESH_Y_OFFSET) d += 100.0;
                        else if (wy <= MESH_Y_OFFSET + 3) d += 20.0;
                    }

                    // --- GEN HYSTERESIS ---
                    // Keep the SDF continuous across chunks. Use a tiny deterministic nudge so both
                    // sides of a chunk border make the same decision for the same (wx,wy,wz).
                    if (Math.abs(d - ISO_LEVEL) < ISO_NUDGE) {
                        // Integer-ish hash (deterministic, cheap, stable across workers)
                        const seed = ((wx * 73856093) ^ (wy * 19349663) ^ (wz * 83492791)) | 0;
                        d = ISO_LEVEL + ((seed & 1) === 0 ? -ISO_NUDGE : ISO_NUDGE);
                    }

                    density[idx] = d;

                    // --- Root Hollow Scanning (Skip for Sky Islands) ---
                    // AAA FIX: Only spawn in THE_GROVE, on flat terrain, and near surface (not caves)
                    if (!isSkyIsland && y > 0 && y < sizeY - 1 && biome === 'THE_GROVE') {
                        const idxBelow = idx - sizeX; // Note: idx formula assumes consistent iteration structure, but here we just subtract sizeX (X-stride).
                        // Wait! idx = x + y*SizeX + ...
                        // If y decreases by 1, idx decreases by SizeX. Correct.
                        const dBelow = density[idxBelow];

                        if (d <= ISO_LEVEL && dBelow > ISO_LEVEL) {
                            // 1. Surface Check
                            if (Math.abs(wy - surfaceHeight) > 4.0) continue;

                            // 2. Flatness Check
                            if (Math.abs(overhang) > 1.5) continue;

                            const sparsity = noise3D(wx * 0.5, wy * 0.5, wz * 0.5);
                            if (sparsity > 0.8 && wy > MESH_Y_OFFSET + 5) {
                                const localX = (x - PAD) + 0.5;
                                const localY = wy - 0.8;
                                const localZ = (z - PAD) + 0.5;
                                rootHollowCandidates.push(localX, localY, localZ, 0, 1, 0);
                            }
                        }
                    }

                    // --- 3. Material Generation ---

                    if (d > ISO_LEVEL) { // If solid
                        // --- Lumina Depths Logic (Deep Underground) ---
                        // Only applies if we are deep relative to the world AND deep relative to the local surface
                        const depthFromSurface = (surfaceHeight + overhang) - wy;

                        if (wy < -20 && !isSkyIsland && depthFromSurface > 15.0) {
                            const luminaNoise = noise3D(wx * 0.05, wy * 0.05, wz * 0.05);
                            const veinNoise = noise3D(wx * 0.15, wy * 0.15, wz * 0.15);

                            // FIX: Ensure bedrock exists at the bottom even in Lumina Depths
                            if (wy <= MESH_Y_OFFSET + 4) {
                                material[idx] = MaterialType.BEDROCK;
                            } else if (luminaNoise > 0.0) {
                                material[idx] = MaterialType.OBSIDIAN;
                                if (veinNoise > 0.6) {
                                    material[idx] = MaterialType.GLOW_STONE;
                                }
                            } else {
                                material[idx] = MaterialType.STONE;
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
                                const { primary, secondary } = BiomeManager.getUndergroundMaterials(biome);
                                const matNoise = noise3D(wx * 0.08, wy * 0.08, wz * 0.08);
                                if (matNoise > 0.4) {
                                    material[idx] = secondary;
                                } else {
                                    material[idx] = primary;
                                }

                            } else {
                                // --- SURFACE SOIL ---
                                if (biome === 'BEACH') {
                                    // Beaches need a thicker sand cap than deserts for smooth meshing:
                                    // material weights are neighborhood-splatted, so a 1-2 voxel cap often
                                    // blends away into dirt/stone and becomes visually "green" at the shore.
                                    const sandDepth = 6.0 + soilNoise * 2.0; // 6..8 voxels
                                    material[idx] = MaterialType.SAND;
                                    if (depth > sandDepth) material[idx] = MaterialType.STONE;
                                } else if (biomeMat === MaterialType.SAND || biomeMat === MaterialType.RED_SAND) {
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
                        // --- Air (Water is filled in a post-pass) ---
                        // IMPORTANT:
                        // We avoid "fill every air voxel below sea level" here because it floods sealed caves.
                        // Instead, we place sea-level water in a post-pass that only fills columns that are
                        // vertically open to the sky at sea level.
                        material[idx] = MaterialType.AIR;

                    }
                }
            }
        }

        // --- 3.25 Sea-level water fill (Post-Pass) ---
        // Fill only columns that are open to the sky at sea level to avoid flooding sealed caves.
        // This is an intentionally simple rule for V1 (no dynamic fluid sim yet).
        //
        // Grid worldY = (yIndex - PAD) + MESH_Y_OFFSET  =>  yIndex = worldY - MESH_Y_OFFSET + PAD.
        const seaGridYRaw = Math.floor(WATER_LEVEL - MESH_Y_OFFSET) + PAD;
        const seaGridY = Math.max(PAD, Math.min(sizeY - PAD - 2, seaGridYRaw));

        for (let z = PAD; z < PAD + CHUNK_SIZE_XZ; z++) {
            for (let x = PAD; x < PAD + CHUNK_SIZE_XZ; x++) {
                const wx = (x - PAD) + worldOffsetX;
                const wz = (z - PAD) + worldOffsetZ;

                // No oceans for sky islands.
                const columnBiome = BiomeManager.getBiomeAt(wx, wz);
                if (columnBiome === 'SKY_ISLANDS') continue;

                const waterMat = (columnBiome === 'SNOW' || columnBiome === 'ICE_SPIKES')
                    ? MaterialType.ICE
                    : MaterialType.WATER;

                // 1) Must be vertically open to the sky above sea level (prevents flooding under overhangs).
                let skyVisible = true;
                for (let y = sizeY - PAD - 1; y > seaGridY; y--) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    if (density[idx] > ISO_LEVEL) {
                        skyVisible = false;
                        break;
                    }
                }
                if (!skyVisible) continue;

                // 2) Find the top-most solid at/below sea level.
                let topSolidY = -1;
                for (let y = seaGridY; y >= PAD; y--) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    if (density[idx] > ISO_LEVEL) {
                        topSolidY = y;
                        break;
                    }
                }
                if (topSolidY < 0) continue;

                // 3) Fill air from just above the surface up to sea level.
                for (let y = topSolidY + 1; y <= seaGridY; y++) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    if (density[idx] <= ISO_LEVEL && material[idx] === MaterialType.AIR) {
                        material[idx] = waterMat;
                        wetness[idx] = 255;
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

                // Removed Biome Check: Lumina caverns exist everywhere deep down.
                // Removed Cluster Noise: We want to spawn wherever the material exists.

                // Find a cavern floor within the target band (air with solid below and headroom above)
                let centerFloorWy = Number.NEGATIVE_INFINITY;
                let foundCenter = false;
                let centerYIndex = -1;

                // Scan the column for a valid floor
                for (let y = cavernMaxY; y >= cavernMinY; y--) {
                    const idx = x + y * sizeX + z * sizeX * sizeY;
                    const idxBelow = idx - sizeX;
                    const idxAbove = idx + sizeX;
                    const idxAbove2 = idx + sizeX * 2;

                    // Safety bounds
                    if (idxAbove2 >= density.length || idxBelow < 0) continue;

                    // Check: Air at Y, Solid at Y-1, Air at Y+1, Air at Y+2 (Headroom)
                    if (density[idx] <= ISO_LEVEL && density[idxBelow] > ISO_LEVEL && density[idxAbove] <= ISO_LEVEL && density[idxAbove2] <= ISO_LEVEL) {

                        // Strict Material Check for Center Finding
                        const matBelow = material[idxBelow];
                        if (matBelow === MaterialType.GLOW_STONE || matBelow === MaterialType.OBSIDIAN) {
                            // Interpolate for smoother placement on the floor
                            const dAir = density[idx];
                            const dSolid = density[idxBelow];
                            const t = (ISO_LEVEL - dSolid) / (dAir - dSolid);
                            centerFloorWy = (y - PAD - 1 + t) + MESH_Y_OFFSET;
                            centerYIndex = y;
                            foundCenter = true;
                            break; // Stop at first valid floor from top of band
                        }
                    }
                }

                if (!foundCenter) continue;

                // Use position hash for deterministic clustering
                const seed = Math.abs(noise3D(wx * 1.31, centerFloorWy * 0.77, wz * 1.91));
                const clusterCount = 2 + Math.floor(seed * 4); // 2..6 per cluster (slightly reduced for density control)
                const spread = 2.0 + seed * 2.5; // Compact spread

                for (let i = 0; i < clusterCount && floraPlaced < maxFloraPerChunk; i++) {
                    const angle = seed * 12.9898 + i * 1.3;
                    const r = spread * (0.2 + ((i + 1) / (clusterCount + 1)));
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

                    const searchRange = 5;
                    const startY = Math.min(sizeY - 3, centerYIndex + searchRange); // Ensure headroom check stays within bounds
                    const endY = Math.max(1, centerYIndex - searchRange);

                    for (let fy = startY; fy >= endY; fy--) {
                        const idx = ix + fy * sizeX + iz * sizeX * sizeY;
                        const idxBelow = idx - sizeX;
                        const idxAbove = idx + sizeX; // 1 block headroom check

                        // Bounds safety
                        if (idxAbove >= density.length) continue;

                        // Simple check: Air at Y, Solid Y-1, Air Y+1 
                        // (Relaxed headroom check for cluster members - 1 block air above is enough for small flora)
                        if (density[idx] <= ISO_LEVEL && density[idxBelow] > ISO_LEVEL && density[idxAbove] <= ISO_LEVEL) {

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
                            flowerY - 0.05, // reduced sink to -0.05 to avoid hiding inside mesh
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
                } else if (biome === 'BEACH') {
                    // Beaches should have sparse trees (palms) and no dense forest at the shoreline.
                    treeThreshold = 0.95;
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

                        // Don't spawn trees in/near sea-level water.
                        // Water fill is a post-pass, so we use the waterline heuristic here (fast + stable).
                        // This prevents trees from appearing inside oceans/lakes.
                        if (wy <= WATER_LEVEL + 0.25) continue;

                        const hash = Math.abs(noise3D(wx * 12.3, wy * 12.3, wz * 12.3));
                        // getTreeForBiome can return null to indicate "no tree for this biome/noise".
                        const treeType = getTreeForBiome(biome, hash);
                        if (treeType === null) continue;

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

        // --- 3.7 Firefly Generation (Surface Pass) ---
        // Fireflies are generated as small swarms and persisted per-chunk (so they don't "regenerate"
        // or jump around as the player crosses streaming boundaries).
        //
        // Placement heuristics:
        // - Bias swarms near trees (looks intentional and "alive").
        // - Add a few "valley" swarms where local height is below nearby terrain.
        //
        // Data layout: stride 4 in WORLD SPACE: x, y, z, seed
        // (seed drives blink/drift in the renderer so we don't need per-frame CPU updates).
        const hash01 = (x: number, y: number, z: number, salt: number) => {
            // `noise3D` is deterministic and already in this module; map [-1..1] -> [0..1].
            const n = noise3D(x * 0.011 + salt * 0.17, y * 0.017 + salt * 0.31, z * 0.013 + salt * 0.23);
            return (n + 1) * 0.5;
        };

        const spawnSwarm = (centerX: number, centerZ: number, baseHeightOffset: number, seedSalt: number) => {
            const surfaceY = TerrainService.getHeightAt(centerX, centerZ);
            // Don't spawn fireflies inside oceans/lakes.
            if (surfaceY <= WATER_LEVEL + 0.25) return;

            const swarmSeed = hash01(centerX, surfaceY, centerZ, seedSalt);
            const moteCount = 10 + Math.floor(hash01(centerX, surfaceY, centerZ, seedSalt + 1) * 9); // 10..18
            const radius = 2.25 + hash01(centerX, surfaceY, centerZ, seedSalt + 2) * 3.75; // 2.25..6.0

            for (let i = 0; i < moteCount; i++) {
                const u = hash01(centerX, surfaceY, centerZ, seedSalt + 10 + i * 3);
                const v = hash01(centerX, surfaceY, centerZ, seedSalt + 11 + i * 3);
                const w = hash01(centerX, surfaceY, centerZ, seedSalt + 12 + i * 3);

                const angle = u * Math.PI * 2;
                // `sqrt` makes the distribution denser toward the center (reads as a swarm).
                const r = Math.sqrt(v) * radius;
                const wx = centerX + Math.cos(angle) * r;
                const wz = centerZ + Math.sin(angle) * r;

                const ySurface = TerrainService.getHeightAt(wx, wz);
                if (ySurface <= WATER_LEVEL + 0.25) continue;

                // Keep them close to the ground; stable per mote.
                const heightOffset = baseHeightOffset + w * 1.35; // ~0.6..2.0
                const wy = ySurface + heightOffset;

                // Per-mote seed used for blink/drift. Keep in [0..1] for convenience.
                const seed = (swarmSeed * 0.7) + hash01(wx, wy, wz, seedSalt + 99) * 0.3;
                fireflyCandidates.push(wx, wy, wz, seed);
            }
        };

        // 1) Tree-biased swarms: sample a subset of the generated tree placements.
        // Limit per-chunk to keep draw cost and worker time predictable.
        let treeSwarms = 0;
        const MAX_TREE_SWARMS = 4;
        for (let i = 0; i < treeCandidates.length && treeSwarms < MAX_TREE_SWARMS; i += 4) {
            const tx = treeCandidates[i + 0] + worldOffsetX;
            const tz = treeCandidates[i + 2] + worldOffsetZ;
            const biome = BiomeManager.getBiomeAt(tx, tz);

            // Rough biome gate: only bother in biomes that actually want fireflies.
            // (Keep this local; we intentionally don't import renderer helpers here.)
            if (biome !== 'THE_GROVE' && biome !== 'JUNGLE' && biome !== 'PLAINS' && biome !== 'MOUNTAINS' && biome !== 'BEACH') {
                continue;
            }

            const p = hash01(tx, 0, tz, 701);
            // Not every tree gets a swarm; makes them feel like "pockets".
            if (p < 0.75) continue;

            spawnSwarm(tx, tz, 0.65, 800 + treeSwarms * 37);
            treeSwarms++;
        }

        // 2) Valley swarms: a few tests per chunk, looking for spots below nearby terrain.
        // This reads as "low points" like shallow dips and streambeds.
        let valleySwarms = 0;
        const MAX_VALLEY_SWARMS = 3;
        const SAMPLE_STEP = 10;
        for (let z = 0; z < CHUNK_SIZE_XZ && valleySwarms < MAX_VALLEY_SWARMS; z += SAMPLE_STEP) {
            for (let x = 0; x < CHUNK_SIZE_XZ && valleySwarms < MAX_VALLEY_SWARMS; x += SAMPLE_STEP) {
                const wx = worldOffsetX + x;
                const wz = worldOffsetZ + z;

                const biome = BiomeManager.getBiomeAt(wx, wz);
                if (biome !== 'THE_GROVE' && biome !== 'JUNGLE' && biome !== 'PLAINS' && biome !== 'MOUNTAINS' && biome !== 'BEACH') {
                    continue;
                }

                const centerH = TerrainService.getHeightAt(wx, wz);
                if (centerH <= WATER_LEVEL + 0.25) continue;

                const s = 6;
                const hN = TerrainService.getHeightAt(wx, wz - s);
                const hS = TerrainService.getHeightAt(wx, wz + s);
                const hE = TerrainService.getHeightAt(wx + s, wz);
                const hW = TerrainService.getHeightAt(wx - s, wz);
                const avg = (hN + hS + hE + hW) * 0.25;

                // Require a meaningful dip, but not a canyon.
                const dip = avg - centerH;
                if (dip < 1.4 || dip > 10.0) continue;

                // Thin by noise so we don't overpopulate every valley candidate.
                const p = hash01(wx, centerH, wz, 911);
                if (p < 0.72) continue;

                spawnSwarm(wx, wz, 0.55, 1200 + valleySwarms * 41);
                valleySwarms++;
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

        // --- 5. Ground Item Generation (Sticks + Stones/Rocks) ---
        // These are lightweight, deterministic, per-chunk ground pickups meant to add "foraging" loops.
        // - Sticks: biased toward tree-dense biomes and placed near tree bases.
        // - Stones: placed on rocky surfaces (mountains), on beaches, and on cave floors.
        // - Large rocks: rare, non-pickup obstacles with collision (mountains + caves).
        //
        // Data layout (chunk-local XZ, world-space Y):
        // - stickPositions: stride 8: x, y, z, nx, ny, nz, variant, seed
        // - rockPositions:  stride 8: x, y, z, nx, ny, nz, variant, seed
        // - largeRockPositions: stride 6: x, y, z, radius, variant, seed
        const clampi = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
        const idx3 = (ix: number, iy: number, iz: number) => ix + iy * sizeX + iz * sizeX * sizeY;
        const hash01p = (x: number, y: number, z: number, salt: number) => {
            const n = noise3D(x * 0.011 + salt * 0.17, y * 0.017 + salt * 0.31, z * 0.013 + salt * 0.23);
            return (n + 1) * 0.5;
        };

        const normalAt = (ix: number, iy: number, iz: number): [number, number, number] => {
            const x0 = clampi(ix - 1, 0, sizeX - 1);
            const x1 = clampi(ix + 1, 0, sizeX - 1);
            const y0 = clampi(iy - 1, 0, sizeY - 1);
            const y1 = clampi(iy + 1, 0, sizeY - 1);
            const z0 = clampi(iz - 1, 0, sizeZ - 1);
            const z1 = clampi(iz + 1, 0, sizeZ - 1);

            const dx = density[idx3(x1, iy, iz)] - density[idx3(x0, iy, iz)];
            const dy = density[idx3(ix, y1, iz)] - density[idx3(ix, y0, iz)];
            const dz = density[idx3(ix, iy, z1)] - density[idx3(ix, iy, z0)];

            let nx = dx;
            let ny = dy;
            let nz = dz;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len < 1e-6) return [0, 1, 0];
            nx /= len; ny /= len; nz /= len;
            // Prefer "upward" normals for ground alignment.
            if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
            return [nx, ny, nz];
        };

        const findTopSurfaceAtLocalXZ = (localX: number, localZ: number): { worldY: number; normal: [number, number, number]; matBelow: number } | null => {
            const ix = clampi(Math.floor(localX) + PAD, 0, sizeX - 1);
            const iz = clampi(Math.floor(localZ) + PAD, 0, sizeZ - 1);
            for (let y = sizeY - 2; y >= 1; y--) {
                const idx = idx3(ix, y, iz);
                if (density[idx] > ISO_LEVEL) {
                    const idxAbove = idx3(ix, y + 1, iz);
                    // Ensure we are at a solid->air boundary (actual exposed surface),
                    // otherwise we can "hit" interior solids under overhangs and place items inside rock.
                    if (density[idxAbove] > ISO_LEVEL) continue;
                    const dSolid = density[idx];
                    const dAir = density[idxAbove];
                    const t = (ISO_LEVEL - dSolid) / (dAir - dSolid);
                    const worldY = (y - PAD + t) + MESH_Y_OFFSET;
                    const n = normalAt(ix, y, iz);
                    const matBelow = material[idx] ?? MaterialType.DIRT;
                    return { worldY, normal: n, matBelow };
                }
            }
            return null;
        };

        const findGroundNear = (
            localX: number,
            localZ: number,
            centerYIndex: number,
            searchRange: number,
            requireHeadroomCells: number
        ): { worldY: number; normal: [number, number, number]; matBelow: number } | null => {
            const ix = clampi(Math.floor(localX) + PAD, 0, sizeX - 1);
            const iz = clampi(Math.floor(localZ) + PAD, 0, sizeZ - 1);
            const startY = clampi(centerYIndex + searchRange, 2, sizeY - 3);
            const endY = clampi(centerYIndex - searchRange, 1, sizeY - 4);

            for (let fy = startY; fy >= endY; fy--) {
                const idxAir = idx3(ix, fy, iz);
                const idxBelow = idx3(ix, fy - 1, iz);
                if (density[idxAir] > ISO_LEVEL) continue;
                if (density[idxBelow] <= ISO_LEVEL) continue;

                let headroomOk = true;
                for (let k = 0; k < requireHeadroomCells; k++) {
                    const iy = fy + k;
                    if (iy >= sizeY) { headroomOk = false; break; }
                    const idxHr = idx3(ix, iy, iz);
                    if (density[idxHr] > ISO_LEVEL) { headroomOk = false; break; }
                }
                if (!headroomOk) continue;

                const dAir = density[idxAir];
                const dSolid = density[idxBelow];
                const t = (ISO_LEVEL - dSolid) / (dAir - dSolid);
                const worldY = (fy - PAD - 1 + t) + MESH_Y_OFFSET;
                const n = normalAt(ix, fy - 1, iz);
                const matBelow = material[idxBelow] ?? MaterialType.DIRT;
                return { worldY, normal: n, matBelow };
            }

            return null;
        };

        const isRockyMaterial = (m: number): boolean => (
            m === MaterialType.STONE ||
            m === MaterialType.MOSSY_STONE ||
            m === MaterialType.TERRACOTTA ||
            m === MaterialType.OBSIDIAN ||
            m === MaterialType.GLOW_STONE
        );

        const MAX_STICKS = 40;
        const MAX_PICKUP_ROCKS = 18;
        const MAX_LARGE_ROCKS = 3;

        // 5.1 Sticks (near trees, biased to high-tree biomes)
        // NOTE: treeCandidates are chunk-local (XZ) and world-space Y.
        for (let i = 0; i < treeCandidates.length && stickCandidates.length / 8 < MAX_STICKS; i += 4) {
            const txLocal = treeCandidates[i + 0];
            const tyWorld = treeCandidates[i + 1];
            const tzLocal = treeCandidates[i + 2];

            const txWorld = txLocal + worldOffsetX;
            const tzWorld = tzLocal + worldOffsetZ;
            const biome = BiomeManager.getBiomeAt(txWorld, tzWorld);

            let biomeFactor = 0.0;
            if (biome === 'JUNGLE') biomeFactor = 1.0;
            else if (biome === 'THE_GROVE') biomeFactor = 0.45;
            else if (biome === 'PLAINS') biomeFactor = 0.25;
            else biomeFactor = 0.0;
            if (biomeFactor <= 0) continue;

            const spawnP = hash01p(txWorld, tyWorld, tzWorld, 3101);
            if (spawnP > biomeFactor * 0.65) continue;

            const attempts = biome === 'JUNGLE' ? 3 : 2;
            const centerYIdx = clampi(Math.floor((tyWorld + 0.2 - MESH_Y_OFFSET) + PAD), 2, sizeY - 3);

            for (let a = 0; a < attempts && stickCandidates.length / 8 < MAX_STICKS; a++) {
                const u = hash01p(txWorld, tyWorld, tzWorld, 3120 + a * 7);
                const v = hash01p(txWorld, tyWorld, tzWorld, 3121 + a * 7);
                const w = hash01p(txWorld, tyWorld, tzWorld, 3122 + a * 7);

                const angle = u * Math.PI * 2;
                const r = 0.25 + v * 1.15;
                const lx = txLocal + Math.cos(angle) * r;
                const lz = tzLocal + Math.sin(angle) * r;

                const hit = findGroundNear(lx, lz, centerYIdx, 6, 1);
                if (!hit) continue;
                if (hit.worldY <= WATER_LEVEL + 0.15) continue;

                const variant = biome === 'JUNGLE' ? 1 : 0;
                stickCandidates.push(
                    lx,
                    hit.worldY + 0.05,
                    lz,
                    hit.normal[0], hit.normal[1], hit.normal[2],
                    variant,
                    w
                );
            }
        }

        // 5.2 Surface rocks (mountains + beaches; keep scarce)
        for (let i = 0; i < 22 && rockCandidates.length / 8 < MAX_PICKUP_ROCKS; i++) {
            const u = hash01p(worldOffsetX, 0, worldOffsetZ, 4200 + i * 3);
            const v = hash01p(worldOffsetX, 0, worldOffsetZ, 4201 + i * 3);
            const lx = u * CHUNK_SIZE_XZ;
            const lz = v * CHUNK_SIZE_XZ;
            const wx = worldOffsetX + lx;
            const wz = worldOffsetZ + lz;

            const biome = BiomeManager.getBiomeAt(wx, wz);
            const top = findTopSurfaceAtLocalXZ(lx, lz);
            if (!top) continue;
            if (top.worldY <= WATER_LEVEL + 0.15) continue;

            const matBelow = top.matBelow;

            let want = false;
            let threshold = 0.0;
            let variant: RockVariant = RockVariant.MOUNTAIN;

            if (biome === 'BEACH') {
                want = true;
                threshold = 0.35;
                variant = RockVariant.BEACH;
            } else if (biome === 'MOUNTAINS' || biome === 'ICE_SPIKES') {
                want = isRockyMaterial(matBelow);
                threshold = 0.35;
                variant = matBelow === MaterialType.MOSSY_STONE ? RockVariant.MOSSY : RockVariant.MOUNTAIN;
            } else {
                // Outside obvious rocky biomes, only sprinkle on exposed stone at higher altitudes.
                want = isRockyMaterial(matBelow) && top.worldY > 24;
                threshold = 0.16;
                variant = matBelow === MaterialType.MOSSY_STONE ? RockVariant.MOSSY : RockVariant.MOUNTAIN;
            }

            if (!want) continue;
            const p = hash01p(wx, top.worldY, wz, 4220);
            if (p > threshold) continue;

            // Small local jitter keeps them from reading as grid-snapped.
            const jx = (hash01p(wx, top.worldY, wz, 4221) - 0.5) * 0.9;
            const jz = (hash01p(wx, top.worldY, wz, 4222) - 0.5) * 0.9;
            rockCandidates.push(
                lx + jx,
                top.worldY + 0.05,
                lz + jz,
                top.normal[0], top.normal[1], top.normal[2],
                variant,
                p
            );

            // Rare large surface rock in mountainous / rocky areas.
            if (largeRockCandidates.length / 6 < MAX_LARGE_ROCKS) {
                const bigP = hash01p(wx, top.worldY, wz, 4250);
                const bigOk = (biome === 'MOUNTAINS' || biome === 'ICE_SPIKES') && isRockyMaterial(matBelow);
                if (bigOk && bigP < 0.06) {
                    const radius = 1.1 + hash01p(wx, top.worldY, wz, 4251) * 1.8; // ~1.1..2.9
                    largeRockCandidates.push(
                        lx + (hash01p(wx, top.worldY, wz, 4252) - 0.5) * 1.2,
                        top.worldY + 0.05,
                        lz + (hash01p(wx, top.worldY, wz, 4253) - 0.5) * 1.2,
                        radius,
                        variant,
                        bigP
                    );
                }
            }
        }

        // 5.3 Cave rocks (on cave floors, near rock material)
        for (let i = 0; i < 26 && rockCandidates.length / 8 < MAX_PICKUP_ROCKS; i++) {
            const u = hash01p(worldOffsetX, -101, worldOffsetZ, 5200 + i * 3);
            const v = hash01p(worldOffsetX, -101, worldOffsetZ, 5201 + i * 3);
            const lx = u * CHUNK_SIZE_XZ;
            const lz = v * CHUNK_SIZE_XZ;
            const wx = worldOffsetX + lx;
            const wz = worldOffsetZ + lz;

            // Find the top surface so we can look for a floor below it (skip shallow overhangs).
            const top = findTopSurfaceAtLocalXZ(lx, lz);
            if (!top) continue;
            const surfaceYIdx = clampi(Math.floor((top.worldY - MESH_Y_OFFSET) + PAD), 2, sizeY - 3);

            // Search for a deeper floor (air cell with solid below) well below the surface.
            const minDepthCells = 12;
            const center = surfaceYIdx - minDepthCells;
            const floor = findGroundNear(lx, lz, center, 36, 2);
            if (!floor) continue;

            // Must be meaningfully underground and on/near rock.
            if (floor.worldY > top.worldY - 8) continue;
            if (!isRockyMaterial(floor.matBelow)) continue;

            const p = hash01p(wx, floor.worldY, wz, 5230);
            if (p > 0.35) continue;

            const variant = floor.matBelow === MaterialType.MOSSY_STONE ? RockVariant.MOSSY : RockVariant.CAVE;
            rockCandidates.push(
                lx + (hash01p(wx, floor.worldY, wz, 5231) - 0.5) * 0.85,
                floor.worldY + 0.05,
                lz + (hash01p(wx, floor.worldY, wz, 5232) - 0.5) * 0.85,
                floor.normal[0], floor.normal[1], floor.normal[2],
                variant,
                p
            );

            // Very rare large cave boulder (ensure headroom).
            if (largeRockCandidates.length / 6 < MAX_LARGE_ROCKS) {
                const bigP = hash01p(wx, floor.worldY, wz, 5260);
                if (bigP < 0.045) {
                    const radius = 1.0 + hash01p(wx, floor.worldY, wz, 5261) * 1.6; // ~1.0..2.6
                    largeRockCandidates.push(
                        lx + (hash01p(wx, floor.worldY, wz, 5262) - 0.5) * 1.0,
                        floor.worldY + 0.05,
                        lz + (hash01p(wx, floor.worldY, wz, 5263) - 0.5) * 1.0,
                        radius,
                        variant,
                        bigP
                    );
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
            stickPositions: new Float32Array(stickCandidates),
            rockPositions: new Float32Array(rockCandidates),
            largeRockPositions: new Float32Array(largeRockCandidates),
            rootHollowPositions: new Float32Array(rootHollowCandidates),
            fireflyPositions: new Float32Array(fireflyCandidates)
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

    /**
     * Paint a liquid material into empty space within a spherical brush.
     * This does NOT alter density, so it will not create new terrain surface geometry.
     *
     * Intended for V1 water placement:
     * - Player can place water into air without needing a full fluid simulation.
     * - Water rendering is handled by the water surface mesher (separate mesh).
     *
     * @param density - Chunk density field (padded)
     * @param materialData - Chunk material field (padded)
     * @param wetness - Optional wetness metadata layer (padded). If provided, painted water sets wetness to 255.
     * @param localPoint - Chunk-local point (x,z relative to chunk origin, y in world-space)
     * @param radius - Brush radius
     * @param liquidMaterial - Material to paint (WATER or ICE)
     */
    static paintLiquid(
        density: Float32Array,
        materialData: Uint8Array,
        wetness: Uint8Array | undefined,
        localPoint: { x: number, y: number, z: number },
        radius: number,
        liquidMaterial: MaterialType = MaterialType.WATER
    ): boolean {
        const sizeX = TOTAL_SIZE_XZ;
        const sizeY = TOTAL_SIZE_Y;
        const sizeZ = TOTAL_SIZE_XZ;

        const hx = localPoint.x + PAD;
        const hy = localPoint.y - MESH_Y_OFFSET + PAD;
        const hz = localPoint.z + PAD;

        const rSq = radius * radius;
        const iRad = Math.ceil(radius + 0.5);
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
                    if (distSq >= rSq) continue;

                    const idx = x + y * sizeX + z * sizeX * sizeY;

                    // Only paint into air-space (no density edits).
                    if (density[idx] <= ISO_LEVEL && materialData[idx] === MaterialType.AIR) {
                        materialData[idx] = liquidMaterial;
                        if (wetness) wetness[idx] = 255;
                        modified = true;
                    }
                }
            }
        }

        return modified;
    }
}
