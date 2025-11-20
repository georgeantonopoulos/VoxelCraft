
import { generateMesh } from './utils/mesher.ts';
import { TerrainService } from './services/terrainService.ts';
import { CHUNK_SIZE, PAD } from './constants.ts';

console.log("Starting Seam Reproduction Check...");

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

// Chunk A Right Edge: World X = 32
const EPSILON = 0.01;

for (let i = 0; i < meshA.positions.length; i += 3) {
    const x = meshA.positions[i];
    const y = meshA.positions[i+1];
    const z = meshA.positions[i+2];

    // Check if x is close to 32 (CHUNK_SIZE)
    if (Math.abs(x - CHUNK_SIZE) < EPSILON) {
        boundaryA.push({y, z, val: x});
    }
}

for (let i = 0; i < meshB.positions.length; i += 3) {
    const x = meshB.positions[i];
    const y = meshB.positions[i+1];
    const z = meshB.positions[i+2];

    // Check if x is close to 0
    if (Math.abs(x - 0) < EPSILON) {
        boundaryB.push({y, z, val: x});
    }
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
        console.log(`Index ${i}: Mismatch! One is missing. A: ${!!va}, B: ${!!vb}`);
        mismatches++;
        continue;
    }

    const dy = Math.abs(va.y - vb.y);
    const dz = Math.abs(va.z - vb.z);

    if (dy > 0.001 || dz > 0.001) {
        console.log(`Index ${i}: Pos Mismatch! A:(${va.y.toFixed(3)}, ${va.z.toFixed(3)}) B:(${vb.y.toFixed(3)}, ${vb.z.toFixed(3)})`);
        mismatches++;
    } else {
        matches++;
    }
}

console.log(`Result: ${matches} matches, ${mismatches} mismatches.`);
