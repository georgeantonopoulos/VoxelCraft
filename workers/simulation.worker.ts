// @ts-ignore
import { MATERIAL_PROPS, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, CHUNK_SIZE_XZ, PAD } from '../constants';
import { MaterialType } from '../types';

interface WorkerChunkData {
    key: string;
    cx: number;
    cz: number;
    material: Uint8Array;
    wetness: Uint8Array;
    mossiness: Uint8Array;
    nextMaterial?: Uint8Array; // Double buffer
}

const chunks: Map<string, WorkerChunkData> = new Map();
let activeKeys: Set<string> = new Set();
let playerCx = 0;
let playerCz = 0;
// @ts-ignore
let tickCount = 0;

// Dimensions
const SIZE_X = TOTAL_SIZE_XZ;
const SIZE_Y = TOTAL_SIZE_Y;
const SIZE_Z = TOTAL_SIZE_XZ;
const STRIDE_Y = SIZE_X;
const STRIDE_Z = SIZE_X * SIZE_Y;

const SIMULATION_DISTANCE = 2; // Only simulate chunks within 2 units of player

const getIdx = (x: number, y: number, z: number) => x + y * STRIDE_Y + z * STRIDE_Z;

// Helper to get chunk and local coords from global
const getGlobalBlock = (gx: number, gy: number, gz: number) => {
    const cx = Math.floor(gx / CHUNK_SIZE_XZ);
    const cz = Math.floor(gz / CHUNK_SIZE_XZ);
    const key = `${cx},${cz}`;
    const chunk = chunks.get(key);
    if (!chunk) return null;

    const lx = gx - cx * CHUNK_SIZE_XZ + PAD;
    const lz = gz - cz * CHUNK_SIZE_XZ + PAD;
    const ly = gy + PAD; // assuming gy is local grid Y (0..83)

    // Check bounds
    if (lx < 0 || lx >= SIZE_X || ly < 0 || ly >= SIZE_Y || lz < 0 || lz >= SIZE_Z) return null;

    return { chunk, idx: getIdx(lx, ly, lz) };
};

function simulateWater() {
    const changedChunks = new Set<string>();

    // Filter active keys based on player distance
    const simulationKeys: string[] = [];
    for (const key of activeKeys) {
        const chunk = chunks.get(key);
        if (chunk) {
            if (Math.abs(chunk.cx - playerCx) <= SIMULATION_DISTANCE && 
                Math.abs(chunk.cz - playerCz) <= SIMULATION_DISTANCE) {
                simulationKeys.push(key);
            }
        }
    }

    // 1. Initialize Next Buffer
    for (const key of simulationKeys) {
        const chunk = chunks.get(key);
        if (!chunk) continue;
        if (!chunk.nextMaterial) {
            chunk.nextMaterial = new Uint8Array(chunk.material.length);
        }
        chunk.nextMaterial.set(chunk.material);
    }

    // 2. Process Water Flow
    for (const key of simulationKeys) {
        const chunk = chunks.get(key);
        if (!chunk || !chunk.nextMaterial) continue;

        // @ts-ignore
        let chunkModified = false;

        // Scan bounds (excluding pad neighbors if possible to avoid double processing?
        // No, we process all, but only move FROM this chunk)
        const start = PAD;
        const endX = SIZE_X - PAD;
        const endY = SIZE_Y - PAD;
        const endZ = SIZE_Z - PAD;

        // Bottom-Up Iteration to prevent instant falling
        for (let y = start; y < endY; y++) {
            for (let z = start; z < endZ; z++) {
                for (let x = start; x < endX; x++) {
                    const idx = getIdx(x, y, z);

                    if (chunk.material[idx] === MaterialType.WATER) {
                        // Check logic
                        // Need Global Coords to handle neighbors
                        const gx = (x - PAD) + chunk.cx * CHUNK_SIZE_XZ;
                        const gy = (y - PAD); // 0-based grid Y
                        const gz = (z - PAD) + chunk.cz * CHUNK_SIZE_XZ;

                        let moved = false;

                        // Rule 1: Gravity (Down)
                        // Down is y-1
                        const down = getGlobalBlock(gx, gy - 1, gz);
                        if (down && down.chunk.nextMaterial) {
                             if (down.chunk.material[down.idx] === MaterialType.AIR &&
                                 down.chunk.nextMaterial[down.idx] === MaterialType.AIR) {

                                 // Move
                                 chunk.nextMaterial[idx] = MaterialType.AIR;
                                 down.chunk.nextMaterial[down.idx] = MaterialType.WATER;

                                 changedChunks.add(chunk.key);
                                 changedChunks.add(down.chunk.key);
                                 moved = true;
                             }
                        }

                        // Rule 2: Spread
                        if (!moved) {
                             const neighbors = [
                                 { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
                                 { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
                             ];
                             // Shuffle
                             for (let i = neighbors.length - 1; i > 0; i--) {
                                 const j = Math.floor(Math.random() * (i + 1));
                                 [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
                             }

                             for (const n of neighbors) {
                                 const target = getGlobalBlock(gx + n.dx, gy, gz + n.dz);
                                 if (target && target.chunk.nextMaterial) {
                                     // Check if AIR
                                     // Also check if BELOW target is solid (don't spread into mid-air like Wile E. Coyote)
                                     // Standard liquid spread requires support or it falls.
                                     // But if it falls next tick, that's fine.
                                     // However, usually water spreads only if it can't fall.
                                     // We already checked Gravity for 'current'.

                                     if (target.chunk.material[target.idx] === MaterialType.AIR &&
                                         target.chunk.nextMaterial[target.idx] === MaterialType.AIR) {

                                         // Move
                                         chunk.nextMaterial[idx] = MaterialType.AIR;
                                         target.chunk.nextMaterial[target.idx] = MaterialType.WATER;

                                         changedChunks.add(chunk.key);
                                         changedChunks.add(target.chunk.key);
                                         moved = true;
                                         break; // Only move to one
                                     }
                                 }
                             }
                        }
                    }
                }
            }
        }
    }

    // 3. Apply Changes
    for (const key of changedChunks) {
        const chunk = chunks.get(key);
        if (chunk && chunk.nextMaterial) {
            chunk.material.set(chunk.nextMaterial);
        }
    }

    return Array.from(changedChunks);
}

// Minimal wetness propagation
// @ts-ignore
function propagateWetness() {
    // Only run occasionally
    const changedChunks = new Set<string>();

    for (const key of activeKeys) {
        const chunk = chunks.get(key);
        if (!chunk) continue;

        let modified = false;
        // Simple local wetness: If next to WATER, wetness = 255. Else decay.
        // Full BFS is expensive. Let's do a simple neighbor check.
        // Actually, for Moss, we need wet stone.

        const start = PAD;
        const endX = SIZE_X - PAD;
        const endY = SIZE_Y - PAD;
        const endZ = SIZE_Z - PAD;

        for (let z = start; z < endZ; z++) {
            for (let y = start; y < endY; y++) {
                for (let x = start; x < endX; x++) {
                    const idx = getIdx(x, y, z);
                    const mat = chunk.material[idx];

                    if (mat === MaterialType.WATER) {
                        if (chunk.wetness[idx] !== 255) {
                            chunk.wetness[idx] = 255;
                            modified = true;
                        }
                    } else if (mat !== MaterialType.AIR) {
                        // Check neighbors for water
                        // This is a slow "seeping" effect
                        if (Math.random() < 0.01) { // 1% chance per tick to update wetness to save perf
                             // ... logic omitted for speed, just decay for now
                             if (chunk.wetness[idx] > 0) {
                                 chunk.wetness[idx] = Math.max(0, chunk.wetness[idx] - 2);
                                 modified = true;
                             }
                        }
                    }
                }
            }
        }
        if (modified) changedChunks.add(key);
    }
    return Array.from(changedChunks);
}

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'ADD_CHUNK') {
        const { key, cx, cz, material, wetness, mossiness } = payload;
        chunks.set(key, { key, cx, cz, material, wetness, mossiness });
        activeKeys.add(key);
    }
    else if (type === 'REMOVE_CHUNK') {
        const { key } = payload;
        chunks.delete(key);
        activeKeys.delete(key);
    }
    else if (type === 'PLAYER_POSITION') {
        const { cx, cz } = payload;
        playerCx = cx;
        playerCz = cz;
    }
    else if (type === 'START_LOOP') {
        setInterval(() => {
            // @ts-ignore
            const start = performance.now();
            const waterUpdates = simulateWater();

            // Only update wetness occasionally
            // tickCount++;
            // if (tickCount % 10 === 0) propagateWetness();

            if (waterUpdates.length > 0) {
                const updates = waterUpdates.map(key => {
                    const chunk = chunks.get(key);
                    return {
                        key: chunk!.key,
                        material: chunk!.material, // Send material back!
                        wetness: chunk!.wetness,
                        mossiness: chunk!.mossiness
                    };
                });
                self.postMessage({ type: 'CHUNKS_UPDATED', payload: updates });
            }

            // Debug perf
            // const dur = performance.now() - start;
            // if (dur > 20) console.log('Sim took', dur);

        }, 1000); // 1000ms = 1fps (Slowed down from 10fps to fix flashing)
    }
};
