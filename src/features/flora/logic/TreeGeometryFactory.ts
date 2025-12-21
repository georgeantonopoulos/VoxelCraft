import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

// Re-implementing the fractal logic to generate a STATIC merged geometry for a single tree
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
        const woodGeometries: THREE.BufferGeometry[] = [];
        const leafGeometries: THREE.BufferGeometry[] = [];
        const collisionData: { position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3 }[] = [];

        // Deterministic RNG for the template
        let seed = 12345 + type * 999 + variant * 1337;
        const rand = () => {
            const t = seed += 0x6D2B79F5;
            return ((Math.imul(t ^ t >>> 15, t | 1) ^ (t + Math.imul(t ^ t >>> 7, t | 61)) ^ t >>> 14) >>> 0) / 4294967296;
        };

        // --- GEOMETRY SELECTION ---
        let branchGeo: THREE.BufferGeometry;
        let branchGeoLow: THREE.BufferGeometry; // Low-poly version for tips
        let leafGeo: THREE.BufferGeometry;

        if (type === TreeType.CACTUS) {
            branchGeo = new THREE.CylinderGeometry(0.3, 0.2, 1.0, simplified ? 4 : 6); // Reduced segments
            branchGeo.scale(1.0, 1.0, 0.25);
            branchGeo.translate(0, 0.5, 0);
            branchGeoLow = branchGeo;
            leafGeo = new THREE.DodecahedronGeometry(0.15, 0);
        } else {
            // Standard Branch: 4 segments for trunk (Square)
            branchGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.0, simplified ? 3 : 4);
            branchGeo.translate(0, 0.5, 0);

            // Low-poly Branch: 3 segments (Triangular) for tips
            branchGeoLow = new THREE.CylinderGeometry(0.2, 0.25, 1.0, 3);
            branchGeoLow.translate(0, 0.5, 0);

            if (type === TreeType.PINE) {
                leafGeo = new THREE.ConeGeometry(0.3, 0.8, simplified ? 3 : 4);
            } else if (type === TreeType.JUNGLE) {
                leafGeo = simplified ? new THREE.TetrahedronGeometry(0.8) : new THREE.DodecahedronGeometry(0.6, 0);
                if (!simplified) leafGeo.scale(1.5, 0.6, 1.5);
                else leafGeo.scale(1.2, 0.8, 1.2);
            } else {
                // Octahedron (8 faces) or Tetrahedron (4 faces)
                leafGeo = simplified ? new THREE.TetrahedronGeometry(0.5) : new THREE.OctahedronGeometry(0.4, 0);
            }
        }

        // --- PARAMETERS ---
        let MAX_DEPTH = simplified ? 4 : 5;
        let LENGTH_DECAY = 0.85;
        let RADIUS_DECAY = 0.6;
        let ANGLE_BASE = 25 * (Math.PI / 180);
        let BRANCH_PROB = simplified ? 0.5 : 0.7;
        let BASE_LENGTH = 2.0;
        let JUNGLE_TRUNK_DEPTH = 3;
        let JUNGLE_CANOPY_WIDTH = 2.0;

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
            MAX_DEPTH = 4;
            LENGTH_DECAY = 0.9;
            RADIUS_DECAY = 0.9;
            ANGLE_BASE = 45 * (Math.PI / 180);
            BASE_LENGTH = 1.2;
        } else if (type === TreeType.JUNGLE) {
            // Optimization for Jungle: Slightly lower depth (max 7 instead of 9)
            // but more voluminous leaf clumps.
            MAX_DEPTH = 5 + Math.floor(rand() * 2); // 5..6 depth
            LENGTH_DECAY = 0.8;
            RADIUS_DECAY = 0.7 + rand() * 0.05;
            ANGLE_BASE = (75 + rand() * 15) * (Math.PI / 180);
            BASE_LENGTH = 5.0 + rand() * 4.0;
            BRANCH_PROB = 0.6 + rand() * 0.2;
            JUNGLE_TRUNK_DEPTH = 2;
            JUNGLE_CANOPY_WIDTH = 2.4 + rand() * 0.8;
        }

        interface Segment {
            position: THREE.Vector3;
            quaternion: THREE.Quaternion;
            scale: THREE.Vector3;
            depth: number;
        }

        const stack: Segment[] = [];
        const rootPos = new THREE.Vector3(0, 0, 0);
        const rootQuat = new THREE.Quaternion();
        const targetRadius = type === TreeType.JUNGLE ? 1.1 : 0.6;
        const rootScale = new THREE.Vector3(targetRadius / 0.25, BASE_LENGTH, targetRadius / 0.25);

        if (type === TreeType.CACTUS) {
            rootScale.set(1.5, BASE_LENGTH, 1.5);
        }

        stack.push({ position: rootPos, quaternion: rootQuat, scale: rootScale, depth: 0 });

        const dummy = new THREE.Matrix4();
        const addLeafVariationAttribute = (geo: THREE.BufferGeometry, leafRand: number) => {
            const vertCount = geo.attributes.position.count;
            const leafRandArray = new Float32Array(vertCount).fill(leafRand);
            geo.setAttribute('aLeafRand', new THREE.BufferAttribute(leafRandArray, 1));
        };

        const addLeafClump = (pos: THREE.Vector3, scaleMul: number) => {
            if (simplified && rand() > 0.6) return; // Reduce leaf count
            if (type === TreeType.JUNGLE && rand() > 0.9) return;

            dummy.makeRotationFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
            dummy.setPosition(pos);
            const lScale = (type === TreeType.JUNGLE ? 1.4 : 0.5 + rand() * 0.5) * scaleMul;
            dummy.scale(new THREE.Vector3(lScale, lScale, lScale));
            const instanceLeaf = leafGeo.clone();
            instanceLeaf.applyMatrix4(dummy);
            addLeafVariationAttribute(instanceLeaf, rand());
            leafGeometries.push(instanceLeaf);
        };

        let totalSegments = 0;
        const SEGMENT_CAP = 1000;

        while (stack.length > 0 && totalSegments < SEGMENT_CAP) {
            const seg = stack.pop()!;
            totalSegments++;

            dummy.compose(seg.position, seg.quaternion, seg.scale);
            const instanceGeo = (seg.depth > 2) ? branchGeoLow.clone() : branchGeo.clone();
            instanceGeo.applyMatrix4(dummy);

            const vertCount = instanceGeo.attributes.position.count;
            const normalizedDepth = seg.depth / (MAX_DEPTH || 1);
            const depthArray = new Float32Array(vertCount).fill(normalizedDepth);
            instanceGeo.setAttribute('aBranchDepth', new THREE.BufferAttribute(depthArray, 1));

            const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(seg.quaternion).normalize();
            const axisArray = new Float32Array(vertCount * 3);
            const originArray = new Float32Array(vertCount * 3);
            for (let i = 0; i < vertCount; i++) {
                const idx = i * 3;
                axisArray[idx + 0] = axis.x;
                axisArray[idx + 1] = axis.y;
                axisArray[idx + 2] = axis.z;
                originArray[idx + 0] = seg.position.x;
                originArray[idx + 1] = seg.position.y;
                originArray[idx + 2] = seg.position.z;
            }
            instanceGeo.setAttribute('aBranchAxis', new THREE.BufferAttribute(axisArray, 3));
            instanceGeo.setAttribute('aBranchOrigin', new THREE.BufferAttribute(originArray, 3));

            woodGeometries.push(instanceGeo);

            if (seg.depth < 3) {
                collisionData.push({
                    position: seg.position.clone(),
                    quaternion: seg.quaternion.clone(),
                    scale: seg.scale.clone()
                });
            }

            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(seg.quaternion).multiplyScalar(seg.scale.y);
            const end = seg.position.clone().add(up);

            if (seg.depth < MAX_DEPTH) {
                let numBranches = 2 + (rand() > BRANCH_PROB ? 1 : 0);

                if (type === TreeType.PALM) {
                    numBranches = (seg.depth < MAX_DEPTH - 1) ? 1 : 5;
                } else if (type === TreeType.CACTUS) {
                    numBranches = (seg.depth === 0) ? 1 : (rand() > 0.4 ? 1 : 2);
                } else if (type === TreeType.JUNGLE) {
                    if (seg.depth < JUNGLE_TRUNK_DEPTH) {
                        numBranches = 1;
                    } else if (seg.depth >= MAX_DEPTH - 1) {
                        numBranches = 1 + (rand() > 0.5 ? 1 : 0);
                    } else {
                        numBranches = 2 + (rand() > 0.7 ? 1 : 0);
                    }
                }

                for (let i = 0; i < numBranches; i++) {
                    const newPos = end.clone();
                    let angle = ANGLE_BASE + (rand() - 0.5) * 0.4;
                    let azimuth = rand() * Math.PI * 2;

                    if (type === TreeType.PALM && seg.depth === MAX_DEPTH - 1) {
                        angle = 110 * (Math.PI / 180);
                        azimuth = (i / numBranches) * Math.PI * 2;
                    } else if (type === TreeType.PINE) {
                        angle = 60 * (Math.PI / 180);
                    } else if (type === TreeType.JUNGLE && seg.depth < JUNGLE_TRUNK_DEPTH) {
                        angle = (rand() - 0.5) * 0.05;
                    }

                    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
                    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azimuth + (Math.PI * 2 / numBranches) * i);
                    const newQuat = seg.quaternion.clone().multiply(q2).multiply(q1);
                    const newScale = seg.scale.clone();
                    newScale.y = seg.scale.y * LENGTH_DECAY;
                    newScale.x = Math.max(seg.scale.x * RADIUS_DECAY, 0.08);
                    newScale.z = Math.max(seg.scale.z * RADIUS_DECAY, 0.08);

                    if (type === TreeType.JUNGLE && seg.depth >= MAX_DEPTH - 1) {
                        newScale.y *= 0.4;
                        newScale.x *= JUNGLE_CANOPY_WIDTH;
                        newScale.z *= JUNGLE_CANOPY_WIDTH;
                    }

                    if (type === TreeType.JUNGLE && seg.depth >= MAX_DEPTH - 3) {
                        const clumps = (seg.depth >= MAX_DEPTH - 1) ? 2 : 1;
                        for (let c = 0; c < clumps; c++) {
                            if (rand() < 0.8) {
                                const tPos = 0.5 + rand() * 0.5;
                                const leafPos = newPos.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(newQuat).multiplyScalar(newScale.y * tPos));
                                addLeafClump(leafPos, 1.2 + rand() * 0.8);
                            }
                        }
                    }

                    stack.push({ position: newPos, quaternion: newQuat, scale: newScale, depth: seg.depth + 1 });
                }
            } else {
                if (type === TreeType.CACTUS) {
                    if (rand() > 0.4) {
                        dummy.makeRotationFromEuler(new THREE.Euler(rand() * 0.5, rand() * 6, rand() * 0.5));
                        dummy.setPosition(end.clone().add(new THREE.Vector3(0, 0.1, 0)));
                        dummy.scale(new THREE.Vector3(1, 1, 1));
                        const instanceLeaf = leafGeo.clone();
                        instanceLeaf.applyMatrix4(dummy);
                        addLeafVariationAttribute(instanceLeaf, rand());
                        leafGeometries.push(instanceLeaf);
                    }
                } else {
                    addLeafClump(end, 1.0);
                }
            }
        }

        const mergedWood = woodGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(woodGeometries) : new THREE.BufferGeometry();
        const mergedLeaves = leafGeometries.length > 0 ? BufferGeometryUtils.mergeGeometries(leafGeometries) : new THREE.BufferGeometry();

        woodGeometries.forEach(g => g.dispose());
        leafGeometries.forEach(g => g.dispose());

        return { wood: mergedWood, leaves: mergedLeaves, collisionData };
    }
}

