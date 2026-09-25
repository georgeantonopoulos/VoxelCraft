import { GEN_VERSION } from '@/constants';

/**
 * Identifies one generated world: seed + world type + generator version.
 * Persisted chunk data is namespaced by this key so edits made in one world
 * never leak into another world that happens to share chunk coordinates.
 */
export const makeWorldKey = (seed: number, worldType: string, genVersion: number = GEN_VERSION): string =>
  `${seed}:${worldType}:g${genVersion}`;

/**
 * Active world key for this JS context. The main thread and each terrain
 * worker hold their own copy (set from VoxelTerrain / the CONFIGURE message).
 * Empty string = legacy un-scoped ids (only before a world is configured).
 */
let activeWorldKey = '';

export const setWorldKey = (key: string): void => {
  activeWorldKey = key;
};

export const getWorldKey = (): string => activeWorldKey;

/** Storage id for a chunk in the active world. */
export const scopedChunkId = (cx: number, cz: number, worldKey: string = activeWorldKey): string =>
  worldKey ? `${worldKey}|${cx},${cz}` : `${cx},${cz}`;
