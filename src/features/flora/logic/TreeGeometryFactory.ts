import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

// Re-implementing the fractal logic to generate a STATIC merged geometry for a single tree
export class TreeGeometryFactory {
    private static cache: Record<number, THREE.BufferGeometry> = {};
    private static leafCache: Record<number, THREE.BufferGeometry> = {};

    static getTreeGeometry(type: TreeType): { wood: THREE.BufferGeometry, leaves: THREE.BufferGeometry } {
        if (this.cache[type] && this.leafCache[type]) {
            return { wood: this.cache[type], leaves: this.leafCache[type] };
        }

        const { wood, leaves } = this.generateTree(type);
        this.cache[type] = wood;
        this.leafCache[type] = leaves;
        return { wood, leaves };
    }

    private static generateTree(type: TreeType) {
        const woodGeometries: THREE.BufferGeometry[] = [];
        const leafGeometries: THREE.BufferGeometry[] = [];

        // Branch Geometry (Cylinder)
        const branchGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.0, 5);
        branchGeo.translate(0, 0.5, 0);

        // Leaf Geometry
        let leafGeo: THREE.BufferGeometry;
        if (type === TreeType.PINE) leafGeo = new THREE.ConeGeometry(0.3, 0.8, 5);
        else leafGeo = new THREE.OctahedronGeometry(0.4, 0);

        // Parameters (Copied from worker)
        let MAX_DEPTH = 6;
        let LENGTH_DECAY = 0.85;
        let RADIUS_DECAY = 0.6;
        let ANGLE_BASE = 25 * (Math.PI / 180);
        let BRANCH_PROB = 0.7;
        let BASE_LENGTH = 2.0;

        if (type === TreeType.PINE) {
            MAX_DEPTH = 5;
            LENGTH_DECAY = 0.8;
            RADIUS_DECAY = 0.7;
            ANGLE_BASE = 45 * (Math.PI / 180);
            BASE_LENGTH = 3.0;
        } else if (type === TreeType.PALM) {
            MAX_DEPTH = 4;
            LENGTH_DECAY = 0.95;
            RADIUS_DECAY = 0.8;
            ANGLE_BASE = 10 * (Math.PI / 180);
            BRANCH_PROB = 0.0;
            BASE_LENGTH = 1.5;
        } else if (type === TreeType.ACACIA) {
            MAX_DEPTH = 5;
            LENGTH_DECAY = 0.9;
            RADIUS_DECAY = 0.6;
            ANGLE_BASE = 60 * (Math.PI / 180);
            BASE_LENGTH = 1.5;
        } else if (type === TreeType.CACTUS) {
            MAX_DEPTH = 3;
            LENGTH_DECAY = 0.8;
            RADIUS_DECAY = 0.8;
            ANGLE_BASE = 90 * (Math.PI / 180);
            BASE_LENGTH = 1.5;
        }

        // Simulation Stack
        interface Segment {
            position: THREE.Vector3;
            quaternion: THREE.Quaternion;
            scale: THREE.Vector3;
            depth: number;
        }

        const stack: Segment[] = [];
        const rootPos = new THREE.Vector3(0, 0, 0);
        const rootQuat = new THREE.Quaternion();
        const targetRadius = 0.6;
        const rootScale = new THREE.Vector3(targetRadius / 0.25, BASE_LENGTH, targetRadius / 0.25);

        stack.push({ position: rootPos, quaternion: rootQuat, scale: rootScale, depth: 0 });

        const dummy = new THREE.Matrix4();
        // Deterministic RNG for the template
        let seed = 12345 + type * 999;
        const rand = () => {
            const t = seed += 0x6D2B79F5;
            return ((Math.imul(t ^ t >>> 15, t | 1) ^ (t + Math.imul(t ^ t >>> 7, t | 61)) ^ t >>> 14) >>> 0) / 4294967296;
        };

        while (stack.length > 0) {
            const seg = stack.pop()!;

            // Add Branch
            dummy.compose(seg.position, seg.quaternion, seg.scale);
            const instanceGeo = branchGeo.clone();
            instanceGeo.applyMatrix4(dummy);
            woodGeometries.push(instanceGeo);

            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(seg.quaternion).multiplyScalar(seg.scale.y);
            const end = seg.position.clone().add(up);

            if (seg.depth < MAX_DEPTH) {
                let numBranches = 2 + (rand() > BRANCH_PROB ? 1 : 0);

                if (type === TreeType.PALM) {
                    if (seg.depth < MAX_DEPTH - 1) numBranches = 1;
                    else numBranches = 5;
                } else if (type === TreeType.CACTUS) {
                    numBranches = (rand() > 0.5) ? 1 : 2;
                }

                for (let i = 0; i < numBranches; i++) {
                    const newPos = end.clone();
                    let angle = ANGLE_BASE + (rand() - 0.5) * 0.5;
                    let azimuth = rand() * Math.PI * 2;

                    if (type === TreeType.PALM && seg.depth === MAX_DEPTH - 1) {
                        angle = 110 * (Math.PI / 180);
                        azimuth = (i / numBranches) * Math.PI * 2;
                    }
                    if (type === TreeType.PINE) {
                        angle = 60 * (Math.PI / 180);
                    }

                    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
                    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azimuth + (Math.PI * 2 / numBranches) * i);

                    if (type === TreeType.PALM && seg.depth < MAX_DEPTH - 1) {
                        q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rand() - 0.5) * 0.2);
                    }

                    const newQuat = seg.quaternion.clone().multiply(q2).multiply(q1);
                    const newScale = seg.scale.clone();
                    newScale.y = seg.scale.y * LENGTH_DECAY;
                    newScale.x = Math.max(seg.scale.x * RADIUS_DECAY, 0.1);
                    newScale.z = Math.max(seg.scale.z * RADIUS_DECAY, 0.1);

                    stack.push({ position: newPos, quaternion: newQuat, scale: newScale, depth: seg.depth + 1 });
                }
            } else {
                // Add Leaf
                if (type !== TreeType.CACTUS) {
                    dummy.makeRotationFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
                    dummy.setPosition(end);
                    const lScale = 0.5 + rand() * 0.5;
                    dummy.scale(new THREE.Vector3(lScale, lScale, lScale));

                    const instanceLeaf = leafGeo.clone();
                    instanceLeaf.applyMatrix4(dummy);
                    leafGeometries.push(instanceLeaf);
                }
            }
        }

        const mergedWood = woodGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(woodGeometries) : new THREE.BufferGeometry();
        const mergedLeaves = leafGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(leafGeometries) : new THREE.BufferGeometry();

        return { wood: mergedWood, leaves: mergedLeaves };
    }
}
