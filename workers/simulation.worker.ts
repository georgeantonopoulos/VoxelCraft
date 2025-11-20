
import { MATERIAL_PROPS, TOTAL_SIZE, CHUNK_SIZE, PAD } from '../constants';
import { MaterialType } from '../types';

// We duplicate the minimal types needed for the worker to avoid heavy imports if any
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

// Helper: Get neighbor value from global map if needed
// Optimization: We only use this for chunk borders
function getGlobalWetness(wx: number, wy: number, wz: number): number {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = `${cx},${cz}`;

    const chunk = chunks.get(key);
    if (!chunk) return 0;

    // Map global to local padded index
    const localX = Math.floor(wx - cx * CHUNK_SIZE) + PAD;
    const localY = Math.floor(wy) + PAD;
    const localZ = Math.floor(wz - cz * CHUNK_SIZE) + PAD;

    if (localY < 0 || localY >= TOTAL_SIZE) return 0;

    const idx = localX + localY * TOTAL_SIZE + localZ * TOTAL_SIZE * TOTAL_SIZE;
    return chunk.wetness[idx];
}

function simulateChunk(chunk: WorkerChunkData): boolean {
    const { material, wetness, mossiness, cx, cz } = chunk;
    const size = TOTAL_SIZE;
    let anyChanged = false;

    const newWetness = new Uint8Array(wetness);
    const newMossiness = new Uint8Array(mossiness);

    const start = PAD;
    const end = size - PAD;

    const worldOffsetX = cx * CHUNK_SIZE;
    const worldOffsetZ = cz * CHUNK_SIZE;

    for (let z = start; z < end; z++) {
        for (let y = start; y < end; y++) {
            for (let x = start; x < end; x++) {
                const idx = x + y * size + z * size * size;
                const mat = material[idx];

                if (mat === MaterialType.AIR) {
                    if (newWetness[idx] !== 0) {
                        newWetness[idx] = 0;
                        anyChanged = true;
                    }
                    continue;
                }

                const props = MATERIAL_PROPS[mat] || MATERIAL_PROPS[MaterialType.DIRT];

                // --- Neighbor Wetness Check ---
                let maxNeighborWetness = 0;

                // Helper to read neighbor
                const check = (dx: number, dy: number, dz: number) => {
                    const nx = x + dx;
                    const ny = y + dy;
                    const nz = z + dz;

                    let val = 0;
                    const isCrossChunk = (nx < PAD || nx >= size - PAD || nz < PAD || nz >= size - PAD);

                    if (isCrossChunk) {
                        const wx = (nx - PAD) + worldOffsetX;
                        const wy = (ny - PAD);
                        const wz = (nz - PAD) + worldOffsetZ;
                        val = getGlobalWetness(wx, wy, wz);
                    } else {
                        val = wetness[nx + ny * size + nz * size * size];
                    }

                    if (val > maxNeighborWetness) maxNeighborWetness = val;
                };

                check(1,0,0);
                check(-1,0,0);
                check(0,1,0);
                check(0,-1,0);
                check(0,0,1);
                check(0,0,-1);

                // --- Simulation Logic ---
                let currentWet = wetness[idx];
                let currentMoss = mossiness[idx];

                if (mat === MaterialType.WATER_SOURCE || mat === MaterialType.WATER_FLOWING) {
                    newWetness[idx] = 255;
                } else {
                    // Exponential decay instead of linear subtraction
                    // This mimics 1/n^2 drop-off (strong reaction near source, weak further away)
                    // Decay factor 0.7 means 30% loss per step.
                    // 255 -> 178 -> 125 -> 87 -> 61 -> 42 -> 30 -> 21...

                    const decayFactor = 0.7;
                    const targetWet = Math.floor(maxNeighborWetness * decayFactor);

                    // Also apply absorption rate logic
                    if (targetWet > currentWet) {
                        currentWet += props.absorptionRate;
                    } else {
                        currentWet -= props.dryingRate;
                    }
                    newWetness[idx] = Math.min(255, Math.max(0, currentWet));
                }

                // Moss Logic
                if (mat === MaterialType.STONE || mat === MaterialType.BEDROCK || mat === MaterialType.MOSSY_STONE) {
                    const mossThresh = 50;
                    if (newWetness[idx] > mossThresh) {
                        currentMoss += props.mossGrowthRate;
                    } else {
                        currentMoss -= props.mossDecayRate;
                    }
                    newMossiness[idx] = Math.min(255, Math.max(0, currentMoss));
                } else {
                    currentMoss -= 5;
                    newMossiness[idx] = Math.max(0, currentMoss);
                }
            }
        }
    }

    // Check changes
    for (let i = 0; i < wetness.length; i++) {
        if (wetness[i] !== newWetness[i] || mossiness[i] !== newMossiness[i]) {
            anyChanged = true;
            break;
        }
    }

    if (anyChanged) {
        chunk.wetness = newWetness;
        chunk.mossiness = newMossiness;
        return true;
    }
    return false;
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
            const updates: any[] = [];

            for (const key of activeKeys) {
                const chunk = chunks.get(key);
                if (chunk) {
                    const changed = simulateChunk(chunk);
                    if (changed) {
                        updates.push({
                            key: chunk.key,
                            wetness: chunk.wetness,
                            mossiness: chunk.mossiness
                        });
                    }
                }
            }

            if (updates.length > 0) {
                self.postMessage({ type: 'CHUNKS_UPDATED', payload: updates });
            }

        }, 1000); // 1 second tick
    }
};
