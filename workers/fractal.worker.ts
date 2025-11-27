import * as THREE from 'three';

// Stochastic L-System Rules
const RULES = {
  angle: 25 * (Math.PI / 180),
  decay: 0.85, // Width/Length decay per iteration
};

interface BranchData {
  matrix: THREE.Matrix4;
  depth: number;
}

// Seedable random
function mulberry32(a: number) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function generateFractalTree(iterations: number, seed: number, rootPosition: THREE.Vector3) {
  const branches: BranchData[] = [];
  const stack: {
    pos: THREE.Vector3;
    quat: THREE.Quaternion;
    len: number;
    width: number;
    depth: number;
  }[] = [];

  const random = mulberry32(seed);

  // Initial Trunk
  stack.push({
    pos: new THREE.Vector3(0, 0, 0), // Local to instance
    quat: new THREE.Quaternion(),
    len: 4.0,
    width: 0.8,
    depth: 0,
  });

  const maxBranchCount = 4000;
  let currentBranch = 0;
  const queue = [...stack];
  const boundingBox = new THREE.Box3();

  // Root pos for bounds
  boundingBox.expandByPoint(new THREE.Vector3(0,0,0));

  while (queue.length > 0 && currentBranch < maxBranchCount) {
    const { pos, quat, len, width, depth } = queue.shift()!;

    if (depth >= iterations) continue;

    // Center of cylinder segment
    const centerOffset = new THREE.Vector3(0, len / 2, 0).applyQuaternion(quat);
    const center = pos.clone().add(centerOffset);

    const matrix = new THREE.Matrix4().compose(
      center,
      quat,
      new THREE.Vector3(width, len, width) // Cylinder is Y-up, scale matches dimensions
    );

    branches.push({ matrix, depth });

    // Bounds approximation
    boundingBox.expandByPoint(center.clone().add(new THREE.Vector3(len, len, len)));
    boundingBox.expandByPoint(center.clone().sub(new THREE.Vector3(len, len, len)));

    currentBranch++;

    // Stochastic Branching
    const branchCount = 2 + (random() > 0.5 ? 1 : 0);

    for (let i = 0; i < branchCount; i++) {
      const newLen = len * RULES.decay;
      const newWidth = width * RULES.decay;
      const tip = new THREE.Vector3(0, len, 0).applyQuaternion(quat).add(pos);

      // Random rotation
      const offsetRot = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          (random() - 0.5) * RULES.angle * 2.5, // Spread
          (random() - 0.5) * RULES.angle * 2.5,
          (random() - 0.5) * RULES.angle * 2.5
        )
      );

      const newQuat = quat.clone().multiply(offsetRot);

      queue.push({
        pos: tip,
        quat: newQuat,
        len: newLen,
        width: newWidth,
        depth: depth + 1,
      });
    }
  }

  const matrices = new Float32Array(branches.length * 16);
  const depths = new Float32Array(branches.length);

  branches.forEach((b, i) => {
    b.matrix.toArray(matrices, i * 16);
    depths[i] = b.depth / iterations;
  });

  return { matrices, depths, boundingBox };
}

self.onmessage = (e: MessageEvent) => {
  const { seed, iterations, position } = e.data;
  const rootPos = new THREE.Vector3().fromArray(position);

  const { matrices, depths, boundingBox } = generateFractalTree(iterations, seed, rootPos);

  self.postMessage({
    matrices,
    depths,
    boundingBox: {
        min: boundingBox.min.toArray(),
        max: boundingBox.max.toArray()
    },
    count: matrices.length / 16,
    seed,
  }, [matrices.buffer, depths.buffer]);
};