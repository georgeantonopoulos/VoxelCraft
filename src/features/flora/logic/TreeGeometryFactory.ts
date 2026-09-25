import * as THREE from 'three';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { growTree } from '@features/flora/trees/treeGrowth';

/** Cached tree template geometries (one per type, variant and LOD), shared by all instances. */
export class TreeGeometryFactory {
    // Cache per (type, variant) so we can keep instancing efficient while allowing a few
    // deterministic jungle templates for variation.
    // Cache per (type, variant, simplified)
    private static cache: Record<number, Record<number, Record<string, { wood: THREE.BufferGeometry, leaves: THREE.BufferGeometry, collisionData: any[] }>>> = {};

    static getTreeGeometry(type: TreeType, variant = 0, simplified = false): { wood: THREE.BufferGeometry, leaves: THREE.BufferGeometry, collisionData: any[] } {
        if (!this.cache[type]) this.cache[type] = {};
        if (!this.cache[type][variant]) this.cache[type][variant] = {};

        const key = simplified ? 'low' : 'high';
        if (this.cache[type][variant][key]) {
            // Defensive: during hot reloads / stale caches, ensure new shader attributes exist.
            this.ensureLeafRandAttribute(this.cache[type][variant][key].leaves, type, variant);
            return this.cache[type][variant][key];
        }

        const { wood, leaves, collisionData } = this.generateTree(type, variant, simplified);
        this.ensureLeafRandAttribute(leaves, type, variant);
        this.cache[type][variant][key] = { wood, leaves, collisionData };
        return { wood, leaves, collisionData };
    }

    private static ensureLeafRandAttribute(leaves: THREE.BufferGeometry, type: TreeType, variant: number) {
        if (!leaves?.getAttribute('position')) return;
        if (leaves.getAttribute('aLeafRand')) return;

        const vertCount = leaves.getAttribute('position').count;
        const arr = new Float32Array(vertCount);
        const fract = (x: number) => x - Math.floor(x);

        for (let i = 0; i < vertCount; i++) {
            const p = (i + 1) * 12.9898 + type * 78.233 + variant * 37.719;
            arr[i] = fract(Math.sin(p) * 43758.5453123);
        }

        leaves.setAttribute('aLeafRand', new THREE.BufferAttribute(arr, 1));
    }

    private static generateTree(type: TreeType, variant: number, simplified = false) {
        // Geometry comes from the growth model (flora/trees/treeGrowth.ts).
        const data = growTree(type, variant, simplified ? 'low' : 'high');

        const wood = new THREE.BufferGeometry();
        wood.setAttribute('position', new THREE.BufferAttribute(data.wood.positions, 3));
        wood.setAttribute('normal', new THREE.BufferAttribute(data.wood.normals, 3));
        wood.setAttribute('uv', new THREE.BufferAttribute(data.wood.uvs, 2));
        wood.setAttribute('aBranchDepth', new THREE.BufferAttribute(data.wood.depth, 1));
        wood.setAttribute('aBranchAxis', new THREE.BufferAttribute(data.wood.axis, 3));
        wood.setAttribute('aBranchOrigin', new THREE.BufferAttribute(data.wood.origin, 3));
        wood.setIndex(new THREE.BufferAttribute(data.wood.indices, 1));
        wood.computeBoundingSphere();

        const leaves = new THREE.BufferGeometry();
        if (data.leaves.positions.length > 0) {
            leaves.setAttribute('position', new THREE.BufferAttribute(data.leaves.positions, 3));
            leaves.setAttribute('normal', new THREE.BufferAttribute(data.leaves.normals, 3));
            leaves.setAttribute('uv', new THREE.BufferAttribute(data.leaves.uvs, 2));
            leaves.setAttribute('aLeafRand', new THREE.BufferAttribute(data.leaves.rand, 1));
            leaves.setIndex(new THREE.BufferAttribute(data.leaves.indices, 1));
            leaves.computeBoundingSphere();
        }

        return { wood, leaves, collisionData: data.collision };
    }
}

