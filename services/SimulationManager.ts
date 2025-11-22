
import { metadataDB } from './MetadataDB';

export interface SimUpdate {
    key: string;
    wetness: Uint8Array;
    mossiness: Uint8Array;
    material: Uint8Array;
}

export class SimulationManager {
    private worker: Worker;
    private onChunksUpdated?: (updates: SimUpdate[]) => void;

    constructor() {
        // Initialize the simulation worker
        this.worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'CHUNKS_UPDATED') {
                // Payload is an array of { key, wetness, mossiness, material }
                const updates: SimUpdate[] = [];

                payload.forEach((update: any) => {
                    const chunk = metadataDB.getChunk(update.key);
                    if (chunk) {
                        // Update the DB
                        // Direct Set is fast for typed arrays
                        chunk.wetness.set(update.wetness);
                        chunk.mossiness.set(update.mossiness);
                        
                        updates.push({
                            key: update.key,
                            wetness: update.wetness,
                            mossiness: update.mossiness,
                            material: update.material
                        });
                    }
                });

                // Trigger React update with batch
                if (this.onChunksUpdated && updates.length > 0) {
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
}

export const simulationManager = new SimulationManager();
