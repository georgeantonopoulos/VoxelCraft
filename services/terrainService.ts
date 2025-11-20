
import { CHUNK_SIZE, PAD, TOTAL_SIZE, WATER_LEVEL, ISO_LEVEL } from '../constants';
import { noise } from '../utils/noise';
import { MaterialType } from '../types';

export class TerrainService {
  // Generate density and material for a specific chunk coordinate (cx, cz)
  static generateChunk(cx: number, cz: number): { density: Float32Array, material: Uint8Array } {
    const size = TOTAL_SIZE;
    const density = new Float32Array(size * size * size);
    const material = new Uint8Array(size * size * size);
    
    const worldOffsetX = cx * CHUNK_SIZE;
    const worldOffsetZ = cz * CHUNK_SIZE;

    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          
          const idx = x + y * size + z * size * size;
          
          // World Coordinates
          const wx = (x - PAD) + worldOffsetX;
          const wy = (y - PAD); 
          const wz = (z - PAD) + worldOffsetZ;
          
          // --- 1. Domain Warping (Organic Shapes) ---
          const warpScale = 0.008;
          const warpStr = 15.0;
          const qx = noise(wx * warpScale, 0, wz * warpScale) * warpStr;
          const qz = noise(wx * warpScale + 5.2, 0, wz * warpScale + 1.3) * warpStr;

          const px = wx + qx;
          const pz = wz + qz;

          // --- 2. Density / Height Generation ---
          const continental = noise(px * 0.01, 0, pz * 0.01) * 8;
          
          // Detailed features
          let mountains = noise(px * 0.05, 0, pz * 0.05) * 4;
          mountains += noise(px * 0.15, 0, pz * 0.15) * 1.5;

          // 3D Noise for overhangs
          const cliffNoise = noise(wx * 0.06, wy * 0.08, wz * 0.06);
          const overhang = cliffNoise * 6;

          // Target surface height ~12-16 units up
          const surfaceHeight = 14 + continental + mountains;
          
          // Density: Positive = solid (underground), Negative = air
          let d = surfaceHeight - wy + overhang;

          // Caves
          if (wy < surfaceHeight - 4 && wy > -20) {
             const caveFreq = 0.08;
             const c1 = noise(wx * caveFreq, wy * caveFreq, wz * caveFreq);
             if (Math.abs(c1) < 0.12) {
                 d -= 20.0; 
             }
          }

          // Hard floor
          if (wy < -4) d += 50.0;

          density[idx] = d;

          // --- 3. Material Generation ---
          
          if (d > ISO_LEVEL) { // If solid
            // Soil Depth: How deep the dirt goes before hitting stone
            // Increased depth to avoid stone appearing on slight variations
            const soilNoise = noise(wx * 0.1, wy * 0.1, wz * 0.1);
            const soilDepth = 8.0 + soilNoise * 4.0; 
            
            const depth = (surfaceHeight + overhang) - wy;
            const slope = Math.abs(cliffNoise); 

            // Bedrock bottom
            if (wy < -8) {
                material[idx] = MaterialType.BEDROCK;
            } 
            // Deep Stone or Steep Cliffs (handled by shader, but set here for digging consistency)
            else if (depth > soilDepth) {
                material[idx] = MaterialType.STONE;
            } else {
                // Surface Layers
                
                // Peaks get Snow
                if (wy > 24 + noise(wx*0.1, 0, wz*0.1)*4) {
                    material[idx] = MaterialType.SNOW;
                } 
                // Water level gets Sand
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
            material[idx] = MaterialType.AIR;
          }
        }
      }
    }
    return { density, material };
  }

  static modifyChunk(
    density: Float32Array, 
    materialData: Uint8Array,
    localPoint: {x: number, y: number, z: number}, 
    radius: number, 
    delta: number,
    brushMaterial: MaterialType = MaterialType.DIRT
  ): boolean {
    const size = TOTAL_SIZE;
    const hx = localPoint.x + PAD;
    const hy = localPoint.y + PAD;
    const hz = localPoint.z + PAD;
    const rSq = radius * radius;
    const iRad = Math.ceil(radius);
    const minX = Math.max(0, Math.floor(hx - iRad));
    const maxX = Math.min(size - 1, Math.ceil(hx + iRad));
    const minY = Math.max(0, Math.floor(hy - iRad));
    const maxY = Math.min(size - 1, Math.ceil(hy + iRad));
    const minZ = Math.max(0, Math.floor(hz - iRad));
    const maxZ = Math.min(size - 1, Math.ceil(hz + iRad));

    let modified = false;

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x - hx;
            const dy = y - hy;
            const dz = z - hz;
            const distSq = dx*dx + dy*dy + dz*dz;

            if (distSq < rSq) {
                const idx = x + y * size + z * size * size;
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
