
import { metadataDB } from './MetadataDB';

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
}

export const simulationManager = new SimulationManager();
