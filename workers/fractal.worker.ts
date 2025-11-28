import * as THREE from 'three';

const ctx: Worker = self as any;

function mulberry32(a: number) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

ctx.onmessage = (e) => {
    const { seed } = e.data;
    const rand = mulberry32(seed ? seed : Math.random() * 10000);

    const matrices: number[] = [];
    const depths: number[] = [];

    // Bounding Box tracking
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    // Stack for iterative generation
    // State: Position, Rotation, Scale, Depth (normalized logic later, or steps)
    // We assume the segment geometry is a Cylinder of height 1.0, radius 1.0 (scaled down)
    // Actually, usually radius is thinner. Let's assume geometry is unit size and we scale it.
    // If using CylinderGeometry(1, 1, 1), we scale x/z for thickness, y for length.

    interface Segment {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
        scale: THREE.Vector3;
        depth: number; // Iteration count
    }

    const stack: Segment[] = [];

    // Initial Trunk
    const rootPos = new THREE.Vector3(0, 0, 0);
    const rootQuat = new THREE.Quaternion(); // Identity (Up)
    const rootScale = new THREE.Vector3(0.4, 2.0, 0.4); // Thick trunk, 2m tall

    stack.push({
        position: rootPos,
        quaternion: rootQuat,
        scale: rootScale,
        depth: 0
    });

    const MAX_DEPTH = 8;
    const DECAY = 0.85;
    const ANGLE_BASE = 25 * (Math.PI / 180);

    const dummy = new THREE.Matrix4();
    const vec = new THREE.Vector3();

    while (stack.length > 0) {
        const seg = stack.pop()!;

        // 1. Record this segment
        dummy.compose(seg.position, seg.quaternion, seg.scale);
        const elements = dummy.elements;
        for (let i = 0; i < 16; i++) matrices.push(elements[i]);

        const normalizedDepth = seg.depth / MAX_DEPTH;
        depths.push(normalizedDepth);

        // Update Bounding Box
        // Check 8 corners of the transformed box/cylinder?
        // Approximation: Center + scaled radius/height extent?
        // Let's assume a box of size 1x1x1 centered at 0,0,0 is the base, then scaled.
        // Actually, Cylinder is usually centered.
        // If geometry is Cylinder(radiusTop, radiusBottom, height)
        // Usually height is along Y.
        // We'll check the segment's start and end points mostly.

        // Start point
        updateBounds(seg.position, min, max);

        // End point (Position + Rotation * Up * Length)
        // Length is seg.scale.y
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(seg.quaternion).multiplyScalar(seg.scale.y);
        const end = seg.position.clone().add(up);
        updateBounds(end, min, max);

        // Also expand by thickness (scale.x/z) approx
        const radius = Math.max(seg.scale.x, seg.scale.z) * 0.5;
        min.x -= radius; min.z -= radius;
        max.x += radius; max.z += radius;
        // Y handled by points

        // 2. Branching
        if (seg.depth < MAX_DEPTH) {
            const numBranches = 2 + (rand() > 0.7 ? 1 : 0); // 2 or 3 branches

            for (let i = 0; i < numBranches; i++) {
                // New Position is the End point of current
                const newPos = end.clone();

                // New Rotation
                // Rotate around Y (random azimuth)
                // Rotate outwards (pitch) by Angle

                // Create a rotation that deviates from current up
                const angle = ANGLE_BASE + (rand() - 0.5) * 0.5; // Randomize angle
                const azimuth = rand() * Math.PI * 2;

                // Construct rotation:
                // Start with current rotation
                const rot = seg.quaternion.clone();

                // Local rotation logic
                const branchRot = new THREE.Quaternion();
                branchRot.setFromEuler(new THREE.Euler(angle, azimuth, 0)); // Pitch and Yaw
                // This logic is tricky with quaternions.

                // Better:
                // 1. Get current Up vector
                // 2. Create a random vector within a cone around Up?
                // 3. Compute rotation from Up to new Vector.

                // Simplified L-System style:
                // Rotate around local axes.
                // Pitch (X) by angle, Yaw (Y) by azimuth.
                const q1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), angle); // Pitch out
                const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), azimuth + (Math.PI * 2 / numBranches) * i); // Spread branches

                // Combine: Current * Yaw * Pitch
                const newQuat = rot.clone().multiply(q2).multiply(q1);

                // New Scale
                const newScale = seg.scale.clone().multiplyScalar(DECAY);
                // Make length slightly longer to cover gaps? Or standard decay.
                // branches usually get thinner faster than shorter?
                // Let's stick to uniform decay for now, maybe stretch length.
                newScale.y = seg.scale.y * DECAY;
                newScale.x = seg.scale.x * DECAY;
                newScale.z = seg.scale.z * DECAY;

                stack.push({
                    position: newPos,
                    quaternion: newQuat,
                    scale: newScale,
                    depth: seg.depth + 1
                });
            }
        }
    }

    // Convert to Float32Array
    const matricesArray = new Float32Array(matrices);
    const depthsArray = new Float32Array(depths);

    ctx.postMessage({
        matrices: matricesArray,
        depths: depthsArray,
        boundingBox: { min, max }
    }, [matricesArray.buffer, depthsArray.buffer]);
};

function updateBounds(v: THREE.Vector3, min: {x:number, y:number, z:number}, max: {x:number, y:number, z:number}) {
    if (v.x < min.x) min.x = v.x;
    if (v.y < min.y) min.y = v.y;
    if (v.z < min.z) min.z = v.z;
    if (v.x > max.x) max.x = v.x;
    if (v.y > max.y) max.y = v.y;
    if (v.z > max.z) max.z = v.z;
}
