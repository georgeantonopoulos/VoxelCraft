import { describe, expect, it } from 'vitest';
import { TerrainRuntime } from '@/features/terrain/logic/TerrainRuntime';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET } from '@/constants';

const size = TOTAL_SIZE_XZ * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
const queryOptions = { maxDistance: 32, step: 1 };
function makeRuntime(roofY?: number) {
  const runtime = new TerrainRuntime();
  const density = new Float32Array(size);
  if (roofY !== undefined) {
    const y = roofY - MESH_Y_OFFSET + PAD;
    for (let z = 0; z < TOTAL_SIZE_XZ; z++) {
      for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
        density[x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y] = 1;
      }
    }
  }
  runtime.registerChunk('0,0', 0, 0, density, new Uint8Array(size));
  return runtime;
}

describe('sky-fill occlusion queries', () => {
  it('keeps an open surface fully lit', () => {
    expect(makeRuntime().estimateSkyVisibility(16, 20, 16, queryOptions)).toBe(1);
  });
  it('detects a nearby cave ceiling', () => {
    expect(makeRuntime(23).estimateSkyVisibility(16, 20, 16, queryOptions)).toBeLessThan(0.2);
  });
  it('treats rays leaving the top of the voxel world as open sky', () => {
    expect(makeRuntime().estimateSkyVisibility(16, 90, 16, queryOptions)).toBe(1);
  });
  it('retains unknown state for unloaded horizontal chunks', () => {
    expect(new TerrainRuntime().estimateSkyVisibility(16, 20, 16, queryOptions)).toBeNull();
  });
});
