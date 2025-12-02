import Dexie, { Table } from 'dexie';
import { MaterialType } from '@/types';

// Defines the shape of a modification entry
export interface ChunkModification {
  id?: number; // Auto-incrementing primary key
  chunkId: string; // "cx,cz"
  voxelIndex: number; // Flat index in the chunk array
  material: MaterialType;
  density: number;
}

export class TheGroveDB extends Dexie {
  modifications!: Table<ChunkModification>;

  constructor() {
    super('TheGroveDB');

    // Schema definition
    // "chunkId" is indexed for fast lookups by chunk
    this.version(1).stores({
      modifications: '++id, chunkId, voxelIndex'
    });
  }
}

// Singleton instance
export const worldDB = new TheGroveDB();

/**
 * Helper to save a modification.
 * Can be called from Main Thread (during interaction) or Worker (if architected that way).
 */
export async function saveModification(
  cx: number,
  cz: number,
  voxelIndex: number,
  material: MaterialType,
  density: number
) {
  const chunkId = `${cx},${cz}`;

  // Upsert logic: Check if exists, update or add
  // Since we don't have a composite key [chunkId+voxelIndex] defined in the store string above
  // (Dexie compound indices are complex to use for uniqueness constraints sometimes),
  // we can just query first.
  // Optimization: For a real game, a composite key index `[chunkId+voxelIndex]` is better.

  // Let's rely on finding by chunkId and filtering, or just adding.
  // If we just add, we might have duplicates.
  // Better: Check existence.

  await worldDB.transaction('rw', worldDB.modifications, async () => {
    const existing = await worldDB.modifications
      .where({ chunkId, voxelIndex })
      .first();

    if (existing) {
      await worldDB.modifications.update(existing.id!, { material, density });
    } else {
      await worldDB.modifications.add({
        chunkId,
        voxelIndex,
        material,
        density
      });
    }
  });
}

/**
 * Helper to retrieve all modifications for a chunk.
 * Designed to be called by the Web Worker.
 */
export async function getChunkModifications(cx: number, cz: number): Promise<ChunkModification[]> {
  const chunkId = `${cx},${cz}`;
  return await worldDB.modifications.where('chunkId').equals(chunkId).toArray();
}
