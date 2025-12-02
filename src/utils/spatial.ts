import { Vector3 } from 'three';

// 16 is the standard chunk size for voxel engines (matching Minecraft/industry standards).
// This creates buckets of 16x16x16 units.
export const CHUNK_SIZE = 16;

/**
 * Converts world coordinates to a unique string key "x:y:z"
 */
export const getChunkKey = (x: number, y: number, z: number): string => {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  return `${cx}:${cy}:${cz}`;
};

/**
 * Convenience wrapper for Vector3
 */
export const getChunkKeyFromPos = (pos: Vector3): string => {
  return getChunkKey(pos.x, pos.y, pos.z);
};

/**
 * Returns the keys of the center chunk and its 26 neighbors (3x3x3 grid).
 * Used for querying "everything nearby" without checking the whole world.
 */
export const getNeighborKeys = (centerKey: string): string[] => {
  const [cx, cy, cz] = centerKey.split(':').map(Number);
  const keys: string[] = [];

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        keys.push(`${cx + x}:${cy + y}:${cz + z}`);
      }
    }
  }
  return keys;
};
