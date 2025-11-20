
import { ChunkMetadata, MaterialType, Vector3 } from '../types';
import { metadataDB } from './MetadataDB';
import { MATERIAL_PROPS, TOTAL_SIZE, CHUNK_SIZE, PAD } from '../constants';

export class SimulationManager {
    private activeChunks: Set<string> = new Set();
    private processing = false;
    private lastTickTime = 0;
    private tickInterval = 1000; // 1 second slow tick

    // Called by React component to update active set
    updateActiveChunks(keys: string[]) {
        this.activeChunks = new Set(keys);
    }

    // The main tick function
    tick(currentTime: number, chunks: Record<string, any>, onChunkUpdated: (key: string) => void) {
        if (this.processing) return;
        if (currentTime - this.lastTickTime < this.tickInterval) return;

        this.processing = true;
        this.lastTickTime = currentTime;

        const startTime = performance.now();

        // Process all active chunks
        // Note: In a real heavy app, we'd spread this over multiple frames or use a worker.
        // For Phase 1, we run it synchronously but only on active chunks.

        for (const key of this.activeChunks) {
            const chunk = chunks[key];
            if (!chunk) continue;

            // We need the materials to decide behavior
            const materials = chunk.material;
            if (!materials) continue;

            // Fetch metadata wrapper from DB
            // If it's not in DB yet (first load), we might need to ensure it's there.
            // VoxelTerrain should register chunks to DB upon generation.
            // Assuming VoxelTerrain does that.

            const metadata = metadataDB.getChunk(key);
            if (!metadata) continue; // Skip if not ready

            const wetness = metadata['wetness'];
            const mossiness = metadata['mossiness'];

            if (!wetness || !mossiness) continue;

            let anyChanged = false;
            const size = TOTAL_SIZE;

            // We iterate internal part of chunk (skipping padding for calculation source, but we check neighbors)
            // Actually, we should update the whole padded area if we own it, or just the visible area?
            // The padded area (PAD=2) is "owned" by this chunk's array but represents world space neighbors.
            // Ideally, we only simulate the core 32x32x32 and let neighbors simulate themselves.
            // However, our `wetness` array has the padding.

            const start = PAD;
            const end = size - PAD;

            // We'll use a temporary buffer for the new state to avoid order-dependency artifacts (Cellular Automata standard)
            // But for performance in JS, direct mutation is faster.
            // "Slow Tick" implies artifacts are less visible than 60fps fluid sim.
            // We'll do direct mutation for now, or a copy if needed.
            // Let's copy to avoid "gliding" wetness in one scan direction.
            const newWetness = new Uint8Array(wetness);
            const newMossiness = new Uint8Array(mossiness);

            for (let z = start; z < end; z++) {
                for (let y = start; y < end; y++) {
                    for (let x = start; x < end; x++) {
                        const idx = x + y * size + z * size * size;
                        const mat = materials[idx];

                        // Skip Air? Air can't hold wetness (unless it's rain/fog, but let's stick to blocks)
                        if (mat === MaterialType.AIR) {
                            newWetness[idx] = 0;
                            continue;
                        }

                        const props = MATERIAL_PROPS[mat] || MATERIAL_PROPS[MaterialType.DIRT];

                        // 1. Get Max Neighbor Wetness (using global lookup for borders)
                        // To support cross-chunk, we need world coordinates for neighbors *if* we are at the edge.
                        // Optimization: Only call getGlobal if x/y/z is at the boundary.

                        // Wait, we are iterating `start` to `end` (2 to 34).
                        // Local neighbors (x-1, x+1) are safely within 0..36 array bounds.
                        // BUT, the values at 0,1 and 34,35 in THIS array are "ghosts" from generation time
                        // and might be stale if the neighbor chunk updated.
                        // So strictly speaking, we should read neighbors from the DB using getGlobal for ANY neighbor check
                        // to ensure we see the latest state of the adjacent chunk.

                        // However, `getGlobal` is expensive (map lookup + floor).
                        // Phase 1 optimization: Use the local array, but strictly rely on `sync`?
                        // "We need neighboring voxel behavior... signal surrounding voxels".

                        // Let's try using `metadataDB.getGlobal` for the 6 neighbors.
                        // We need world coordinates for that.

                        const wx = (x - PAD) + (chunk.cx * CHUNK_SIZE);
                        const wy = (y - PAD); // y is uniform? No, chunks are columns.
                        // In TerrainService: `const wy = (y - PAD);`
                        const wz = (z - PAD) + (chunk.cz * CHUNK_SIZE);

                        let maxNeighborWetness = 0;

                        const checkNeighbor = (dx: number, dy: number, dz: number) => {
                            // If inside core bounds, use local array (fastest)?
                            // Only if we trust the padding is updated.
                            // Padding is NOT updated automatically.
                            // So we MUST use getGlobal for neighbors, OR we explicitly sync padding.
                            // Using getGlobal is safer for correctness now.

                            const val = metadataDB.getGlobal(wx + dx, wy + dy, wz + dz, 'wetness');
                            if (val > maxNeighborWetness) maxNeighborWetness = val;
                        };

                        checkNeighbor(1, 0, 0);
                        checkNeighbor(-1, 0, 0);
                        checkNeighbor(0, 1, 0);
                        checkNeighbor(0, -1, 0);
                        checkNeighbor(0, 0, 1);
                        checkNeighbor(0, 0, -1);

                        // Logic from original worker
                        let currentWet = wetness[idx];
                        let currentMoss = mossiness[idx];

                        if (mat === MaterialType.WATER_SOURCE || mat === MaterialType.WATER_FLOWING) {
                            newWetness[idx] = 255;
                        } else {
                            // Absorb from neighbors
                            // Threshold: neighbor must be somewhat wet to share
                            const targetWet = Math.max(0, maxNeighborWetness - 10);

                            if (targetWet > currentWet) {
                                currentWet += props.absorptionRate;
                            } else {
                                currentWet -= props.dryingRate;
                            }

                            newWetness[idx] = Math.min(255, Math.max(0, currentWet));
                        }

                        // Moss Logic
                        // Bedrock/Stone grows moss if wet
                        if (mat === MaterialType.STONE || mat === MaterialType.BEDROCK || mat === MaterialType.MOSSY_STONE) {
                             // If it's already Mossy Stone, it stays mossy unless very dry?
                             // Or we treat Mossy Stone purely visual and drive it by `mossiness` layer?
                             // The renderer uses `mossiness` attribute.

                             const mossThresh = 50;
                             if (newWetness[idx] > mossThresh) {
                                 currentMoss += props.mossGrowthRate;
                             } else {
                                 currentMoss -= props.mossDecayRate;
                             }
                             newMossiness[idx] = Math.min(255, Math.max(0, currentMoss));
                        } else {
                            // Dirt/Sand doesn't grow moss in this logic (it grows grass usually)
                            currentMoss -= 5;
                            newMossiness[idx] = Math.max(0, currentMoss);
                        }
                    }
                }
            }

            // Detect changes
            // simple byte comparison might be slow for entire chunk, assume change if active?
            // Let's check diff.
            for (let i = 0; i < wetness.length; i++) {
                if (wetness[i] !== newWetness[i] || mossiness[i] !== newMossiness[i]) {
                    anyChanged = true;
                    break;
                }
            }

            if (anyChanged) {
                // Commit back to original arrays (or replace them)
                // We replace them in the DB
                metadata['wetness'].set(newWetness);
                metadata['mossiness'].set(newMossiness);

                onChunkUpdated(key);
            }
        }

        this.processing = false;
        const elapsed = performance.now() - startTime;
        if (elapsed > 10) {
            // console.warn(`Simulation tick took ${elapsed.toFixed(2)}ms`);
        }
    }
}

export const simulationManager = new SimulationManager();
