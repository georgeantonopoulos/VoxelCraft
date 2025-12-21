
import { metadataDB } from '@state/MetadataDB';

export interface SimUpdate {
    key: string;
    material: Uint8Array;
    wetness: Uint8Array;
    mossiness: Uint8Array;
}

export class SimulationManager {
    private worker: Worker | null = null;
    private enabled: boolean;
    private onChunksUpdated?: (updates: SimUpdate[]) => void;

    constructor() {
        // Simulation is currently opt-in because the worker loop is intentionally disabled
        // (see `src/features/flora/workers/simulation.worker.ts` keyword: "Loop paused").
        // Importantly, posting per-chunk voxel arrays to a worker triggers structured cloning
        // and can cause noticeable hitches during terrain streaming.
        this.enabled = (() => {
            if (typeof window === 'undefined') return false;
            // Default to true for Phase 3 verification
            return true;
        })();

        if (!this.enabled) return;

        this.worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            // Defensive check - workers may send null messages when crashed/memory exhausted
            if (!e.data) return;
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
        if (!this.worker) return;
        this.worker.postMessage({ type: 'START_LOOP' });
    }

    setCallback(callback: (updates: SimUpdate[]) => void) {
        this.onChunksUpdated = callback;
    }

    addChunk(key: string, cx: number, cz: number, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array) {
        if (!this.worker) return;
        this.worker.postMessage({
            type: 'ADD_CHUNK',
            payload: { key, cx, cz, material, wetness, mossiness }
        });
    }

    removeChunk(key: string) {
        if (!this.worker) return;
        this.worker.postMessage({ type: 'REMOVE_CHUNK', payload: { key } });
    }

    updatePlayerPosition(cx: number, cz: number) {
        if (!this.worker) return;
        this.worker.postMessage({ type: 'PLAYER_POSITION', payload: { cx, cz } });
    }
}

export const simulationManager = new SimulationManager();
