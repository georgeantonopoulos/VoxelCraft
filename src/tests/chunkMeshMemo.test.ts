import { describe, it, expect } from 'vitest';
import { chunkMeshPropsEqual, type ChunkMeshProps } from '@features/terrain/components/ChunkMesh';
import type { ChunkState } from '@/types';

/**
 * Regression: chunks that stream in outside the collider radius get
 * colliderEnabled later. The memo comparison ignored that flip, so the chunk
 * never mounted its physics body and the player fell through visible ground.
 */
describe('ChunkMesh memo comparison', () => {
  const chunk = { key: '1,2', visualVersion: 0 } as unknown as ChunkState;
  const base: ChunkMeshProps = { chunk, terrainVersion: 3, lodLevel: 1, colliderEnabled: false };

  it('re-renders when the collider is switched on (same chunk object, same versions)', () => {
    expect(chunkMeshPropsEqual(base, { ...base, colliderEnabled: true })).toBe(false);
  });

  it('still skips re-renders when nothing relevant changed', () => {
    expect(chunkMeshPropsEqual(base, { ...base })).toBe(true);
  });
});
