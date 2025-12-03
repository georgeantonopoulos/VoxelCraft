
import { metadataDB } from '@state/MetadataDB';
import { CHUNK_SIZE_XZ } from '@/constants';

export interface SimUpdate {
    key: string;
    material: Uint8Array;
    wetness: Uint8Array;
    mossiness: Uint8Array;
}

export class SimulationManager {
    private worker: Worker;
    private onChunksUpdated?: (updates: SimUpdate[]) => void;

    constructor() {
        this.worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'CHUNKS_UPDATED') {
                const updates = payload as SimUpdate[];

                // Update MetadataDB
                updates.forEach(update => {
                    const chunk = metadataDB.getChunk(update.key);
                    if (chunk) {
                        if (chunk.wetness) chunk.wetness.set(update.wetness);
                        if (chunk.mossiness) chunk.mossiness.set(update.mossiness);
                    }
                });

                // Notify UI/Terrain
                if (this.onChunksUpdated) {
                    this.onChunksUpdated(updates);
                }
            }
        };
    }

    start() {
        this.worker.postMessage({ type: 'START_LOOP' });
    }

    setCallback(callback: (updates: SimUpdate[]) => void) {
        this.onChunksUpdated = callback;
    }

    addChunk(key: string, cx: number, cz: number, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array) {
        this.worker.postMessage({
            type: 'ADD_CHUNK',
            payload: { key, cx, cz, material, wetness, mossiness }
        });
    }

    removeChunk(key: string) {
        this.worker.postMessage({ type: 'REMOVE_CHUNK', payload: { key } });
    }

    updatePlayerPosition(cx: number, cz: number) {
        this.worker.postMessage({ type: 'PLAYER_POSITION', payload: { cx, cz } });
    }

    /**
     * Synchronously queries the main-thread MetadataDB for environment data.
     * Use this in the Player loop.
     */
    getMetadataAt(wx: number, wy: number, wz: number): { wetness: number, mossiness: number } {
        const cx = Math.floor(wx / CHUNK_SIZE_XZ);
        const cz = Math.floor(wz / CHUNK_SIZE_XZ);
        const key = `${cx},${cz}`;

        const chunk = metadataDB.getChunk(key);
        if (!chunk || !chunk.wetness || !chunk.mossiness) return { wetness: 0, mossiness: 0 };

        const lx = Math.floor(wx - cx * CHUNK_SIZE_XZ);
        const lz = Math.floor(wz - cz * CHUNK_SIZE_XZ);
        const ly = Math.floor(wy); // Should align with how data is stored?
        // MetadataDB is column-based or voxel-based?
        // metadataDB in `src/state/MetadataDB` typically mirrors the `Uint8Array` structure.
        // Assuming 1D array by index.

        // Wait, `TerrainService` creates wetness as `sizeX * sizeY * sizeZ`.
        // So we need full coordinates.
        const SIZE_X = CHUNK_SIZE_XZ; // Technically TOTAL_SIZE_XZ if padded, but metadataDB usually stores the logical chunk?
        // Let's check `metadataDB` usage.
        // `terrain.worker.ts` sends `metadata` which is `sizeX * sizeY * sizeZ` (padded).
        // If metadataDB stores the raw array from the worker, it is padded size.

        const PAD = 2;
        const TOTAL_SIZE_XZ = CHUNK_SIZE_XZ + PAD * 2;
        const TOTAL_SIZE_Y = 80; // from constants

        // Local coordinates relative to padded grid
        const px = lx + PAD;
        const pz = lz + PAD;

        // Y offset? `TerrainService` wy = (y - PAD) + MESH_Y_OFFSET
        // so y = wy - MESH_Y_OFFSET + PAD
        const MESH_Y_OFFSET = -35;
        const py = Math.floor(wy - MESH_Y_OFFSET + PAD);

        if (px < 0 || px >= TOTAL_SIZE_XZ || pz < 0 || pz >= TOTAL_SIZE_XZ || py < 0 || py >= TOTAL_SIZE_Y) {
            return { wetness: 0, mossiness: 0 };
        }

        const idx = px + py * TOTAL_SIZE_XZ + pz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;

        // Check bounds
        if (idx >= 0 && idx < chunk.wetness.length) {
            return {
                wetness: chunk.wetness[idx] / 255.0,
                mossiness: chunk.mossiness[idx] / 255.0
            };
        }

        return { wetness: 0, mossiness: 0 };
    }
}

export const simulationManager = new SimulationManager();
