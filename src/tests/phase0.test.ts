import { describe, it, expect, afterEach } from 'vitest';
import { generateMesh } from '@features/terrain/logic/mesher';
import { generateLightGrid, getSkyLightConfig } from '@core/lighting/lightPropagation';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, GEN_VERSION } from '@/constants';
import { MaterialType } from '@/types';
import { makeWorldKey, scopedChunkId, setWorldKey, getWorldKey } from '@state/worldKey';

const SIZE = TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ;

describe('World-scoped persistence keys', () => {
  afterEach(() => setWorldKey(''));

  it('encodes seed, world type and generator version', () => {
    expect(makeWorldKey(42, 'DEFAULT')).toBe(`42:DEFAULT:g${GEN_VERSION}`);
    expect(makeWorldKey(42, 'DEFAULT', 7)).toBe('42:DEFAULT:g7');
  });

  it('never collides across worlds for the same chunk coordinates', () => {
    const a = scopedChunkId(3, -2, makeWorldKey(1, 'DEFAULT'));
    const b = scopedChunkId(3, -2, makeWorldKey(2, 'DEFAULT'));
    const c = scopedChunkId(3, -2, makeWorldKey(1, 'LUSH'));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('uses the active world key by default', () => {
    setWorldKey(makeWorldKey(9, 'FROZEN'));
    expect(getWorldKey()).toBe(`9:FROZEN:g${GEN_VERSION}`);
    expect(scopedChunkId(0, 0)).toBe(`9:FROZEN:g${GEN_VERSION}|0,0`);
  });
});

describe('Remesh relighting', () => {
  it('produces one light colour per vertex when a light grid is supplied', () => {
    // Flat ground with a dug pit: the shape REMESH sees after digging.
    const density = new Float32Array(SIZE);
    const material = new Uint8Array(SIZE);
    for (let z = 0; z < TOTAL_SIZE_XZ; z++) {
      for (let y = 0; y < TOTAL_SIZE_Y; y++) {
        for (let x = 0; x < TOTAL_SIZE_XZ; x++) {
          const idx = x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
          const pit = Math.hypot(x - 18, z - 18) < 4 && y > 40;
          const solid = y < 45 && !pit;
          density[idx] = solid ? 1 : -1;
          material[idx] = solid ? MaterialType.DIRT : MaterialType.AIR;
        }
      }
    }
    const lightGrid = generateLightGrid(density, [], getSkyLightConfig(0.5));
    const mesh = generateMesh(density, material, undefined, undefined, lightGrid);
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.lightColors.length).toBe(mesh.positions.length);
  });
});
