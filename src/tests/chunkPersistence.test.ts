import { describe, it, expect, vi, beforeEach } from 'vitest';

const saved: Array<{ cx: number; cz: number; mods: Array<{ voxelIndex: number; density: number }> }> = [];
vi.mock('@/state/WorldDB', () => ({
  saveChunkModificationsBulk: vi.fn(async (cx: number, cz: number, mods: Array<{ voxelIndex: number; density: number }>) => {
    saved.push({ cx, cz, mods });
  }),
  getChunkModifications: vi.fn(async () => []),
}));

import { ChunkDataManager } from '@core/terrain/ChunkDataManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import type { ChunkState } from '@/types';

const makeChunk = (key: string, extra: Partial<ChunkState> = {}): ChunkState => ({
  key, cx: 1, cz: 2,
  density: new Float32Array(8).fill(1), material: new Uint8Array(8).fill(2),
  terrainVersion: 0, visualVersion: 0,
  ...extra,
} as unknown as ChunkState);

describe('ChunkDataManager persistence', () => {
  beforeEach(() => { saved.length = 0; vi.stubGlobal('window', globalThis); });

  it('persists dug voxels when markDirty receives their indices', async () => {
    const mgr = new ChunkDataManager();
    mgr.addChunk('1,2', makeChunk('1,2'));
    const chunk = mgr.getChunk('1,2')!;
    chunk.density[3] = -1;
    mgr.markDirty('1,2', [3]);
    await mgr.saveAllDirty();
    expect(saved).toHaveLength(1);
    expect(saved[0].mods).toEqual([expect.objectContaining({ voxelIndex: 3, density: -1 })]);
  });

  it('flushes pending edits on clear()', async () => {
    const mgr = new ChunkDataManager();
    mgr.addChunk('1,2', makeChunk('1,2'));
    mgr.markDirty('1,2', [5]);
    mgr.clear();
    await Promise.resolve();
    expect(saved.some((s) => s.mods.some((m) => m.voxelIndex === 5))).toBe(true);
  });

  it('merging regenerated data keeps player voxels but takes every derived field', () => {
    const mgr = new ChunkDataManager();
    mgr.addChunk('1,2', makeChunk('1,2'));
    mgr.getChunk('1,2')!.density[0] = -7;
    mgr.markDirty('1,2', [0]);

    const regenerated = makeChunk('1,2', {
      meshPositions: new Float32Array(30),
      meshLightColors: new Float32Array(30),
      terrainVersion: 0,
    } as Partial<ChunkState>);
    const canonical = mgr.addChunk('1,2', regenerated, true);
    expect(canonical.density[0]).toBe(-7);
    expect((canonical as unknown as { meshLightColors: Float32Array }).meshLightColors.length).toBe(30);
    expect(canonical.meshPositions!.length).toBe(30);
  });

  it('brushVoxelIndices covers every voxel modifyChunk can change', () => {
    const density = new Float32Array(36 * 132 * 36).fill(1);
    const material = new Uint8Array(density.length).fill(2);
    const before = density.slice();
    const point = { x: 10.3, y: 5.2, z: 20.7 };
    TerrainService.modifyChunk(density, material, undefined, point, 2.5, -3, material[0], 0, 0);
    const covered = new Set(TerrainService.brushVoxelIndices(point, 2.5));
    let changed = 0;
    for (let i = 0; i < density.length; i++) {
      if (density[i] !== before[i]) { changed++; expect(covered.has(i)).toBe(true); }
    }
    expect(changed).toBeGreaterThan(0);
  });
});
