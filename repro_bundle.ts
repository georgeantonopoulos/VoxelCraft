
// Self-contained reproduction script to avoid module resolution issues in the test environment
// Copies relevant logic from: constants.ts, noise.ts, mesher.ts, terrainService.ts

// --- CONSTANTS ---
const CHUNK_SIZE = 32;
const PAD = 2;
const TOTAL_SIZE = CHUNK_SIZE + PAD * 2;
const ISO_LEVEL = 0.5;
const WATER_LEVEL = 4.5;
const VOXEL_SCALE = 1.0;
const MaterialType = {
    AIR: 0,
    STONE: 1,
    DIRT: 2,
    GRASS: 3,
    SAND: 4,
    SNOW: 5,
    BEDROCK: 6,
    WATER: 7
};

// --- NOISE (Deterministic) ---
const PERM = new Uint8Array(512);
const p = new Uint8Array(256);
let seedVal = 1337;
function seededRandom() {
    const x = Math.sin(seedVal++) * 10000;
    return x - Math.floor(x);
}
for (let i = 0; i < 256; i++) p[i] = i;
for (let i = 255; i > 0; i--) {
    const n = Math.floor(seededRandom() * (i + 1));
    const q = p[i]; p[i] = p[n]; p[n] = q;
}
for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];

function fade(t: number) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(t: number, a: number, b: number) { return a + t * (b - a); }
function grad(hash: number, x: number, y: number, z: number) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function noise(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = PERM[X] + Y;
    const AA = PERM[A] + Z;
    const AB = PERM[A + 1] + Z;
    const B = PERM[X + 1] + Y;
    const BA = PERM[B] + Z;
    const BB = PERM[B + 1] + Z;
    return lerp(w,
        lerp(v, lerp(u, grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z)), lerp(u, grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z))),
        lerp(v, lerp(u, grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1)), lerp(u, grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1)))
    );
}

// --- TERRAIN SERVICE ---
class TerrainService {
  static generateChunk(cx: number, cz: number) {
    const size = TOTAL_SIZE;
    const density = new Float32Array(size * size * size);
    const material = new Uint8Array(size * size * size);
    const worldOffsetX = cx * CHUNK_SIZE;
    const worldOffsetZ = cz * CHUNK_SIZE;

    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = x + y * size + z * size * size;
          const wx = (x - PAD) + worldOffsetX;
          const wy = (y - PAD);
          const wz = (z - PAD) + worldOffsetZ;

          const warpScale = 0.008;
          const warpStr = 15.0;
          const qx = noise(wx * warpScale, 0, wz * warpScale) * warpStr;
          const qz = noise(wx * warpScale + 5.2, 0, wz * warpScale + 1.3) * warpStr;
          const px = wx + qx;
          const pz = wz + qz;

          const continental = noise(px * 0.01, 0, pz * 0.01) * 8;
          let mountains = noise(px * 0.05, 0, pz * 0.05) * 4;
          mountains += noise(px * 0.15, 0, pz * 0.15) * 1.5;
          const cliffNoise = noise(wx * 0.06, wy * 0.08, wz * 0.06);
          const overhang = cliffNoise * 6;
          const surfaceHeight = 14 + continental + mountains;
          let d = surfaceHeight - wy + overhang;

          if (wy < surfaceHeight - 4 && wy > -20) {
             const caveFreq = 0.08;
             const c1 = noise(wx * caveFreq, wy * caveFreq, wz * caveFreq);
             if (Math.abs(c1) < 0.12) d -= 20.0;
          }
          if (wy < -4) d += 50.0;
          density[idx] = d;
        }
      }
    }
    return { density, material };
  }
}

// --- MESHER ---
const getVal = (density: Float32Array, x: number, y: number, z: number, size: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return -1.0;
  return density[x + y * size + z * size * size];
};

function generateMesh(density: Float32Array, material: Uint8Array) {
  const size = TOTAL_SIZE;
  const vertices: number[] = [];
  const indices: number[] = [];
  const vertexIndices = new Int32Array(size * size * size).fill(-1);

  // 1. Generate Vertices
  for (let z = 0; z < size - 1; z++) {
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const v000 = getVal(density, x, y, z, size);
        const v100 = getVal(density, x + 1, y, z, size);
        const v010 = getVal(density, x, y + 1, z, size);
        const v110 = getVal(density, x + 1, y + 1, z, size);
        const v001 = getVal(density, x, y, z + 1, size);
        const v101 = getVal(density, x + 1, y, z + 1, size);
        const v011 = getVal(density, x, y + 1, z + 1, size);
        const v111 = getVal(density, x + 1, y + 1, z + 1, size);

        let mask = 0;
        if (v000 > ISO_LEVEL) mask |= 1;
        if (v100 > ISO_LEVEL) mask |= 2;
        if (v010 > ISO_LEVEL) mask |= 4;
        if (v110 > ISO_LEVEL) mask |= 8;
        if (v001 > ISO_LEVEL) mask |= 16;
        if (v101 > ISO_LEVEL) mask |= 32;
        if (v011 > ISO_LEVEL) mask |= 64;
        if (v111 > ISO_LEVEL) mask |= 128;

        if (mask === 0 || mask === 255) continue;

        let edgeCount = 0;
        let avgX = 0, avgY = 0, avgZ = 0;

        const addInter = (valA: number, valB: number, axis: 'x'|'y'|'z', offX: number, offY: number, offZ: number) => {
             if ((valA > ISO_LEVEL) !== (valB > ISO_LEVEL)) {
                 const mu = (ISO_LEVEL - valA) / (valB - valA);
                 if (axis === 'x') { avgX += x + mu; avgY += y + offY; avgZ += z + offZ; }
                 if (axis === 'y') { avgX += x + offX; avgY += y + mu; avgZ += z + offZ; }
                 if (axis === 'z') { avgX += x + offX; avgY += y + offY; avgZ += z + mu; }
                 edgeCount++;
             }
        };

        addInter(v000, v100, 'x', 0,0,0);
        addInter(v010, v110, 'x', 0,1,0);
        addInter(v001, v101, 'x', 0,0,1);
        addInter(v011, v111, 'x', 0,1,1);
        addInter(v000, v010, 'y', 0,0,0);
        addInter(v100, v110, 'y', 1,0,0);
        addInter(v001, v011, 'y', 0,0,1);
        addInter(v101, v111, 'y', 1,0,1);
        addInter(v000, v001, 'z', 0,0,0);
        addInter(v100, v101, 'z', 1,0,0);
        addInter(v010, v011, 'z', 0,1,0);
        addInter(v110, v111, 'z', 1,1,0);

        if (edgeCount > 0) {
             avgX /= edgeCount;
             avgY /= edgeCount;
             avgZ /= edgeCount;

             const snapBoundary = (v: number) => {
               const snapped = Math.round(v * 1000) / 1000;
               if (snapped <= PAD + 1e-4) return PAD;
               if (snapped >= PAD + CHUNK_SIZE - 1e-4) return PAD + CHUNK_SIZE;
               return snapped;
             };

             const px = snapBoundary(avgX) - PAD;
             const py = snapBoundary(avgY) - PAD;
             const pz = snapBoundary(avgZ) - PAD;

             vertices.push(px, py, pz);
             vertexIndices[x + y * size + z * size * size] = (vertices.length / 3) - 1;
        }
      }
    }
  }
  return { positions: new Float32Array(vertices) };
}

// --- TEST ---

console.log("Starting Seam Reproduction Check (Bundle Version)...");

// Generate Chunk A at (0,0)
console.log("Generating Chunk A (0,0)...");
const chunkA = TerrainService.generateChunk(0, 0);
const meshA = generateMesh(chunkA.density, chunkA.material);

// Generate Chunk B at (1,0) -> Neighbor to the right (+X)
console.log("Generating Chunk B (1,0)...");
const chunkB = TerrainService.generateChunk(1, 0);
const meshB = generateMesh(chunkB.density, chunkB.material);

const boundaryA: {y: number, z: number, val: number}[] = [];
const boundaryB: {y: number, z: number, val: number}[] = [];
const EPSILON = 0.01;

for (let i = 0; i < meshA.positions.length; i += 3) {
    const x = meshA.positions[i];
    const y = meshA.positions[i+1];
    const z = meshA.positions[i+2];
    if (Math.abs(x - CHUNK_SIZE) < EPSILON) boundaryA.push({y, z, val: x});
}

for (let i = 0; i < meshB.positions.length; i += 3) {
    const x = meshB.positions[i];
    const y = meshB.positions[i+1];
    const z = meshB.positions[i+2];
    if (Math.abs(x - 0) < EPSILON) boundaryB.push({y, z, val: x});
}

console.log(`Found ${boundaryA.length} boundary vertices in Chunk A (at x=32)`);
console.log(`Found ${boundaryB.length} boundary vertices in Chunk B (at x=0)`);

boundaryA.sort((a, b) => a.y - b.y || a.z - b.z);
boundaryB.sort((a, b) => a.y - b.y || a.z - b.z);

let mismatches = 0;
let matches = 0;
const maxLen = Math.max(boundaryA.length, boundaryB.length);

for (let i = 0; i < maxLen; i++) {
    const va = boundaryA[i];
    const vb = boundaryB[i];

    if (!va || !vb) {
        // console.log(`Index ${i}: Mismatch! One is missing.`);
        mismatches++;
        continue;
    }

    const dy = Math.abs(va.y - vb.y);
    const dz = Math.abs(va.z - vb.z);

    if (dy > 0.001 || dz > 0.001) {
        mismatches++;
    } else {
        matches++;
    }
}

console.log(`Result: ${matches} matches, ${mismatches} mismatches.`);
