import { describe, it, expect } from 'vitest';
import { TerrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET } from '@/constants';

const SIZE = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;
const idx = (x: number, y: number, z: number) => x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
const gy = (worldY: number) => Math.floor(worldY - MESH_Y_OFFSET) + PAD;

/** Registers a 3x3 block of identical chunks around the origin chunk. */
const world = (solidAt: (lx: number, wy: number, lz: number) => boolean) => {
  const density = new Float32Array(SIZE);
  for (let z = 0; z < TOTAL_SIZE_XZ; z++) for (let y = 0; y < TOTAL_SIZE_Y; y++) for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
    density[idx(x, y, z)] = solidAt(x - PAD, y - PAD + MESH_Y_OFFSET, z - PAD) ? 1 : -1;
  }
  const rt = new TerrainRuntime();
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) rt.registerChunk(`${cx},${cz}`, cx, cz, density, new Uint8Array(SIZE));
  return rt;
};

describe('Sky visibility estimate', () => {
  it('open ground is fully visible', () => {
    const rt = world((_x, y) => y < 10);
    expect(rt.estimateSkyVisibility(16, 11, 16)!).toBeGreaterThan(0.95);
  });

  it('standing beside a cliff is still open sky', () => {
    const rt = world((x, y) => y < 10 || (x > 18 && y < 60));
    expect(rt.estimateSkyVisibility(16, 11, 16)!).toBeGreaterThan(0.9);
  });

  it('a narrow open valley is not underground', () => {
    // Steep walls 2m either side, open above (dune trough / canyon).
    const rt = world((x, y) => y < 10 || ((x < 14 || x > 18) && y < 40));
    expect(rt.estimateSkyVisibility(16, 11, 16)!).toBeGreaterThanOrEqual(0.9);
  });

  it('a cave mouth (roof overhead, open sides) is partly lit', () => {
    // Thin roof slab 4m above, only over the player.
    const rt = world((x, y, z) => y < 10 || (y > 14 && y < 17 && Math.abs(x - 16) < 3 && Math.abs(z - 16) < 3));
    const v = rt.estimateSkyVisibility(16, 11, 16)!;
    expect(v).toBeGreaterThan(0.2);
    expect(v).toBeLessThanOrEqual(0.5);
  });

  it('a cave with a roof reads as enclosed', () => {
    const rt = world((_x, y) => y < 10 || (y > 16 && y < 40));
    expect(rt.estimateSkyVisibility(16, 11, 16)!).toBeLessThan(0.2);
  });

  it('under a floating island (roof overhead, open all around) is shade, not a cave', () => {
    const prev = BiomeManager.getWorldType();
    BiomeManager.setWorldType(WorldType.SKY_ISLANDS);
    try {
      // Standing on a small island with a wider island floating 6 m above.
      const rt = world((x, y, z) => (y < 10 && y > 6 && Math.abs(x - 16) < 3 && Math.abs(z - 16) < 3)
        || (y > 16 && y < 22 && Math.abs(x - 16) < 8 && Math.abs(z - 16) < 8));
      expect(rt.estimateSkyVisibility(16, 11, 16)!).toBeGreaterThan(0.6);
    } finally {
      BiomeManager.setWorldType(prev);
    }
  });

  it('rays leaving the top of the grid count as open sky', () => {
    const rt = world((_x, y) => y < gy(80) - PAD + MESH_Y_OFFSET);
    expect(rt.estimateSkyVisibility(16, 85, 16)).not.toBeNull();
  });
});
