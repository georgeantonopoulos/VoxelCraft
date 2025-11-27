
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, ISO_LEVEL, MESH_Y_OFFSET, SNAP_EPSILON } from '../constants';
import { noise } from '../utils/noise';
import { MaterialType, ChunkMetadata } from '../types';

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
          if (y > 0) {
             const idxBelow = idx - sizeX;
             const dBelow = density[idxBelow];
             // Detect Surface: Current is Air (<= ISO), Below is Solid (> ISO)
             if (d <= ISO_LEVEL && dBelow > ISO_LEVEL) {
                 // Check Valley Conditions
                 if (continental < -1.0 && mountains < 0.0) {
                     // Sparsity Check
                     const sparsityNoise = noise(wx * 0.5, wy * 0.5, wz * 0.5);
                     if (sparsityNoise > 0.5) {
                         // Place slightly embedded at the interface
                         // Use local coordinates relative to the chunk (ChunkMesh applies the world offset)
                         rootHollowCandidates.push((x - PAD) + 0.5, wy - 0.5, (z - PAD) + 0.5);
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
                if (wy > 24 + noise(wx*0.1, 0, wz*0.1)*4) {
                    material[idx] = MaterialType.SNOW;
                } 
                else if (wy < WATER_LEVEL + 2.0) {
                     if (wy < WATER_LEVEL + 1.0) material[idx] = MaterialType.SAND;
                     else material[idx] = (noise(wx*0.5, 0, wz*0.5) > 0) ? MaterialType.SAND : MaterialType.DIRT;
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
                    const idxBelow = x + (y-1) * sizeX + z * sizeX * sizeY;
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
    localPoint: {x: number, y: number, z: number}, 
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
            const distSq = dx*dx + dy*dy + dz*dz;

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
