import { TOTAL_SIZE, ISO_LEVEL, PAD, CHUNK_SIZE } from '../constants';
import { MeshData, MaterialType } from '../types';

// Helper to safely get density
const getVal = (density: Float32Array, x: number, y: number, z: number, size: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return -1.0; 
  return density[x + y * size + z * size * size];
};

// Helper to safely get material
const getMat = (material: Uint8Array, x: number, y: number, z: number, size: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return 0; 
    return material[x + y * size + z * size * size];
};

export function generateMesh(
    density: Float32Array,
    material: Uint8Array,
    // Accept optional arrays so we don't break if worker sends partial data,
    // but we will generate defaults if missing.
    wetness?: Uint8Array,
    mossiness?: Uint8Array
): MeshData {
  const t0 = performance.now();
  const size = TOTAL_SIZE;
  const vertices: number[] = [];
  const indices: number[] = [];
  const mats: number[] = []; 
  const norms: number[] = [];
  const wets: number[] = []; // Restore these
  const moss: number[] = []; // Restore these
  
  const vertexIndices = new Int32Array(size * size * size).fill(-1);
  
  // 1. Generate Vertices
  for (let z = 0; z < size - 1; z++) {
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        
        // Sample corners
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
        
        // Standard Surface Nets Edge Intersection
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

             const snapEpsilon = 0.02;
             const snapBoundary = (v: number) => {
               if (Math.abs(v - PAD) < snapEpsilon) return PAD;
               if (Math.abs(v - (PAD + CHUNK_SIZE)) < snapEpsilon) return PAD + CHUNK_SIZE;
               return v;
             };

             const px = snapBoundary(avgX) - PAD;
             const py = snapBoundary(avgY) - PAD;
             const pz = snapBoundary(avgZ) - PAD;
             
             vertices.push(px, py, pz);

             // Analytic Normals
             const nx = getVal(density, Math.round(avgX) - 1, Math.round(avgY), Math.round(avgZ), size) -
                        getVal(density, Math.round(avgX) + 1, Math.round(avgY), Math.round(avgZ), size);
             const ny = getVal(density, Math.round(avgX), Math.round(avgY) - 1, Math.round(avgZ), size) -
                        getVal(density, Math.round(avgX), Math.round(avgY) + 1, Math.round(avgZ), size);
             const nz = getVal(density, Math.round(avgX), Math.round(avgY), Math.round(avgZ) - 1, size) -
                        getVal(density, Math.round(avgX), Math.round(avgY), Math.round(avgZ) + 1, size);

             const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
             if (len > 0.0001) {
                 norms.push(nx/len, ny/len, nz/len);
             } else {
                 norms.push(0, 1, 0);
             }
             
             // Material Selection
             // We just grab the material at the rounded voxel position
             const mx = Math.round(avgX);
             const my = Math.round(avgY);
             const mz = Math.round(avgZ);
             
             const matVal = getMat(material, mx, my, mz, size);
             mats.push(matVal);

             // Safety: Ensure we push values for wetness/mossiness even if input arrays are missing
             // 0-255 mapped to 0.0-1.0
             if (wetness) {
                 wets.push((wetness[mx + my * size + mz * size * size] || 0) / 255.0);
             } else {
                 wets.push(0);
             }

             if (mossiness) {
                 moss.push((mossiness[mx + my * size + mz * size * size] || 0) / 255.0);
             } else {
                 moss.push(0);
             }

             vertexIndices[x + y * size + z * size * size] = (vertices.length / 3) - 1;
        }
      }
    }
  }
  
  // 2. Generate Quads (Simplified for brevity, logic remains same)
  const start = PAD;
  const end = PAD + CHUNK_SIZE; 
  const bufIdx = (x: number, y: number, z: number) => x + y * size + z * size * size;

  const pushQuad = (c0: number, c1: number, c2: number, c3: number, flipped: boolean) => {
    if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
        if (!flipped) indices.push(c0, c1, c2, c2, c1, c3);
        else indices.push(c2, c1, c0, c3, c1, c2);
    }
 };

  for (let z = start; z <= end; z++) {
    for (let y = start; y <= end; y++) {
      for (let x = start; x <= end; x++) {
         const val = getVal(density, x, y, z, size);
         if (x < end && y > start && z > start) {
             const vX = getVal(density, x + 1, y, z, size);
             if ((val > ISO_LEVEL) !== (vX > ISO_LEVEL)) {
                 pushQuad(
                     vertexIndices[bufIdx(x, y-1, z-1)], vertexIndices[bufIdx(x, y-1, z)],
                     vertexIndices[bufIdx(x, y, z-1)], vertexIndices[bufIdx(x, y, z)],
                     val > ISO_LEVEL
                 );
             }
         }
         if (y < end && x > start && z > start) {
             const vY = getVal(density, x, y + 1, z, size);
             if ((val > ISO_LEVEL) !== (vY > ISO_LEVEL)) {
                 pushQuad(
                     vertexIndices[bufIdx(x-1, y, z-1)], vertexIndices[bufIdx(x, y, z-1)],
                     vertexIndices[bufIdx(x-1, y, z)], vertexIndices[bufIdx(x, y, z)],
                     val > ISO_LEVEL
                 );
             }
         }
         if (z < end && x > start && y > start) {
             const vZ = getVal(density, x, y, z + 1, size);
             if ((val > ISO_LEVEL) !== (vZ > ISO_LEVEL)) {
                 pushQuad(
                     vertexIndices[bufIdx(x-1, y-1, z)], vertexIndices[bufIdx(x, y-1, z)],
                     vertexIndices[bufIdx(x-1, y, z)], vertexIndices[bufIdx(x, y, z)],
                     val > ISO_LEVEL
                 );
             }
         }
      }
    }
  }

  console.debug('[mesher] Mesh generated', {
    positions: vertices.length,
    indices: indices.length,
    normals: norms.length,
    mats: mats.length,
    wetness: wets.length,
    moss: moss.length,
    ms: Math.round(performance.now() - t0)
  });

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    normals: new Float32Array(norms),
    materials: new Float32Array(mats),
    wetness: new Float32Array(wets),
    mossiness: new Float32Array(moss)
  };
}
