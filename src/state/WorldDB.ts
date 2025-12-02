import Dexie, { Table } from 'dexie';
import { MaterialType } from '@/types';

// Defines the shape of a modification entry
export interface ChunkModification {
  id?: number; // Not used with composite key, but good to keep optional
  chunkId: string; // "cx,cz"
  voxelIndex: number; // Flat index in the chunk array
  material: MaterialType;
  density: number;
}

export class TheGroveDB extends Dexie {
  modifications!: Table<ChunkModification>;

  constructor() {
    super('TheGroveDB');

    // Version 1: Initial Schema
    this.version(1).stores({
      modifications: '++id, chunkId, voxelIndex'
    });

    // Version 2: Optimized Compound Index
    // [chunkId+voxelIndex] is the primary key (Composite)
    // We also keep chunkId index for fast fetching of all mods in a chunk
    this.version(2).stores({
      modifications: '[chunkId+voxelIndex], chunkId'
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

  // Optimized Upsert using put()
  // Because we defined [chunkId+voxelIndex] as the primary key in version(2),
  // .put() will automatically overwrite if an entry with the same cx,cz,voxelIndex exists.

  await worldDB.modifications.put({
    chunkId,
    voxelIndex,
    material,
    density
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
