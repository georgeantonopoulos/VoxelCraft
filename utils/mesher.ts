
import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, CHUNK_SIZE_XZ, CHUNK_SIZE_Y, PAD, ISO_LEVEL, MESH_Y_OFFSET } from '../constants';
import { MeshData, MaterialType } from '../types';

const SIZE_X = TOTAL_SIZE_XZ;
const SIZE_Y = TOTAL_SIZE_Y;
const SIZE_Z = TOTAL_SIZE_XZ;

const getVal = (density: Float32Array, x: number, y: number, z: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return -1.0;
  return density[x + y * SIZE_X + z * SIZE_X * SIZE_Y];
};

const getMat = (material: Uint8Array, x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return 0;
    return material[x + y * SIZE_X + z * SIZE_X * SIZE_Y];
};

const getByte = (arr: Uint8Array, x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return 0;
    return arr[x + y * SIZE_X + z * SIZE_X * SIZE_Y];
};

// Helper for Water Density Override
const getWaterEffectiveDensity = (density: Float32Array, material: Uint8Array, x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return -1.0;
    const idx = x + y * SIZE_X + z * SIZE_X * SIZE_Y;
    const mat = material[idx];
    if (mat === MaterialType.WATER) return 1.0; // Force solid for water
    return density[idx];
};

export function generateMesh(density: Float32Array, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array): MeshData {
  
  // --- 1. TERRAIN MESH ---
  const tVerts: number[] = [];
  const tInds: number[] = [];
  const tMats: number[] = [];
  const tNorms: number[] = [];
  const tWets: number[] = [];
  const tMoss: number[] = [];
  const tVertIdx = new Int32Array(SIZE_X * SIZE_Y * SIZE_Z).fill(-1);

  // --- 2. WATER MESH ---
  const wVerts: number[] = [];
  const wInds: number[] = [];
  const wNorms: number[] = [];
  const wVertIdx = new Int32Array(SIZE_X * SIZE_Y * SIZE_Z).fill(-1);

  // --- VERTEX GENERATION ---
  
  for (let z = 0; z < SIZE_Z - 1; z++) {
    for (let y = 0; y < SIZE_Y - 1; y++) {
      for (let x = 0; x < SIZE_X - 1; x++) {
        
        // --- Terrain Vertices ---
        {
            let mask = 0;
            const v000 = getVal(density, x, y, z);
            const v100 = getVal(density, x+1, y, z);
            const v010 = getVal(density, x, y+1, z);
            const v110 = getVal(density, x+1, y+1, z);
            const v001 = getVal(density, x, y, z+1);
            const v101 = getVal(density, x+1, y, z+1);
            const v011 = getVal(density, x, y+1, z+1);
            const v111 = getVal(density, x+1, y+1, z+1);

            if (v000 > ISO_LEVEL) mask |= 1;
            if (v100 > ISO_LEVEL) mask |= 2;
            if (v010 > ISO_LEVEL) mask |= 4;
            if (v110 > ISO_LEVEL) mask |= 8;
            if (v001 > ISO_LEVEL) mask |= 16;
            if (v101 > ISO_LEVEL) mask |= 32;
            if (v011 > ISO_LEVEL) mask |= 64;
            if (v111 > ISO_LEVEL) mask |= 128;

            if (mask !== 0 && mask !== 255) {
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

                addInter(v000, v100, 'x', 0,0,0); addInter(v010, v110, 'x', 0,1,0);
                addInter(v001, v101, 'x', 0,0,1); addInter(v011, v111, 'x', 0,1,1);
                addInter(v000, v010, 'y', 0,0,0); addInter(v100, v110, 'y', 1,0,0);
                addInter(v001, v011, 'y', 0,0,1); addInter(v101, v111, 'y', 1,0,1);
                addInter(v000, v001, 'z', 0,0,0); addInter(v100, v101, 'z', 1,0,0);
                addInter(v010, v011, 'z', 0,1,0); addInter(v110, v111, 'z', 1,1,0);

                if (edgeCount > 0) {
                     avgX /= edgeCount; avgY /= edgeCount; avgZ /= edgeCount;

                     const snapEpsilon = 0.02;
                     const snapBoundary = (v: number, size: number) => {
                       if (Math.abs(v - PAD) < snapEpsilon) return PAD;
                       if (Math.abs(v - (PAD + CHUNK_SIZE_XZ)) < snapEpsilon) return PAD + CHUNK_SIZE_XZ;
                       return v;
                     };

                     const px = snapBoundary(avgX, SIZE_X) - PAD;
                     const py = avgY - PAD + MESH_Y_OFFSET; // Apply Y Offset
                     const pz = snapBoundary(avgZ, SIZE_Z) - PAD;

                     tVerts.push(px, py, pz);

                     // Normal
                     const nx = getVal(density, Math.round(avgX) - 1, Math.round(avgY), Math.round(avgZ)) -
                                getVal(density, Math.round(avgX) + 1, Math.round(avgY), Math.round(avgZ));
                     const ny = getVal(density, Math.round(avgX), Math.round(avgY) - 1, Math.round(avgZ)) -
                                getVal(density, Math.round(avgX), Math.round(avgY) + 1, Math.round(avgZ));
                     const nz = getVal(density, Math.round(avgX), Math.round(avgY), Math.round(avgZ) - 1) -
                                getVal(density, Math.round(avgX), Math.round(avgY), Math.round(avgZ) + 1);
                     const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                     if (len > 0.0001) tNorms.push(nx/len, ny/len, nz/len);
                     else tNorms.push(0, 1, 0);

                     // Material
                     let bestMat = MaterialType.DIRT;
                     let bestWet = 0; let bestMoss = 0;
                     let minSolidVal = 99999.0;
                     const check = (val: number, mx: number, my: number, mz: number) => {
                         if (val > ISO_LEVEL) {
                            const m = getMat(material, mx, my, mz);
                            if (m !== 0 && m !== MaterialType.WATER) { // Ignore water for terrain
                                if (val < minSolidVal) {
                                    minSolidVal = val;
                                    bestMat = m;
                                    bestWet = getByte(wetness, mx, my, mz);
                                    bestMoss = getByte(mossiness, mx, my, mz);
                                }
                            }
                         }
                     };
                     check(v000, x, y, z); check(v100, x+1, y, z);
                     check(v010, x, y+1, z); check(v110, x+1, y+1, z);
                     check(v001, x, y, z+1); check(v101, x+1, y, z+1);
                     check(v011, x, y+1, z+1); check(v111, x+1, y+1, z+1);

                     tMats.push(bestMat);
                     tWets.push(bestWet / 255.0);
                     tMoss.push(bestMoss / 255.0);
                     tVertIdx[x + y * SIZE_X + z * SIZE_X * SIZE_Y] = (tVerts.length / 3) - 1;
                }
            }
        }

        // --- Water Vertices ---
        {
            const gw = getWaterEffectiveDensity;
            let mask = 0;
            const v000 = gw(density, material, x, y, z);
            const v100 = gw(density, material, x+1, y, z);
            const v010 = gw(density, material, x, y+1, z);
            const v110 = gw(density, material, x+1, y+1, z);
            const v001 = gw(density, material, x, y, z+1);
            const v101 = gw(density, material, x+1, y, z+1);
            const v011 = gw(density, material, x, y+1, z+1);
            const v111 = gw(density, material, x+1, y+1, z+1);

            if (v000 > ISO_LEVEL) mask |= 1;
            if (v100 > ISO_LEVEL) mask |= 2;
            if (v010 > ISO_LEVEL) mask |= 4;
            if (v110 > ISO_LEVEL) mask |= 8;
            if (v001 > ISO_LEVEL) mask |= 16;
            if (v101 > ISO_LEVEL) mask |= 32;
            if (v011 > ISO_LEVEL) mask |= 64;
            if (v111 > ISO_LEVEL) mask |= 128;

            if (mask !== 0 && mask !== 255) {
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

                addInter(v000, v100, 'x', 0,0,0); addInter(v010, v110, 'x', 0,1,0);
                addInter(v001, v101, 'x', 0,0,1); addInter(v011, v111, 'x', 0,1,1);
                addInter(v000, v010, 'y', 0,0,0); addInter(v100, v110, 'y', 1,0,0);
                addInter(v001, v011, 'y', 0,0,1); addInter(v101, v111, 'y', 1,0,1);
                addInter(v000, v001, 'z', 0,0,0); addInter(v100, v101, 'z', 1,0,0);
                addInter(v010, v011, 'z', 0,1,0); addInter(v110, v111, 'z', 1,1,0);

                if (edgeCount > 0) {
                     avgX /= edgeCount; avgY /= edgeCount; avgZ /= edgeCount;

                     const snapEpsilon = 0.02;
                     const snapBoundary = (v: number) => {
                       if (Math.abs(v - PAD) < snapEpsilon) return PAD;
                       if (Math.abs(v - (PAD + CHUNK_SIZE_XZ)) < snapEpsilon) return PAD + CHUNK_SIZE_XZ;
                       return v;
                     };

                     const px = snapBoundary(avgX) - PAD;
                     const py = avgY - PAD + MESH_Y_OFFSET;
                     const pz = snapBoundary(avgZ) - PAD;

                     wVerts.push(px, py, pz);

                     // Water Normal (using effective density)
                     const rx = Math.round(avgX), ry = Math.round(avgY), rz = Math.round(avgZ);
                     const nx = gw(density, material, rx - 1, ry, rz) - gw(density, material, rx + 1, ry, rz);
                     const ny = gw(density, material, rx, ry - 1, rz) - gw(density, material, rx, ry + 1, rz);
                     const nz = gw(density, material, rx, ry, rz - 1) - gw(density, material, rx, ry, rz + 1);

                     const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
                     if (len > 0.0001) wNorms.push(nx/len, ny/len, nz/len);
                     else wNorms.push(0, 1, 0);

                     wVertIdx[x + y * SIZE_X + z * SIZE_X * SIZE_Y] = (wVerts.length / 3) - 1;
                }
            }
        }
      }
    }
  }
  
  // --- QUAD GENERATION ---
  const start = PAD;
  const endX = PAD + CHUNK_SIZE_XZ;
  const endY = PAD + CHUNK_SIZE_Y;

  const bufIdx = (x: number, y: number, z: number) => x + y * SIZE_X + z * SIZE_X * SIZE_Y;

  for (let z = start; z <= endX; z++) {
    for (let y = start; y <= endY; y++) {
      for (let x = start; x <= endX; x++) {

         const idxCurrent = bufIdx(x, y, z);
         const idxX = bufIdx(x+1, y, z);
         const idxY = bufIdx(x, y+1, z);
         const idxZ = bufIdx(x, y, z+1);

         // Helper for pushing quads
         const tryPush = (idx0: number, idx1: number, idx2: number, idx3: number, flipped: boolean, isWater: boolean, insideMat: number) => {
             const vIdx = isWater ? wVertIdx : tVertIdx;
             const indices = isWater ? wInds : tInds;

             const c0 = vIdx[idx0];
             const c1 = vIdx[idx1];
             const c2 = vIdx[idx2];
             const c3 = vIdx[idx3];

             if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
                 if (isWater) {
                     // Filter: Only generate if inside material is WATER
                     if (insideMat === MaterialType.WATER) {
                        if (!flipped) indices.push(c0, c1, c2, c2, c1, c3);
                        else indices.push(c2, c1, c0, c3, c1, c2);
                     }
                 } else {
                     // Terrain
                     if (!flipped) indices.push(c0, c1, c2, c2, c1, c3);
                     else indices.push(c2, c1, c0, c3, c1, c2);
                 }
             }
         };

         // --- X Face ---
         if (x < endX && y > start && y <= endY && z >= start && z <= endX) {
             // Terrain
             const val = getVal(density, x, y, z);
             const vX = getVal(density, x + 1, y, z);
             if ((val > ISO_LEVEL) !== (vX > ISO_LEVEL)) {
                 tryPush(bufIdx(x,y-1,z-1), bufIdx(x,y-1,z), bufIdx(x,y,z-1), bufIdx(x,y,z), val > ISO_LEVEL, false, 0);
             }
             // Water
             const gw = getWaterEffectiveDensity;
             const wv = gw(density, material, x, y, z);
             const wX = gw(density, material, x + 1, y, z);
             if ((wv > ISO_LEVEL) !== (wX > ISO_LEVEL)) {
                 const insideMat = (wv > ISO_LEVEL) ? getMat(material, x, y, z) : getMat(material, x+1, y, z);
                 tryPush(bufIdx(x,y-1,z-1), bufIdx(x,y-1,z), bufIdx(x,y,z-1), bufIdx(x,y,z), wv > ISO_LEVEL, true, insideMat);
             }
         }

         // --- Y Face ---
         if (y <= endY && y > start && x >= start && x <= endX && z >= start && z <= endX) {
             // Terrain
             const val = getVal(density, x, y, z);
             const vY = getVal(density, x, y + 1, z);
             if ((val > ISO_LEVEL) !== (vY > ISO_LEVEL)) {
                 tryPush(bufIdx(x-1,y,z-1), bufIdx(x,y,z-1), bufIdx(x-1,y,z), bufIdx(x,y,z), val > ISO_LEVEL, false, 0);
             }
             // Water
             const gw = getWaterEffectiveDensity;
             const wv = gw(density, material, x, y, z);
             const wY = gw(density, material, x, y + 1, z);
             if ((wv > ISO_LEVEL) !== (wY > ISO_LEVEL)) {
                 const insideMat = (wv > ISO_LEVEL) ? getMat(material, x, y, z) : getMat(material, x, y+1, z);
                 tryPush(bufIdx(x-1,y,z-1), bufIdx(x,y,z-1), bufIdx(x-1,y,z), bufIdx(x,y,z), wv > ISO_LEVEL, true, insideMat);
             }
         }

         // --- Z Face ---
         if (z <= endX && z > start && x >= start && x <= endX && y >= start && y < endY) {
             // Terrain
             const val = getVal(density, x, y, z);
             const vZ = getVal(density, x, y, z + 1);
             if ((val > ISO_LEVEL) !== (vZ > ISO_LEVEL)) {
                 tryPush(bufIdx(x-1,y-1,z), bufIdx(x,y-1,z), bufIdx(x-1,y,z), bufIdx(x,y,z), val > ISO_LEVEL, false, 0);
             }
             // Water
             const gw = getWaterEffectiveDensity;
             const wv = gw(density, material, x, y, z);
             const wZ = gw(density, material, x, y, z + 1);
             if ((wv > ISO_LEVEL) !== (wZ > ISO_LEVEL)) {
                 const insideMat = (wv > ISO_LEVEL) ? getMat(material, x, y, z) : getMat(material, x, y, z+1);
                 tryPush(bufIdx(x-1,y-1,z), bufIdx(x,y-1,z), bufIdx(x-1,y,z), bufIdx(x,y,z), wv > ISO_LEVEL, true, insideMat);
             }
         }
      }
    }
  }

  return {
    positions: new Float32Array(tVerts),
    indices: new Uint32Array(tInds),
    normals: new Float32Array(tNorms),
    materials: new Float32Array(tMats),
    wetness: new Float32Array(tWets),
    mossiness: new Float32Array(tMoss),

    waterPositions: new Float32Array(wVerts),
    waterIndices: new Uint32Array(wInds),
    waterNormals: new Float32Array(wNorms)
  };
}
