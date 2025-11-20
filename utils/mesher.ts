
import { TOTAL_SIZE, ISO_LEVEL, PAD, CHUNK_SIZE } from '../constants';
import { MeshData, MaterialType } from '../types';

const getVal = (density: Float32Array, x: number, y: number, z: number, size: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return -1.0; 
  return density[x + y * size + z * size * size];
};

const getMat = (material: Uint8Array, x: number, y: number, z: number, size: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= size || y >= size || z >= size) return 0; 
    return material[x + y * size + z * size * size];
};

export function generateMesh(density: Float32Array, material: Uint8Array): MeshData {
  const size = TOTAL_SIZE;
  const vertices: number[] = [];
  const indices: number[] = [];
  const mats: number[] = []; 
  
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
        
        // Helper for edge intersection
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

             // Snap boundary vertices to chunk edges so adjacent chunks share the
             // exact same boundary coordinates (avoids hairline cracks).
             const snapBoundary = (v: number) => {
               const snapped = Math.round(v * 1000) / 1000; // minor dedupe to reduce T-junctions
               if (snapped <= PAD + 1e-4) return PAD;
               if (snapped >= PAD + CHUNK_SIZE - 1e-4) return PAD + CHUNK_SIZE;
               return snapped;
             };

             const px = snapBoundary(avgX) - PAD;
             const py = snapBoundary(avgY) - PAD;
             const pz = snapBoundary(avgZ) - PAD;
             
             vertices.push(px, py, pz);
             
             // --- Material Selection ---
             // We pick the material from the "surface-most" solid voxel.
             // High density = deep underground. Low density (> ISO) = surface.
             // We want the lowest solid density to get the surface material (Grass/Dirt)
             let bestMat = MaterialType.DIRT; 
             let minSolidVal = 99999.0; 
             
             const check = (val: number, mx: number, my: number, mz: number) => {
                 if (val > ISO_LEVEL) {
                    const m = getMat(material, mx, my, mz, size);
                    if (m !== 0) { // Check against 0 (AIR)
                        // Pick the solid voxel that is closest to the ISO surface (lowest density value above ISO)
                        if (val < minSolidVal) {
                            minSolidVal = val;
                            bestMat = m;
                        }
                    }
                 }
             };

             check(v000, x, y, z);
             check(v100, x+1, y, z);
             check(v010, x, y+1, z);
             check(v110, x+1, y+1, z);
             check(v001, x, y, z+1);
             check(v101, x+1, y, z+1);
             check(v011, x, y+1, z+1);
             check(v111, x+1, y+1, z+1);

             mats.push(bestMat);
             vertexIndices[x + y * size + z * size * size] = (vertices.length / 3) - 1;
        }
      }
    }
  }
  
  // 2. Generate Quads
  const start = PAD;
  const end = PAD + CHUNK_SIZE; 
  const bufIdx = (x: number, y: number, z: number) => x + y * size + z * size * size;

  const pushQuad = (c0: number, c1: number, c2: number, c3: number, flipped: boolean) => {
    if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
        if (!flipped) {
           indices.push(c0, c1, c2, c2, c1, c3);
        } else {
           indices.push(c2, c1, c0, c3, c1, c2);
        }
    }
 };

  // We iterate strictly over the range needed to cover the chunk interior (x,y,z < end)
  // AND the connections to the boundary (x,y,z == end).
  //
  // - X-Faces (Normal X): Generated at `x` (between `x` and `x+1`).
  //   We want faces from `start` up to `end-1` (inclusive).
  //   This covers the range from local coordinate 2 to 33.
  //   Face 34 (boundary) is skipped here because the neighbor chunk (at its start) generates it.
  //
  // - Y/Z-Faces (Along X): Generated at `x`.
  //   We need to connect vertices `x-1` and `x`.
  //   Valid range for `x` is `start+1` to `end`.
  //   `x=start+1` (3) connects 2 and 3.
  //   `x=end` (34) connects 33 and 34 (closing the gap to boundary).
  //
  // To handle this in one loop, we iterate `x` from `start` to `end`,
  // and gate the face generation with conditionals.

  for (let z = start; z <= end; z++) {
    for (let y = start; y <= end; y++) {
      for (let x = start; x <= end; x++) {
         const val = getVal(density, x, y, z, size);

         // X Face check
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

         // Y Face check
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

         // Z Face check
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

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    normals: new Float32Array(vertices.length), 
    materials: new Float32Array(mats)
  };
}
