
// Self-contained reproduction script to check DENSITY consistency
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

// --- TEST DENSITY ---

console.log("Starting Density Consistency Check...");

// Generate Chunk A at (0,0)
// Right edge is at local x = 32 + PAD = 34.
// World X = 34 - PAD + 0 = 32.
const chunkA = TerrainService.generateChunk(0, 0);

// Generate Chunk B at (1,0)
// Left edge is at local x = PAD = 2.
// World X = 2 - PAD + 32 = 32.
const chunkB = TerrainService.generateChunk(1, 0);

const size = TOTAL_SIZE;
let densityMismatches = 0;

// We check the plane where World X = 32.
// For Chunk A, this is local x = 34.
// For Chunk B, this is local x = 2.

// We can also check the plane X = 33 (Chunk A x=35, Chunk B x=3).

for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {

        // Check World X = 32
        const idxA = 34 + y * size + z * size * size;
        const idxB = 2 + y * size + z * size * size;

        const valA = chunkA.density[idxA];
        const valB = chunkB.density[idxB];

        if (Math.abs(valA - valB) > 0.001) {
            console.log(`Density Mismatch at WorldX=32, y=${y}, z=${z}: A=${valA}, B=${valB}`);
            densityMismatches++;
            if (densityMismatches > 5) break;
        }

        // Check World X = 33 (Neighbor sample needed for gradient/meshing)
        const idxA2 = 35 + y * size + z * size * size;
        const idxB2 = 3 + y * size + z * size * size;
        const valA2 = chunkA.density[idxA2];
        const valB2 = chunkB.density[idxB2];

        if (Math.abs(valA2 - valB2) > 0.001) {
             console.log(`Density Mismatch at WorldX=33, y=${y}, z=${z}: A=${valA2}, B=${valB2}`);
             densityMismatches++;
             if (densityMismatches > 5) break;
        }
    }
    if (densityMismatches > 5) break;
}

if (densityMismatches === 0) {
    console.log("SUCCESS: Densities match perfectly across boundary.");
} else {
    console.log("FAILURE: Densities do not match.");
}
