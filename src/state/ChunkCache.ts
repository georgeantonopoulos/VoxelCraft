import Dexie, { Table } from 'dexie';

/**
 * Cache entry for a pristine procedural chunk.
 * Stores the results of worker generation (Density + Meshing) to avoid
 * re-running Surface Nets on revisits.
 */
export interface CachedChunk {
    id: string; // "cx,cz,worldType,version"
    cx: number;
    cz: number;
    worldType: string;
    version: number;

    // Terrain Mesh
    meshPositions: Float32Array;
    meshIndices: Uint32Array;
    meshNormals: Float32Array;
    meshMatWeightsA: Float32Array;
    meshMatWeightsB: Float32Array;
    meshMatWeightsC: Float32Array;
    meshMatWeightsD: Float32Array;
    meshWetness: Float32Array;
    meshMossiness: Float32Array;
    meshCavity: Float32Array;

    // Water Mesh
    meshWaterPositions: Float32Array;
    meshWaterIndices: Uint32Array;
    meshWaterNormals: Float32Array;
    meshWaterShoreMask: Uint8Array;

    // Raw Data (for persistence of pristine state)
    density: Float32Array;
    material: Uint8Array;

    // Entities & Vegetation (Full restoration)
    floraPositions?: Float32Array;
    treePositions?: Float32Array;
    rootHollowPositions?: Float32Array;
    stickPositions?: Float32Array;
    rockPositions?: Float32Array;
    largeRockPositions?: Float32Array;
    fireflyPositions?: Float32Array;

    // Processed layers
    drySticks?: Float32Array;
    jungleSticks?: Float32Array;
    rockDataBuckets?: Record<number, Float32Array>;
    vegetationData?: Record<number, Float32Array>;
    treeInstanceBatches?: any;

    // Hotspots (for fast interaction lookups)
    floraHotspots?: Float32Array;
    stickHotspots?: Float32Array;
    rockHotspots?: Float32Array;

    timestamp: number;
}

// BUMP THIS VERSION when chunk format/generation changes to invalidate old cache
export const CACHE_VERSION = 2; // Bumped to force regeneration after material fix

/**
 * Clear all cached chunks (for debugging)
 */
export async function clearAllCache(): Promise<void> {
    try {
        await chunkCacheDB.chunks.clear();
        console.log('[ChunkCache] All cached chunks cleared');
    } catch (err) {
        console.error('[ChunkCache] Clear failed:', err);
    }
}

export class ChunkCacheDB extends Dexie {
    chunks!: Table<CachedChunk>;

    constructor() {
        super('VoxelCraft_ChunkCache');
        this.version(1).stores({
            chunks: 'id, [cx+cz], worldType, version'
        });
    }
}

export const chunkCacheDB = new ChunkCacheDB();

/**
 * Helper to get a chunk from cache.
 */
export async function getCachedChunk(cx: number, cz: number, worldType: string, version: number): Promise<CachedChunk | undefined> {
    const id = `${cx},${cz},${worldType},${version}`;
    try {
        return await chunkCacheDB.chunks.get(id);
    } catch (err) {
        console.error('[ChunkCache] Get failed:', err);
        return undefined;
    }
}

/**
 * Helper to save a chunk to cache.
 */
export async function saveToCache(chunk: CachedChunk): Promise<void> {
    try {
        // Keep cache size manageable by pruning old entries if they get too large?
        // For now, simple put.
        await chunkCacheDB.chunks.put({
            ...chunk,
            timestamp: Date.now()
        });
    } catch (err) {
        console.warn('[ChunkCache] Save failed (likely storage limit):', err);
    }
}

/**
 * Clear old entries (e.g. if timestamp > 7 days)
 */
export async function pruneCache(): Promise<void> {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
        await chunkCacheDB.chunks.where('timestamp').below(weekAgo).delete();
    } catch (err) {
        console.error('[ChunkCache] Pruning failed:', err);
    }
}
