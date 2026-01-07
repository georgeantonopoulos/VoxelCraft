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

// Ground item pickup entry - tracks which generated items have been picked up
export type GroundItemType = 'stick' | 'rock' | 'flora';
export interface GroundItemPickup {
  chunkId: string; // "cx,cz"
  itemType: GroundItemType;
  index: number; // Index in the source array (stickPositions, rockPositions, floraPositions)
}

export class TheGroveDB extends Dexie {
  modifications!: Table<ChunkModification>;
  groundPickups!: Table<GroundItemPickup>;

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

    // Version 3: Add ground item pickups table
    this.version(3).stores({
      modifications: '[chunkId+voxelIndex], chunkId',
      groundPickups: '[chunkId+itemType+index], chunkId'
    });
  }
}

// Singleton instance
export const worldDB = new TheGroveDB();

/**
 * Dexie cannot migrate primary key changes in-place. When we bump the schema to
 * use the composite `[chunkId+voxelIndex]` key, older IndexedDB instances throw
 * `UpgradeError: Not yet support for changing primary key` and close the DB.
 * To avoid endless errors in workers, we detect that upgrade failure once,
 * drop the database, and reopen with the new schema.
 */
async function ensureWorldDBReady(): Promise<void> {
  try {
    await worldDB.open();
  } catch (error) {
    const message = (error as { message?: string })?.message ?? '';
    const isPrimaryKeyChange =
      (error as { name?: string })?.name === 'UpgradeError' ||
      message.includes('primary key');

    if (isPrimaryKeyChange) {
      console.warn('[WorldDB] Resetting IndexedDB due to primary key upgrade', error);
      worldDB.close();
      await Dexie.delete(worldDB.name);
      await worldDB.open();
      return;
    }

    // Surface unexpected errors; caller-level handlers decide whether to continue.
    throw error;
  }
}

const worldDBReady = ensureWorldDBReady();

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
  await worldDBReady;

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
  await worldDBReady;

  const chunkId = `${cx},${cz}`;
  return await worldDB.modifications.where('chunkId').equals(chunkId).toArray();
}

/**
 * Bulk save modifications for a chunk.
 * More efficient than individual saves when persisting many changes.
 */
export async function saveChunkModificationsBulk(
  cx: number,
  cz: number,
  modifications: Array<{ voxelIndex: number; material: MaterialType; density: number }>
): Promise<void> {
  await worldDBReady;

  const chunkId = `${cx},${cz}`;
  const entries = modifications.map(mod => ({
    chunkId,
    voxelIndex: mod.voxelIndex,
    material: mod.material,
    density: mod.density
  }));

  // Use bulkPut for efficiency
  await worldDB.modifications.bulkPut(entries);
}

/**
 * Clear all modifications for a chunk.
 */
export async function clearChunkModifications(cx: number, cz: number): Promise<void> {
  await worldDBReady;

  const chunkId = `${cx},${cz}`;
  await worldDB.modifications.where('chunkId').equals(chunkId).delete();
}

// ============================================================================
// Ground Item Pickup Persistence
// ============================================================================

/**
 * Record a ground item pickup (stick, rock, or flora).
 */
export async function saveGroundPickup(
  cx: number,
  cz: number,
  itemType: GroundItemType,
  index: number
): Promise<void> {
  await worldDBReady;
  const chunkId = `${cx},${cz}`;
  await worldDB.groundPickups.put({ chunkId, itemType, index });
}

/**
 * Get all ground item pickups for a chunk.
 */
export async function getGroundPickups(cx: number, cz: number): Promise<GroundItemPickup[]> {
  await worldDBReady;
  const chunkId = `${cx},${cz}`;
  return await worldDB.groundPickups.where('chunkId').equals(chunkId).toArray();
}

/**
 * Clear all ground pickups for a chunk (e.g., world reset).
 */
export async function clearGroundPickups(cx: number, cz: number): Promise<void> {
  await worldDBReady;
  const chunkId = `${cx},${cz}`;
  await worldDB.groundPickups.where('chunkId').equals(chunkId).delete();
}
