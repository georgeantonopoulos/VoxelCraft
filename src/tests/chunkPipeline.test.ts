import { describe, it, expect, beforeAll } from 'vitest';
import { buildGeneratedChunk, buildRemeshedChunk } from '@features/terrain/logic/chunkPipeline';
import { BiomeManager, WorldType } from '@features/terrain/logic/BiomeManager';
import { initializeNoise } from '@core/math/noise';

let gen: Record<string, any>;
beforeAll(() => {
  BiomeManager.reinitialize(1337);
  initializeNoise(1337);
  BiomeManager.setWorldType(WorldType.DEFAULT);
  gen = buildGeneratedChunk(0, 0, [], []).payload as Record<string, any>;
}, 60_000);

const remesh = (materialOnly: boolean) => buildRemeshedChunk({
  key: '0,0', cx: 0, cz: 0, version: 1, materialOnly,
  density: gen.density.slice(), material: gen.material.slice(),
  wetness: gen.metadata.wetness, mossiness: gen.metadata.mossiness,
  floraPositions: gen.floraPositions,
}, []).payload as Record<string, any>;

describe('Chunk pipeline', () => {
  it('GENERATE produces a mesh with per-vertex light and grass textures', () => {
    expect(gen.meshPositions.length).toBeGreaterThan(0);
    expect(gen.meshLightColors.length).toBe(gen.meshPositions.length);
    expect(gen.grassHeightTex.length).toBe(32 * 32);
    expect(gen.lightGrid).toBeInstanceOf(Uint8Array);
  });

  it('shape REMESH rebuilds light grid, colliders and grass textures', () => {
    const r = remesh(false);
    expect(r.meshLightColors.length).toBe(r.meshPositions.length);
    expect(r.lightGrid).toBeInstanceOf(Uint8Array);
    expect(r.grassHeightTex).toBeInstanceOf(Float32Array);
    expect(r.colliderPositions ?? r.colliderHeightfield).toBeDefined();
  });

  it('material-only REMESH keeps shape-derived data (no collider, grass or light grid)', () => {
    const r = remesh(true);
    expect(r.materialOnly).toBe(true);
    expect(r.meshLightColors.length).toBe(r.meshPositions.length);
    for (const k of ['lightGrid', 'grassHeightTex', 'colliderPositions', 'colliderHeightfield', 'isHeightfield']) {
      expect(k in r).toBe(false);
    }
  });
});
