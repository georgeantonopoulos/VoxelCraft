import { BlockType } from '../types';
import { to1D, to3D } from '../utils/chunkUtils';
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD } from '../constants';

const chunks = new Map<string, Uint8Array>();
const active = new Map<string, Set<number>>();

const getIdx = to1D;

const schedule = (nextActive: Map<string, Set<number>>, key: string, idx: number) => {
    if (!nextActive.has(key)) nextActive.set(key, new Set());
    nextActive.get(key)!.add(idx);
};

self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'LOAD') {
        const { key, material } = payload;
        chunks.set(key, new Uint8Array(material));
        if (!active.has(key)) active.set(key, new Set());
        const set = active.get(key)!;
        for (let i = 0; i < material.length; i++) {
            if (material[i] === BlockType.WATER) set.add(i);
        }
    }
    else if (type === 'UNLOAD') {
        const { key } = payload;
        chunks.delete(key);
        active.delete(key);
    }
    else if (type === 'UPDATE') {
        const { key, lx, ly, lz, val } = payload;
        if (chunks.has(key)) {
            const idx = getIdx(lx, ly, lz);
            const mat = chunks.get(key)!;
            mat[idx] = val; // Update local state

            if (val === BlockType.WATER) {
                if (!active.has(key)) active.set(key, new Set());
                active.get(key)!.add(idx);
            } else if (val === BlockType.AIR) {
                // Wake neighbors
                const { x, y, z } = to3D(idx);
                const neighbors = [ {dx:0,dy:1,dz:0}, {dx:1,dy:0,dz:0}, {dx:-1,dy:0,dz:0}, {dx:0,dy:0,dz:1}, {dx:0,dy:0,dz:-1} ];
                for(const n of neighbors) {
                     const nx=x+n.dx, ny=y+n.dy, nz=z+n.dz;
                     if (nx>=0 && nx<TOTAL_SIZE_XZ && ny>=0 && ny<TOTAL_SIZE_Y && nz>=0 && nz<TOTAL_SIZE_XZ) {
                         const nIdx = getIdx(nx, ny, nz);
                         if (mat[nIdx] === BlockType.WATER) {
                             if (!active.has(key)) active.set(key, new Set());
                             active.get(key)!.add(nIdx);
                         }
                     }
                }
            }
        }
    }
    else if (type === 'TICK') {
        const changes: { key: string, idx: number, val: number }[] = [];
        const nextActive = new Map<string, Set<number>>();

        for (const [key, indices] of active) {
            const mat = chunks.get(key);
            if (!mat) continue;

            for (const idx of indices) {
                if (mat[idx] !== BlockType.WATER) continue;

                const { x, y, z } = to3D(idx);

                // 1. Down
                let moved = false;
                if (y > PAD) {
                    const downIdx = getIdx(x, y - 1, z);
                    if (mat[downIdx] === BlockType.AIR) {
                        // Move down
                        changes.push({ key, idx, val: BlockType.AIR });
                        changes.push({ key, idx: downIdx, val: BlockType.WATER });

                        schedule(nextActive, key, downIdx);

                        // Wake neighbors of old position
                        const neighbors = [ {dx:0,dy:1,dz:0}, {dx:1,dy:0,dz:0}, {dx:-1,dy:0,dz:0}, {dx:0,dy:0,dz:1}, {dx:0,dy:0,dz:-1} ];
                        for(const n of neighbors) {
                             const nx=x+n.dx, ny=y+n.dy, nz=z+n.dz;
                             if (nx>=0 && nx<TOTAL_SIZE_XZ && ny>=0 && ny<TOTAL_SIZE_Y && nz>=0 && nz<TOTAL_SIZE_XZ) {
                                 const nIdx = getIdx(nx, ny, nz);
                                 if (mat[nIdx] === BlockType.WATER) schedule(nextActive, key, nIdx);
                             }
                        }
                        moved = true;
                    }
                }

                if (moved) continue;

                // 2. Spread
                let spread = false;
                const sides = [ {dx:1,dz:0}, {dx:-1,dz:0}, {dx:0,dz:1}, {dx:0,dz:-1} ];

                for (const s of sides) {
                    const nx = x + s.dx;
                    const nz = z + s.dz;
                    if (nx >= PAD && nx < TOTAL_SIZE_XZ - PAD && nz >= PAD && nz < TOTAL_SIZE_XZ - PAD) {
                        const nIdx = getIdx(nx, y, nz);
                        if (mat[nIdx] === BlockType.AIR) {
                            // Prevent duplicate writes in same tick
                            const alreadyWritten = changes.some(c => c.key === key && c.idx === nIdx);
                            if (!alreadyWritten) {
                                changes.push({ key, idx: nIdx, val: BlockType.WATER });
                                schedule(nextActive, key, nIdx);
                                spread = true;
                            }
                        }
                    }
                }

                if (spread) {
                    schedule(nextActive, key, idx);
                }
            }
        }

        // Apply changes locally
        for (const c of changes) {
            if (chunks.has(c.key)) {
                chunks.get(c.key)![c.idx] = c.val;
            }
        }

        // Merge active sets
        active.clear();
        for (const [key, set] of nextActive) {
            active.set(key, set);
        }

        if (changes.length > 0) {
            self.postMessage({ type: 'FLUID_UPDATE', changes });
        }
    }
};
