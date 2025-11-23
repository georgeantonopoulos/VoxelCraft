import { PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y } from '../constants';
import { BlockType } from '../types';
import { to1D } from '../utils/chunkUtils';

type ChunkMap = Record<string, { cx: number, cz: number, material: Uint8Array }>;

export const FluidSystem = {
  tick: (chunks: ChunkMap): Set<string> => {
    const modifiedChunks = new Set<string>();
    const updates = new Map<string, Map<number, number>>();

    // Helper to schedule update
    const setUpdate = (key: string, idx: number, val: number) => {
        let u = updates.get(key);
        if (!u) {
            u = new Map();
            updates.set(key, u);
        }
        u.set(idx, val);
    };

    for (const key in chunks) {
        const chunk = chunks[key];
        const mat = chunk.material;

        // Randomize iteration order? Or standard.
        // Standard scan.
        for (let y = PAD; y < TOTAL_SIZE_Y - PAD; y++) {
            for (let z = PAD; z < TOTAL_SIZE_XZ - PAD; z++) {
                for (let x = PAD; x < TOTAL_SIZE_XZ - PAD; x++) {
                    const idx = to1D(x, y, z);
                    const type = mat[idx];

                    if (type === BlockType.WATER) {
                        // 1. Try Move Down
                        const downIdx = to1D(x, y - 1, z);
                        const downType = mat[downIdx];

                        // Check if we already scheduled an update for downIdx?
                        // Simplified: Read from current state 'mat'.

                        if (downType === BlockType.AIR) {
                            // Move down (Source -> Air, Dest -> Water)
                            setUpdate(key, idx, BlockType.AIR);
                            setUpdate(key, downIdx, BlockType.WATER);
                        } else if (downType !== BlockType.AIR && downType !== BlockType.WATER) {
                            // 2. Spread Sides (if blocked below)
                            const neighbors = [
                                { dx: 1, dz: 0 }, { dx: -1, dz: 0 },
                                { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
                            ];

                            for (const n of neighbors) {
                                const nx = x + n.dx;
                                const nz = z + n.dz;
                                if (nx >= 0 && nx < TOTAL_SIZE_XZ && nz >= 0 && nz < TOTAL_SIZE_XZ) {
                                    const nIdx = to1D(nx, y, nz);
                                    if (mat[nIdx] === BlockType.AIR) {
                                        setUpdate(key, nIdx, BlockType.WATER);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Apply updates
    updates.forEach((u, key) => {
        const chunk = chunks[key];
        if (chunk && u.size > 0) {
            let changed = false;
            u.forEach((val, idx) => {
                if (chunk.material[idx] !== val) {
                    chunk.material[idx] = val;
                    changed = true;
                }
            });
            if (changed) modifiedChunks.add(key);
        }
    });

    return modifiedChunks;
  }
};
