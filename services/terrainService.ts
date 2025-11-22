
import { CHUNK_SIZE, PAD, TOTAL_SIZE, TOTAL_HEIGHT, WATER_LEVEL, ISO_LEVEL, BEDROCK_LEVEL } from '../constants';
import { noise } from '../utils/noise';
import { MaterialType, ChunkMetadata } from '../types';

export class TerrainService {
  // Helper to find surface height at specific world coordinates
  static getHeightAt(wx: number, wz: number): number {
      // Scan from high up down to find the surface
      for (let y = 100; y > BEDROCK_LEVEL - 5; y--) {

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

          // Extended Cave Logic
          if (y < surfaceHeight - 4 && y > BEDROCK_LEVEL + 4) {
             const caveFreq = 0.08;
             // Add warp to caves for more natural look
             const cx = wx + noise(wx*0.2, y*0.2, wz*0.2)*2;
             const cz = wz + noise(wx*0.15, y*0.15, wz*0.15)*2;
             const c1 = noise(cx * caveFreq, y * caveFreq, cz * caveFreq);

             // Larger caves deep down
             let threshold = 0.12;
             if (y < -10) threshold = 0.15;

             if (Math.abs(c1) < threshold) {
                 d -= 20.0;
             }
          }

          // Hard floor at bedrock
          if (y < BEDROCK_LEVEL + 2) d += 50.0;

          if (d > ISO_LEVEL) {
              return y;
          }
      }
      return 20; // Fallback
  }

  static generateChunk(cx: number, cz: number): { density: Float32Array, material: Uint8Array, metadata: ChunkMetadata } {
    const sizeXZ = TOTAL_SIZE;
    const sizeY = TOTAL_HEIGHT;
    const density = new Float32Array(sizeXZ * sizeY * sizeXZ);
    const material = new Uint8Array(sizeXZ * sizeY * sizeXZ);

    // Initialize flexible metadata
    const wetness = new Uint8Array(sizeXZ * sizeY * sizeXZ);
    const mossiness = new Uint8Array(sizeXZ * sizeY * sizeXZ);

    const worldOffsetX = cx * CHUNK_SIZE;
    const worldOffsetZ = cz * CHUNK_SIZE;

    // Vertical Offset to align mesh 0 with BEDROCK_LEVEL roughly
    // y index 0 is -PAD. We want that to be BEDROCK_LEVEL.
    // But we also want surface at ~14.
    // We map: wy = (y - PAD) + OFFSET.
    // Use OFFSET = -33 as calculated to align with BedrockPlane at -35.
    const VERTICAL_OFFSET = -33;

    for (let z = 0; z < sizeXZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeXZ; x++) {
          
          const idx = x + y * sizeXZ + z * sizeXZ * sizeY;
          
          // World Coordinates
          const wx = (x - PAD) + worldOffsetX;
          const wy = (y - PAD) + VERTICAL_OFFSET;
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

          // Extended Caves
          if (wy < surfaceHeight - 4 && wy > BEDROCK_LEVEL + 4) {
             const caveFreq = 0.08;
             // Warp cave coords
             const cx = wx + noise(wx*0.2, wy*0.2, wz*0.2)*2;
             const cz = wz + noise(wx*0.15, wy*0.15, wz*0.15)*2;

             const c1 = noise(cx * caveFreq, wy * caveFreq, cz * caveFreq);

             let threshold = 0.12;
             // Bigger caves deep down
             if (wy < -10) threshold = 0.16;

             if (Math.abs(c1) < threshold) {
                 d -= 20.0; 
             }
          }

          // Hard floor near bedrock
          if (wy < BEDROCK_LEVEL + 2) d += 50.0;

          density[idx] = d;

          // --- 3. Material Generation ---
          
          if (d > ISO_LEVEL) { // If solid
            const soilNoise = noise(wx * 0.1, wy * 0.1, wz * 0.1);
            const soilDepth = 8.0 + soilNoise * 4.0; 
            
            const depth = (surfaceHeight + overhang) - wy;

            // Bedrock bottom
            if (wy < BEDROCK_LEVEL + 4) {
                material[idx] = MaterialType.BEDROCK;
            } 
            else if (depth > soilDepth) {
                // Deep Stone Variation
                material[idx] = MaterialType.STONE;

                // Add Clay veins
                if (noise(wx * 0.15, wy * 0.15, wz * 0.15) > 0.6) {
                    material[idx] = MaterialType.CLAY;
                }
                // Add Mossy Stone patches deep underground (ancient ruins look)
                else if (wy < -15 && noise(wx * 0.08, wy * 0.08, wz * 0.08) > 0.7) {
                     material[idx] = MaterialType.MOSSY_STONE;
                }
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
                material[idx] = MaterialType.WATER_SOURCE;
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
    const sizeXZ = TOTAL_SIZE;
    const sizeY = TOTAL_HEIGHT;
    const hx = localPoint.x + PAD;
    const hy = localPoint.y + PAD; // Note: localPoint.y coming from raycast will be relative to mesh origin?
    // VoxelTerrain passes `hitPoint.y`. Mesh is offset by VERTICAL_OFFSET?
    // Wait, modifyChunk uses indices. We need to ensure localPoint maps to array index.
    // In VoxelTerrain, hitPoint is World Coordinate.
    // localY = hitPoint.y - meshPosition.y?
    // Currently VoxelTerrain passes `hitPoint.y`.
    // If we shift mesh by -33, then mesh starts at -33.
    // If hit is at 0, localY should be 33.
    // We need to handle this in VoxelTerrain.tsx or here.
    // Assuming VoxelTerrain passes correct local coordinate relative to the array origin (y=0).

    const hz = localPoint.z + PAD;
    const rSq = radius * radius;
    const iRad = Math.ceil(radius);
    const minX = Math.max(0, Math.floor(hx - iRad));
    const maxX = Math.min(sizeXZ - 1, Math.ceil(hx + iRad));
    const minY = Math.max(0, Math.floor(hy - iRad));
    const maxY = Math.min(sizeY - 1, Math.ceil(hy + iRad));
    const minZ = Math.max(0, Math.floor(hz - iRad));
    const maxZ = Math.min(sizeXZ - 1, Math.ceil(hz + iRad));

    let modified = false;

    for (let z = minZ; z <= maxZ; z++) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
            const dx = x - hx;
            const dy = y - hy;
            const dz = z - hz;
            const distSq = dx*dx + dy*dy + dz*dz;

            if (distSq < rSq) {
                const idx = x + y * sizeXZ + z * sizeXZ * sizeY;
                const dist = Math.sqrt(distSq);
                const t = dist / radius;
                const falloff = Math.pow(1.0 - t, 2); 
                const strength = falloff * delta;
                const oldDensity = density[idx];
                
                density[idx] += strength;
                
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
