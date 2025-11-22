
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, ISO_LEVEL, MESH_Y_OFFSET } from '../constants';
import { noise } from '../utils/noise';
import { MaterialType, ChunkMetadata } from '../types';

export class TerrainService {
  // Helper to find surface height at specific world coordinates
  static getHeightAt(wx: number, wz: number): number {
      // Scan from high up down to find the surface
      for (let y = 100; y > MESH_Y_OFFSET; y--) {

          const warpScale = 0.008;
          const warpStr = 15.0;
          const qx = noise(wx * warpScale, 0, wz * warpScale) * warpStr;
          const qz = noise(wx * warpScale + 5.2, 0, wz * warpScale + 1.3) * warpStr;

          const px = wx + qx;
          const pz = wz + qz;

          const continental = noise(px * 0.01, 0, pz * 0.01) * 8;
          let mountains = noise(px * 0.05, 0, pz * 0.05) * 4;
          mountains += noise(px * 0.15, 0, pz * 0.15) * 1.5;

          const cliffNoise = noise(wx * 0.06, y * 0.08, wz * 0.06);
          const overhang = cliffNoise * 6;

          const surfaceHeight = 14 + continental + mountains;
          let d = surfaceHeight - y + overhang;

          if (y < surfaceHeight - 4 && y > -20) {
             const caveFreq = 0.08;
             const c1 = noise(wx * caveFreq, y * caveFreq, wz * caveFreq);
             if (Math.abs(c1) < 0.12) {
                 d -= 20.0;
             }
          }

          // Hard floor
          if (y <= MESH_Y_OFFSET + 2) d += 50.0;

          if (d > ISO_LEVEL) {
              return y;
          }
      }
      return 20; // Fallback
  }

  static generateChunk(cx: number, cz: number): { density: Float32Array, material: Uint8Array, metadata: ChunkMetadata } {
    const sizeX = TOTAL_SIZE_XZ;
    const sizeY = TOTAL_SIZE_Y;
    const sizeZ = TOTAL_SIZE_XZ;

    const density = new Float32Array(sizeX * sizeY * sizeZ);
    const material = new Uint8Array(sizeX * sizeY * sizeZ);
    const wetness = new Uint8Array(sizeX * sizeY * sizeZ);
    const mossiness = new Uint8Array(sizeX * sizeY * sizeZ);

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
          if (wy < surfaceHeight - 4 && wy > -20) {
             const caveFreq = 0.08;
             const c1 = noise(wx * caveFreq, wy * caveFreq, wz * caveFreq);
             if (Math.abs(c1) < 0.12) {
                 d -= 20.0; 
             }
          }

          // Hard floor (Bedrock)
          if (wy <= MESH_Y_OFFSET + 2) d += 50.0;

          density[idx] = d;

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
            // Ensure we don't generate water inside the "Solid Bedrock" zone (though it's density > ISO, so logic handles it)
            // But if density logic failed, we check here too.
            if (wy <= WATER_LEVEL) {
                material[idx] = MaterialType.WATER;
                wetness[idx] = 255;
            } else {
                material[idx] = MaterialType.AIR;
            }
          }
        }
      }
    }

    const metadata: ChunkMetadata = {
        wetness,
        mossiness
    };

    return { density, material, metadata };
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
                const falloff = Math.pow(1.0 - t, 2); 
                const strength = falloff * delta;
                const oldDensity = density[idx];
                
                density[idx] += strength;
                
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
