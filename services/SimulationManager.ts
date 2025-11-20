
import { metadataDB } from './MetadataDB';

export class SimulationManager {
    private worker: Worker;
    private onChunkUpdated?: (key: string) => void;

    constructor() {
        // Initialize the simulation worker
        this.worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });

        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'CHUNKS_UPDATED') {
                // Payload is an array of { key, wetness, mossiness }
                payload.forEach((update: any) => {
                    const chunk = metadataDB.getChunk(update.key);
                    if (chunk) {
                        // Update the DB
                        chunk.wetness.set(update.wetness);
                        chunk.mossiness.set(update.mossiness);

                        // Trigger React update
                        if (this.onChunkUpdated) {
                            this.onChunkUpdated(update.key);
                        }
                    }
                });
            }
        };
    }

    start() {
        this.worker.postMessage({ type: 'START_LOOP' });
    }

    setCallback(callback: (key: string) => void) {
        this.onChunkUpdated = callback;
    }

    addChunk(key: string, cx: number, cz: number, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array) {
        // We must copy arrays to transfer them, or just copy content?
        // For safety, we send copies or transferables.
        // Since we need to keep them in main thread for rendering too (actually meshing happens in another worker),
        // we can just send clones.
        this.worker.postMessage({
            type: 'ADD_CHUNK',
            payload: { key, cx, cz, material, wetness, mossiness }
        });
    }

    removeChunk(key: string) {
        this.worker.postMessage({ type: 'REMOVE_CHUNK', payload: { key } });
    }

    // We no longer tick manually from React loop, the worker handles it.
    // But we might want to update player position or something later.
}

export const simulationManager = new SimulationManager();
