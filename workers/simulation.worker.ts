
import { MATERIAL_PROPS, TOTAL_SIZE, CHUNK_SIZE, PAD } from '../constants';
import { MaterialType } from '../types';

// Minimal types for worker
interface WorkerChunkData {
    key: string;
    cx: number;
    cz: number;
    material: Uint8Array;
    wetness: Uint8Array;
    mossiness: Uint8Array;
}

const chunks: Map<string, WorkerChunkData> = new Map();
let activeKeys: Set<string> = new Set();

// BFS Queue Item
// Pack x,y,z,val into a single object or use parallel arrays for perf?
// Objects are fine for "Slow Tick" with limited spread radius.
interface QueueItem {
    wx: number;
    wy: number;
    wz: number;
    val: number;
}

// Global BFS Propagation
function propagateWetness() {
    const queue: QueueItem[] = [];
    const changedChunks = new Set<string>();

    // 1. Reset Phase & Source Collection
    // We iterate all chunks to clear old wetness and find sources.
    // This ensures consistency: if a source was removed, the water dries up.

    for (const key of activeKeys) {
        const chunk = chunks.get(key);
        if (!chunk) continue;

        const { material, wetness, cx, cz } = chunk;
        const size = TOTAL_SIZE;
        let chunkChanged = false;

        const start = PAD;
        const end = size - PAD;
        const worldOffsetX = cx * CHUNK_SIZE;
        const worldOffsetZ = cz * CHUNK_SIZE;

        for (let z = start; z < end; z++) {
            for (let y = start; y < end; y++) {
                for (let x = start; x < end; x++) {
                    const idx = x + y * size + z * size * size;
                    const mat = material[idx];

                    if (mat === MaterialType.WATER_SOURCE || mat === MaterialType.WATER_FLOWING) {
                        // Ensure source is max wetness
                        if (wetness[idx] !== 255) {
                            wetness[idx] = 255;
                            chunkChanged = true;
                        }
                        // Add to queue
                        queue.push({
                            wx: (x - PAD) + worldOffsetX,
                            wy: (y - PAD),
                            wz: (z - PAD) + worldOffsetZ,
                            val: 255
                        });
                    } else if (wetness[idx] > 0) {
                        // Reset non-source blocks to 0
                        // They will be re-wetted if near a source
                        wetness[idx] = 0;
                        chunkChanged = true;
                    }
                }
            }
        }
        if (chunkChanged) changedChunks.add(key);
    }

    // 2. BFS Propagation Phase
    // Decay Factor: Controls spread radius.
    // 0.4 -> ~4 blocks. 0.7 -> ~15 blocks.
    const DECAY_FACTOR = 0.4;
    const THRESHOLD = 5;

    // Neighbors offsets
    const offsets = [
        [1,0,0], [-1,0,0],
        [0,1,0], [0,-1,0],
        [0,0,1], [0,0,-1]
    ];

    let head = 0;
    while (head < queue.length) {
        const { wx, wy, wz, val } = queue[head++];

        const nextVal = Math.floor(val * DECAY_FACTOR);
        if (nextVal < THRESHOLD) continue;

        for (const [dx, dy, dz] of offsets) {
            const nwx = wx + dx;
            const nwy = wy + dy;
            const nwz = wz + dz;

            // Resolve Chunk
            const ncx = Math.floor(nwx / CHUNK_SIZE);
            const ncz = Math.floor(nwz / CHUNK_SIZE);
            const key = `${ncx},${ncz}`;

            const chunk = chunks.get(key);
            if (!chunk) continue; // Skip unloaded chunks

            // Resolve Local Index
            // Note: TerrainService uses PAD=2.
            const localX = Math.floor(nwx - ncx * CHUNK_SIZE) + PAD;
            const localY = Math.floor(nwy) + PAD;
            const localZ = Math.floor(nwz - ncz * CHUNK_SIZE) + PAD;

            if (localY < 0 || localY >= TOTAL_SIZE) continue;

            const idx = localX + localY * TOTAL_SIZE + localZ * TOTAL_SIZE * TOTAL_SIZE;

            // Check Material
            const mat = chunk.material[idx];
            if (mat === MaterialType.AIR || mat === MaterialType.WATER_SOURCE || mat === MaterialType.WATER_FLOWING) {
                continue; // Don't propagate into air or existing sources
            }
            // Optional: Check absorptionRate? If 0 (Bedrock?), maybe don't spread?
            // For now, assume all solid blocks can get wet surface.

            // Update Wetness
            // We use standard max logic: only update if new value is higher
            if (chunk.wetness[idx] < nextVal) {
                chunk.wetness[idx] = nextVal;
                changedChunks.add(key);

                // Add to queue for further spread
                queue.push({ wx: nwx, wy: nwy, wz: nwz, val: nextVal });
            }
        }
    }

    // 3. Moss Phase (Local)
    // Now that wetness is stable, update mossiness locally.
    // We only need to check chunks that are "active" or involved in simulation.
    // Iterating all active chunks is safer.
    for (const key of activeKeys) {
        const chunk = chunks.get(key);
        if (!chunk) continue;

        const { material, wetness, mossiness } = chunk;
        const size = TOTAL_SIZE;
        let chunkChanged = changedChunks.has(key);

        const start = PAD;
        const end = size - PAD;

        for (let z = start; z < end; z++) {
            for (let y = start; y < end; y++) {
                for (let x = start; x < end; x++) {
                    const idx = x + y * size + z * size * size;
                    const mat = material[idx];

                    if (mat === MaterialType.AIR) continue;

                    const props = MATERIAL_PROPS[mat] || MATERIAL_PROPS[MaterialType.DIRT];
                    let currentMoss = mossiness[idx];
                    const currentWet = wetness[idx];

                    if (mat === MaterialType.STONE || mat === MaterialType.BEDROCK || mat === MaterialType.MOSSY_STONE) {
                        const mossThresh = 50;
                        if (currentWet > mossThresh) {
                            currentMoss += props.mossGrowthRate;
                        } else {
                            currentMoss -= props.mossDecayRate;
                        }
                        currentMoss = Math.min(255, Math.max(0, currentMoss));
                    } else {
                         // Decay moss on dirt (grass logic handles green)
                        currentMoss -= 5;
                        currentMoss = Math.max(0, currentMoss);
                    }

                    if (currentMoss !== mossiness[idx]) {
                        mossiness[idx] = currentMoss;
                        chunkChanged = true;
                    }
                }
            }
        }

        if (chunkChanged) changedChunks.add(key);
    }

    return Array.from(changedChunks);
}

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'ADD_CHUNK') {
        const { key, cx, cz, material, wetness, mossiness } = payload;
        chunks.set(key, {
            key, cx, cz, material, wetness, mossiness
        });
        activeKeys.add(key);
    }
    else if (type === 'REMOVE_CHUNK') {
        const { key } = payload;
        chunks.delete(key);
        activeKeys.delete(key);
    }
    else if (type === 'START_LOOP') {
        // Start the interval
        setInterval(() => {
            const changedKeys = propagateWetness();

            if (changedKeys.length > 0) {
                const updates = changedKeys.map(key => {
                    const chunk = chunks.get(key);
                    return {
                        key: chunk!.key,
                        wetness: chunk!.wetness,
                        mossiness: chunk!.mossiness
                    };
                });
                self.postMessage({ type: 'CHUNKS_UPDATED', payload: updates });
            }
        }, 1000); // 1 second tick
    }
};
