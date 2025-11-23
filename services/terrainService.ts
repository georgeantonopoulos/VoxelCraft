import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, WATER_LEVEL, BEDROCK_LEVEL } from '../constants';
import { BlockType } from '../types';
import { noise } from '../utils/noise';
import { to1D } from '../utils/chunkUtils';

const SCALE = 0.03;

export const TerrainService = {
  getHeightAt: (x: number, z: number) => {
    let n = noise(x * SCALE, 0, z * SCALE);
    n += 0.5 * noise(x * SCALE * 2, 100, z * SCALE * 2);
    n += 0.25 * noise(x * SCALE * 4, 200, z * SCALE * 4);
    return Math.floor(n * 20);
  },

  generateChunk: (cx: number, cz: number) => {
    const data = new Uint8Array(TOTAL_SIZE_XZ * TOTAL_SIZE_XZ * TOTAL_SIZE_Y);

    const startX = cx * CHUNK_SIZE_XZ;
    const startZ = cz * CHUNK_SIZE_XZ;

    for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
      for (let z = 0; z < TOTAL_SIZE_XZ; z++) {
        const wx = startX + (x - PAD);
        const wz = startZ + (z - PAD);

        // 1. Heightmap
        const height = TerrainService.getHeightAt(wx, wz);

        for (let y = 0; y < TOTAL_SIZE_Y; y++) {
          const wy = y - PAD + BEDROCK_LEVEL; // World Y starts at BEDROCK_LEVEL
          
          let block = BlockType.AIR;

          // Bedrock floor
          if (wy <= BEDROCK_LEVEL + 2) {
             block = BlockType.BEDROCK;
          } else if (wy < height) {
             // Underground
             if (wy < height - 3) block = BlockType.STONE;
             else block = BlockType.DIRT;
          } else if (wy === height) {
             // Surface
             if (wy < WATER_LEVEL + 1) block = BlockType.SAND; // Beach
             else block = BlockType.GRASS;
          } else {
             // Air / Water
             if (wy <= WATER_LEVEL) block = BlockType.WATER;
          }

          // 2. Caves (3D Noise)
          if (block !== BlockType.AIR && block !== BlockType.BEDROCK && block !== BlockType.WATER) {
              const caveN = noise(wx * 0.06, wy * 0.06, wz * 0.06);
              if (caveN > 0.5) {
                  block = BlockType.AIR;
              }
          }

          if (block !== BlockType.AIR) {
             data[to1D(x, y, z)] = block;
          }
        }
      }
    }

    return { material: data };
  },

  setBlock: (chunkMaterial: Uint8Array, x: number, y: number, z: number, type: number) => {
      // x,y,z are local including padding
      const idx = to1D(x, y, z);
      if (idx >= 0 && idx < chunkMaterial.length) {
          chunkMaterial[idx] = type;
          return true;
      }
      return false;
  }
};
