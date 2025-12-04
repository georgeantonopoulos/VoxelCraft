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

        // --- GEOMETRY SELECTION ---
        let branchGeo: THREE.BufferGeometry;
        let leafGeo: THREE.BufferGeometry;

        if (type === TreeType.CACTUS) {
            // Cactus "Wood" is the green pads
            // Flattened cylinder to look like a pad
            branchGeo = new THREE.CylinderGeometry(0.3, 0.2, 1.0, 8);
            branchGeo.scale(1.0, 1.0, 0.25); // Flatten Z
            branchGeo.translate(0, 0.5, 0);

            // Cactus "Leaves" are the flowers (Prickly Pear style)
            // Small sphere or dodecahedron
            leafGeo = new THREE.DodecahedronGeometry(0.15, 0);
        } else {
            // Standard Branch
            branchGeo = new THREE.CylinderGeometry(0.2, 0.25, 1.0, 5);
            branchGeo.translate(0, 0.5, 0);

            // Leaf Selection
            if (type === TreeType.PINE) {
                leafGeo = new THREE.ConeGeometry(0.3, 0.8, 5);
            } else if (type === TreeType.JUNGLE) {
                // Jungle Canopy: Broad, flat clumps
                leafGeo = new THREE.DodecahedronGeometry(0.6, 0);
                leafGeo.scale(1.5, 0.6, 1.5); // Flattened and wide
            } else {
                // Oak / Default
                leafGeo = new THREE.OctahedronGeometry(0.4, 0);
            }
        }

        // --- PARAMETERS ---
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
            MAX_DEPTH = 4; // More pads
            LENGTH_DECAY = 0.9; // Keep size relatively consistent
            RADIUS_DECAY = 0.9;
            ANGLE_BASE = 45 * (Math.PI / 180);
            BASE_LENGTH = 1.2;
        } else if (type === TreeType.JUNGLE) {
            // --- NEW JUNGLE LOGIC: Emergent Trees ---
            MAX_DEPTH = 7;             // Deeper recursion for complexity
            LENGTH_DECAY = 0.85;
            RADIUS_DECAY = 0.70;       // Thick trunks
            ANGLE_BASE = 80 * (Math.PI / 180); // Wide, horizontal spread for canopy
            BASE_LENGTH = 6.0;         // Massive initial trunk height
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

        // Special initial scale for Cactus to match pad shape
        if (type === TreeType.CACTUS) {
            rootScale.set(1.5, BASE_LENGTH, 1.5);
        }

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

                // --- BRANCH COUNT LOGIC ---
                if (type === TreeType.PALM) {
                    if (seg.depth < MAX_DEPTH - 1) numBranches = 1;
                    else numBranches = 5;
                } else if (type === TreeType.CACTUS) {
                    // Cacti branch less often, sometimes just stack
                    numBranches = (rand() > 0.3) ? 1 : 2;
                    if (seg.depth === 0) numBranches = 1; // Single base
                } else if (type === TreeType.JUNGLE) {
                    // Force straight trunk for the first 4 levels
                    if (seg.depth < 4) {
                        numBranches = 1;
                    } else {
                        // Explode into canopy at the top
                        numBranches = 3 + (rand() > 0.5 ? 1 : 0);
                    }
                }

                for (let i = 0; i < numBranches; i++) {
                    const newPos = end.clone();

                    // --- ANGLE LOGIC ---
                    let angle = ANGLE_BASE + (rand() - 0.5) * 0.5;
                    let azimuth = rand() * Math.PI * 2;

                    if (type === TreeType.PALM && seg.depth === MAX_DEPTH - 1) {
                        angle = 110 * (Math.PI / 180);
                        azimuth = (i / numBranches) * Math.PI * 2;
                    }
                    if (type === TreeType.PINE) {
                        angle = 60 * (Math.PI / 180);
                    }
                    if (type === TreeType.CACTUS) {
                        // Cactus pads branch out at specific angles or stack straight
                        if (numBranches === 1) {
                            angle = (rand() - 0.5) * 0.2; // Mostly straight
                        } else {
                            angle = 45 * (Math.PI / 180) + (rand() - 0.5) * 0.5;
                            // Align pads to be somewhat flat relative to each other?
                            // For now, random azimuth is fine, but maybe snap to 90 degrees?
                        }
                    }
                    if (type === TreeType.JUNGLE) {
                        // If it's the trunk (depth < 4), force it straight up
                        if (seg.depth < 4) {
                            angle = (rand() - 0.5) * 0.1; // Tiny wiggle
                        }
                        // The canopy naturally uses ANGLE_BASE (80 degrees) for horizontal spread
                    }

                    const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
                    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azimuth + (Math.PI * 2 / numBranches) * i);

                    if (type === TreeType.PALM && seg.depth < MAX_DEPTH - 1) {
                        q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rand() - 0.5) * 0.2);
                    }

                    // Extra flattening for very top of Jungle trees
                    if (type === TreeType.JUNGLE && seg.depth >= MAX_DEPTH - 2) {
                        const flatAngle = 85 * (Math.PI / 180) + (rand() - 0.5) * 0.5;
                        q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), flatAngle);
                    }

                    const newQuat = seg.quaternion.clone().multiply(q2).multiply(q1);
                    const newScale = seg.scale.clone();
                    newScale.y = seg.scale.y * LENGTH_DECAY;
                    newScale.x = Math.max(seg.scale.x * RADIUS_DECAY, 0.1);
                    newScale.z = Math.max(seg.scale.z * RADIUS_DECAY, 0.1);

                    // Jungle Canopy Leaves: Thinner and Wider
                    if (type === TreeType.JUNGLE && seg.depth >= MAX_DEPTH - 1) {
                        newScale.y *= 0.5; // Thinner vertically
                        newScale.x *= 2.0; // Wider horizontally
                        newScale.z *= 2.0;
                    }

                    // Cactus: Keep pads roughly same size, maybe slightly smaller
                    if (type === TreeType.CACTUS) {
                        newScale.x = seg.scale.x * 0.9;
                        newScale.z = seg.scale.z * 0.9;
                        newScale.y = seg.scale.y * 0.9;
                    }

                    stack.push({ position: newPos, quaternion: newQuat, scale: newScale, depth: seg.depth + 1 });
                }
            } else {
                // Add Leaf
                // Cactus flowers only on tips
                if (type === TreeType.CACTUS) {
                    // Chance for a flower
                    if (rand() > 0.4) {
                        dummy.makeRotationFromEuler(new THREE.Euler(rand() * 0.5, rand() * 6, rand() * 0.5));
                        // Position at the very tip of the pad
                        const tip = end.clone().add(new THREE.Vector3(0, 0.1, 0)); // Slight offset
                        dummy.setPosition(tip);
                        const lScale = 1.0;
                        dummy.scale(new THREE.Vector3(lScale, lScale, lScale));

                        const instanceLeaf = leafGeo.clone();
                        instanceLeaf.applyMatrix4(dummy);
                        leafGeometries.push(instanceLeaf);
                    }
                } else {
                    // Standard Leaves
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