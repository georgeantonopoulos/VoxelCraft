
import { metadataDB } from './MetadataDB';

export class SimulationManager {
    private worker: Worker;
    private onChunksUpdated?: (keys: string[]) => void;

    constructor() {
        // Initialize the simulation worker
        this.worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'CHUNKS_UPDATED') {
                // Payload is an array of { key, wetness, mossiness }
                const keys: string[] = [];

                payload.forEach((update: any) => {
                    const chunk = metadataDB.getChunk(update.key);
                    if (chunk) {
                        // Update the DB
                        // Direct Set is fast for typed arrays
                        chunk.wetness.set(update.wetness);
                        chunk.mossiness.set(update.mossiness);
                        keys.push(update.key);
                    }
                });

                // Trigger React update with batch
                if (this.onChunksUpdated && keys.length > 0) {
                    this.onChunksUpdated(keys);
                }
            }
        };
    }

    start() {
        this.worker.postMessage({ type: 'START_LOOP' });
    }

    setCallback(callback: (keys: string[]) => void) {
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
