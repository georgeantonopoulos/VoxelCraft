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

    // Flora/Items Hotspots (to avoid re-sampling)
    floraHotspots?: any;
    stickHotspots?: any;
    rockHotspots?: any;
    fireflyPositions?: Float32Array;
    treeInstanceBatches?: any;

    timestamp: number;
}

export const CACHE_VERSION = 1;

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
