
import { TOTAL_SIZE, TOTAL_HEIGHT, ISO_LEVEL, PAD, CHUNK_SIZE } from '../constants';
import { MeshData, MaterialType } from '../types';

const sizeXZ = TOTAL_SIZE;
const sizeY = TOTAL_HEIGHT;

const getIdx = (x: number, y: number, z: number) => x + y * sizeXZ + z * sizeXZ * sizeY;

const getVal = (density: Float32Array, x: number, y: number, z: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= sizeXZ || y >= sizeY || z >= sizeXZ) return -1.0;
  return density[getIdx(x, y, z)];
};

const getMat = (material: Uint8Array, x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeXZ || y >= sizeY || z >= sizeXZ) return 0;
    return material[getIdx(x, y, z)];
};

const getByte = (arr: Uint8Array, x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeXZ || y >= sizeY || z >= sizeXZ) return 0;
    return arr[getIdx(x, y, z)];
};

export function generateMesh(density: Float32Array, material: Uint8Array, wetness: Uint8Array, mossiness: Uint8Array): MeshData {
  const vertices: number[] = [];
  const indices: number[] = [];
  const mats: number[] = []; 
  const norms: number[] = [];
  const wets: number[] = [];
  const moss: number[] = [];
  
  const vertexIndices = new Int32Array(sizeXZ * sizeY * sizeXZ).fill(-1);
  const cellPositions = new Float32Array(sizeXZ * sizeY * sizeXZ * 3).fill(NaN);

  // 1. Generate Vertices (Surface Nets)
  for (let z = 0; z < sizeXZ - 1; z++) {
    for (let y = 0; y < sizeY - 1; y++) {
      for (let x = 0; x < sizeXZ - 1; x++) {
        
        const v000 = getVal(density, x, y, z);
        const v100 = getVal(density, x + 1, y, z);
        const v010 = getVal(density, x, y + 1, z);
        const v110 = getVal(density, x + 1, y + 1, z);
        const v001 = getVal(density, x, y, z + 1);
        const v101 = getVal(density, x + 1, y, z + 1);
        const v011 = getVal(density, x, y + 1, z + 1);
        const v111 = getVal(density, x + 1, y + 1, z + 1);
        
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

             const cIdx = getIdx(x, y, z);
             const offset = cIdx * 3;
             cellPositions[offset] = avgX;
             cellPositions[offset + 1] = avgY;
             cellPositions[offset + 2] = avgZ;
             vertexIndices[cIdx] = 1; // Mark valid
        }
      }
    }
  }

  // 2. Direct Output (DISABLE SMOOTHING FOR DEBUG)
  for (let z = 0; z < sizeXZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeXZ; x++) {
         const cIdx = getIdx(x,y,z);
         if (vertexIndices[cIdx] !== -1) {
             const px = cellPositions[cIdx * 3];
             const py = cellPositions[cIdx * 3 + 1];
             const pz = cellPositions[cIdx * 3 + 2];

             const snapEpsilon = 0.02;
             const snapBoundary = (v: number, max: number) => {
               if (Math.abs(v - PAD) < snapEpsilon) return PAD;
               if (Math.abs(v - (PAD + max)) < snapEpsilon) return PAD + max;
               return v;
             };

             const fx = snapBoundary(px, CHUNK_SIZE) - PAD;
             const fy = snapBoundary(py, CHUNK_HEIGHT) - PAD;
             const fz = snapBoundary(pz, CHUNK_SIZE) - PAD;

             vertices.push(fx, fy, fz);
             vertexIndices[cIdx] = (vertices.length / 3) - 1;

             // Normals
             const nx = getVal(density, Math.round(px) - 1, Math.round(py), Math.round(pz)) -
                        getVal(density, Math.round(px) + 1, Math.round(py), Math.round(pz));
             const ny = getVal(density, Math.round(px), Math.round(py) - 1, Math.round(pz)) -
                        getVal(density, Math.round(px), Math.round(py) + 1, Math.round(pz));
             const nz = getVal(density, Math.round(px), Math.round(py), Math.round(pz) - 1) -
                        getVal(density, Math.round(px), Math.round(py), Math.round(pz) + 1);
             const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
             if (len > 0.0001) norms.push(nx/len, ny/len, nz/len);
             else norms.push(0, 1, 0);

             // Materials (Sample center of cell)
             let bestMat = MaterialType.DIRT; 
             let minSolidVal = 99999.0;
             let bestWet = 0;
             let bestMoss = 0;

             const checkMat = (mx: number, my: number, mz: number) => {
                 const val = getVal(density, mx, my, mz);
                 if (val > ISO_LEVEL) {
                    const m = getMat(material, mx, my, mz);
                    if (m !== 0 && val < minSolidVal) {
                        minSolidVal = val;
                        bestMat = m;
                        bestWet = getByte(wetness, mx, my, mz);
                        bestMoss = getByte(mossiness, mx, my, mz);
                    }
                 }
             };
             checkMat(x,y,z);
             checkMat(x+1,y,z);
             checkMat(x,y+1,z); // etc... simplified for debug

             mats.push(bestMat);
             wets.push(bestWet / 255.0);
             moss.push(bestMoss / 255.0);
         }
      }
    }
  }
  
  // 3. Generate Quads
  const start = PAD;
  const endX = PAD + CHUNK_SIZE;
  const endY = PAD + CHUNK_HEIGHT;

  const pushQuad = (c0: number, c1: number, c2: number, c3: number, flipped: boolean) => {
    if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
        if (!flipped) indices.push(c0, c1, c2, c2, c1, c3);
        else indices.push(c2, c1, c0, c3, c1, c2);
    }
 };

  for (let z = start; z <= endX; z++) {
    for (let y = start; y <= endY; y++) {
      for (let x = start; x <= endX; x++) {
         const val = getVal(density, x, y, z);
         const vX = getVal(density, x + 1, y, z);
         if (x < endX && y > start && z > start && (val > ISO_LEVEL) !== (vX > ISO_LEVEL)) {
             pushQuad(
                 vertexIndices[getIdx(x, y-1, z-1)], vertexIndices[getIdx(x, y-1, z)],
                 vertexIndices[getIdx(x, y, z-1)], vertexIndices[getIdx(x, y, z)],
                 val > ISO_LEVEL
             );
         }
         const vY = getVal(density, x, y + 1, z);
         if (y < endY && x > start && z > start && (val > ISO_LEVEL) !== (vY > ISO_LEVEL)) {
             pushQuad(
                 vertexIndices[getIdx(x-1, y, z-1)], vertexIndices[getIdx(x, y, z-1)],
                 vertexIndices[getIdx(x-1, y, z)], vertexIndices[getIdx(x, y, z)],
                 val > ISO_LEVEL
             );
         }
         const vZ = getVal(density, x, y, z + 1);
         if (z < endX && x > start && y > start && (val > ISO_LEVEL) !== (vZ > ISO_LEVEL)) {
             pushQuad(
                 vertexIndices[getIdx(x-1, y-1, z)], vertexIndices[getIdx(x, y-1, z)],
                 vertexIndices[getIdx(x-1, y, z)], vertexIndices[getIdx(x, y, z)],
                 val > ISO_LEVEL
             );
         }
      }
    }
  }

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
    normals: new Float32Array(norms),
    materials: new Float32Array(mats),
    wetness: new Float32Array(wets),
    mossiness: new Float32Array(moss)
  };
}
