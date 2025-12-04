import * as THREE from 'three';

const ctx: Worker = self as any;

function mulberry32(a: number) {
    return function () {
        var t = a += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

ctx.onmessage = (e) => {
    const { seed, baseRadius, type } = e.data;
    const rand = mulberry32(seed ? seed : Math.random() * 10000);

    const matrices: number[] = [];
    const depths: number[] = [];
    const leafMatrices: number[] = [];
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    // Tree Type Parameters
    // 0=OAK, 1=PINE, 2=PALM, 3=JUNGLE, 4=ACACIA, 5=CACTUS
    const treeType = type || 0;

    let MAX_DEPTH = 6;
    let LENGTH_DECAY = 0.85;
    let RADIUS_DECAY = 0.6;
    let ANGLE_BASE = 25 * (Math.PI / 180);
    let BRANCH_PROB = 0.7;
    let BASE_LENGTH = 2.0;

    // Configure based on type
    if (treeType === 1) { // PINE
        MAX_DEPTH = 5;
        LENGTH_DECAY = 0.8;
        RADIUS_DECAY = 0.7;
        ANGLE_BASE = 45 * (Math.PI / 180); // More upward
        BASE_LENGTH = 3.0;
    } else if (treeType === 2) { // PALM
        MAX_DEPTH = 4;
        LENGTH_DECAY = 0.95; // Long trunk
        RADIUS_DECAY = 0.8;
        ANGLE_BASE = 10 * (Math.PI / 180); // Straight up
        BRANCH_PROB = 0.0; // No branches until top
        BASE_LENGTH = 1.5;
    } else if (treeType === 4) { // ACACIA
        MAX_DEPTH = 5;
        LENGTH_DECAY = 0.9;
        RADIUS_DECAY = 0.6;
        ANGLE_BASE = 60 * (Math.PI / 180); // Wide spread
        BASE_LENGTH = 1.5;
    } else if (treeType === 5) { // CACTUS
        MAX_DEPTH = 3;
        LENGTH_DECAY = 0.8;
        RADIUS_DECAY = 0.8; // Thick arms
        ANGLE_BASE = 90 * (Math.PI / 180); // Right angles
        BASE_LENGTH = 1.5;
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
    const targetRadius = Math.max(0.3, typeof baseRadius === 'number' ? baseRadius : 0.6);

    // Initial Trunk Scale
    const rootScale = new THREE.Vector3(
        targetRadius / 0.25,
        BASE_LENGTH,
        targetRadius / 0.25
    );

    stack.push({
        position: rootPos,
        quaternion: rootQuat,
        scale: rootScale,
        depth: 0
    });

    const dummy = new THREE.Matrix4();

    while (stack.length > 0) {
        const seg = stack.pop()!;

        dummy.compose(seg.position, seg.quaternion, seg.scale);
        const elements = dummy.elements;
        for (let i = 0; i < 16; i++) matrices.push(elements[i]);

        const normalizedDepth = seg.depth / MAX_DEPTH;
        depths.push(normalizedDepth);

        updateBounds(seg.position, min, max);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(seg.quaternion).multiplyScalar(seg.scale.y);
        const end = seg.position.clone().add(up);
        updateBounds(end, min, max);

        // Branching Logic
        if (seg.depth < MAX_DEPTH) {
            let numBranches = 2 + (rand() > BRANCH_PROB ? 1 : 0);

            // Special rules
            if (treeType === 2) { // PALM
                // Only branch at very top
                if (seg.depth < MAX_DEPTH - 1) numBranches = 1;
                else numBranches = 5; // Fronds
            } else if (treeType === 5) { // CACTUS
                numBranches = (rand() > 0.5) ? 1 : 2; // Fewer arms
            }

            for (let i = 0; i < numBranches; i++) {
                const newPos = end.clone();
                let angle = ANGLE_BASE + (rand() - 0.5) * 0.5;
                let azimuth = rand() * Math.PI * 2;

                // Palm Fronds Logic
                if (treeType === 2 && seg.depth === MAX_DEPTH - 1) {
                    angle = 110 * (Math.PI / 180); // Droop down
                    azimuth = (i / numBranches) * Math.PI * 2;
                }

                // Pine Logic: Branches angle up, but lower ones droop?
                if (treeType === 1) {
                    angle = 60 * (Math.PI / 180); // Angle down slightly
                }

                const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle);
                const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), azimuth + (Math.PI * 2 / numBranches) * i);

                // For Palm trunk, keep straight
                if (treeType === 2 && seg.depth < MAX_DEPTH - 1) {
                    q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (rand() - 0.5) * 0.2); // Slight wobble
                }

                const newQuat = seg.quaternion.clone().multiply(q2).multiply(q1);

                const newScale = seg.scale.clone();
                newScale.y = seg.scale.y * LENGTH_DECAY;
                newScale.x = Math.max(seg.scale.x * RADIUS_DECAY, 0.1);
                newScale.z = Math.max(seg.scale.z * RADIUS_DECAY, 0.1);

                stack.push({
                    position: newPos,
                    quaternion: newQuat,
                    scale: newScale,
                    depth: seg.depth + 1
                });
            }
        } else {
            // Leaves
            // Cactus has no leaves
            if (treeType !== 5) {
                dummy.makeRotationFromEuler(new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3));
                dummy.setPosition(end);
                const lScale = 0.5 + Math.random() * 0.5;
                dummy.scale(new THREE.Vector3(lScale, lScale, lScale));
                const le = dummy.elements;
                for (let i = 0; i < 16; i++) leafMatrices.push(le[i]);
            }
        }
    }

    const matricesArray = new Float32Array(matrices);
    const depthsArray = new Float32Array(depths);
    const leafMatricesArray = new Float32Array(leafMatrices);

    ctx.postMessage({
        matrices: matricesArray,
        depths: depthsArray,
        leafMatrices: leafMatricesArray,
        boundingBox: { min, max }
    }, [matricesArray.buffer, depthsArray.buffer, leafMatricesArray.buffer]);
}


function updateBounds(v: THREE.Vector3, min: { x: number, y: number, z: number }, max: { x: number, y: number, z: number }) {
    if (v.x < min.x) min.x = v.x;
    if (v.y < min.y) min.y = v.y;
    if (v.z < min.z) min.z = v.z;
    if (v.x > max.x) max.x = v.x;
    if (v.y > max.y) max.y = v.y;
    if (v.z > max.z) max.z = v.z;
}
