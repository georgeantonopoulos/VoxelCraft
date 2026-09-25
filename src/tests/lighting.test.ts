import { describe, it, expect } from 'vitest';
import { generateMesh } from '@features/terrain/logic/mesher';
import { generateLightGrid, extractLuminaLights, getSkyLightConfig } from '@core/lighting/lightPropagation';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET, CHUNK_SIZE_XZ, LIGHT_CELL_SIZE, LIGHT_GRID_SIZE_XZ, LIGHT_GRID_SIZE_Y } from '@/constants';
import { MaterialType } from '@/types';

const SIZE = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;
const idx = (x: number, y: number, z: number) => x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

/** Solid ground up to grid y=60 with a shallow sealed cave (y=46..54) under a thin roof. */
const cavedColumnWorld = () => {
  const density = new Float32Array(SIZE);
  const material = new Uint8Array(SIZE);
  for (let z = 0; z < TOTAL_SIZE_XZ; z++) for (let y = 0; y < TOTAL_SIZE_Y; y++) for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
    const cave = y >= 46 && y <= 54 && x > 6 && x < 30 && z > 6 && z < 30;
    const solid = y < 60 && !cave;
    density[idx(x, y, z)] = solid ? 1 : -1;
    material[idx(x, y, z)] = solid ? MaterialType.STONE : MaterialType.AIR;
  }
  return { density, material };
};

const cellLight = (grid: Uint8Array, cx: number, cy: number, cz: number) => {
  const i = (cx + cy * LIGHT_GRID_SIZE_XZ + cz * LIGHT_GRID_SIZE_XZ * LIGHT_GRID_SIZE_Y) * 4;
  return grid[i] + grid[i + 1] + grid[i + 2];
};

describe('Voxel GI lighting', () => {
  it('sealed cave vertices are darker than surface vertices', () => {
    const { density, material } = cavedColumnWorld();
    const grid = generateLightGrid(density, [], getSkyLightConfig(0.5));
    const mesh = generateMesh(density, material, undefined, undefined, grid);
    let caveSum = 0, caveN = 0, topSum = 0, topN = 0;
    for (let v = 0; v < mesh.positions.length / 3; v++) {
      const gridY = mesh.positions[v * 3 + 1] - MESH_Y_OFFSET + PAD;
      const light = mesh.lightColors[v * 3] + mesh.lightColors[v * 3 + 1] + mesh.lightColors[v * 3 + 2];
      if (gridY > 58) { topSum += light; topN++; }
      else if (gridY > 45 && gridY < 55) { caveSum += light; caveN++; }
    }
    expect(caveN).toBeGreaterThan(0);
    expect(topN).toBeGreaterThan(0);
    expect(caveSum / caveN).toBeLessThan((topSum / topN) * 0.5);
  });

  it('lumina flora lights chunks away from the origin', () => {
    const { density } = cavedColumnWorld();
    const cx = 3, cz = -2;
    // Flora positions are world-space (see TerrainService.generateChunk).
    const localX = 16, localZ = 16, worldY = 50 - PAD + MESH_Y_OFFSET;
    const flora = new Float32Array([cx * CHUNK_SIZE_XZ + localX, worldY, cz * CHUNK_SIZE_XZ + localZ, 0]);
    const dark = generateLightGrid(density, [], getSkyLightConfig(0.5));
    const lit = generateLightGrid(density, extractLuminaLights(flora, cx * CHUNK_SIZE_XZ, cz * CHUNK_SIZE_XZ), getSkyLightConfig(0.5));
    const c = [localX / LIGHT_CELL_SIZE, Math.floor((worldY - MESH_Y_OFFSET) / LIGHT_CELL_SIZE), localZ / LIGHT_CELL_SIZE] as const;
    expect(cellLight(lit, ...c)).toBeGreaterThan(cellLight(dark, ...c));
  });
});
