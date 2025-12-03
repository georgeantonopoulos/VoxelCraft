import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, CHUNK_SIZE_XZ, CHUNK_SIZE_Y, PAD, ISO_LEVEL, MESH_Y_OFFSET } from '@/constants';
import { MeshData, MaterialType } from '@/types';

const SIZE_X = TOTAL_SIZE_XZ;
const SIZE_Y = TOTAL_SIZE_Y;
const SIZE_Z = TOTAL_SIZE_XZ;

const bufIdx = (x: number, y: number, z: number) => x + y * SIZE_X + z * SIZE_X * SIZE_Y;

// Fixed channel ordering shared with the shader
const MATERIAL_CHANNELS = [
  MaterialType.AIR,
  MaterialType.BEDROCK,
  MaterialType.STONE,
  MaterialType.DIRT,
  MaterialType.GRASS,
  MaterialType.SAND,
  MaterialType.SNOW,
  MaterialType.CLAY,
  MaterialType.WATER,
  MaterialType.MOSSY_STONE,
  MaterialType.RED_SAND,
  MaterialType.TERRACOTTA,
  MaterialType.ICE,
  MaterialType.JUNGLE_GRASS,
  MaterialType.GLOW_STONE,
  MaterialType.OBSIDIAN
] as const;

const MATERIAL_TO_CHANNEL = (() => {
  const maxId = Math.max(...MATERIAL_CHANNELS);
  const map = new Int8Array(maxId + 1).fill(-1);
  MATERIAL_CHANNELS.forEach((mat, idx) => {
    if (mat >= 0 && mat < map.length) map[mat] = idx;
  });
  return map;
})();

const resolveChannel = (mat: number) => (mat >= 0 && mat < MATERIAL_TO_CHANNEL.length ? MATERIAL_TO_CHANNEL[mat] : -1);
/**
 * Clamp a voxel sample coordinate so central differences stay inside the padded grid.
 */
const clampSampleCoord = (v: number, max: number) => Math.min(Math.max(v, 1), max - 2);
const MIN_NORMAL_LEN_SQ = 0.0001;

// Helpers
const getVal = (density: Float32Array, x: number, y: number, z: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return -1.0;
  return density[bufIdx(x, y, z)];
};

const getMat = (material: Uint8Array, x: number, y: number, z: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return 0;
  return material[bufIdx(x, y, z)];
};

const getByte = (arr: Uint8Array, x: number, y: number, z: number) => {
  if (x < 0 || y < 0 || z < 0 || x >= SIZE_X || y >= SIZE_Y || z >= SIZE_Z) return 0;
  return arr[bufIdx(x, y, z)];
};

export function generateMesh(
  density: Float32Array,
  material: Uint8Array,
  wetness?: Uint8Array,
  mossiness?: Uint8Array
): MeshData {
  const wetData = wetness ?? new Uint8Array(SIZE_X * SIZE_Y * SIZE_Z);
  const mossData = mossiness ?? new Uint8Array(SIZE_X * SIZE_Y * SIZE_Z);

  // --- Buffers ---
  const tVerts: number[] = [];
  const tInds: number[] = [];

  // New Attributes
  const tMatIndices: number[] = []; // uvec4 (flattened)
  const tMatWeights: number[] = []; // vec4 (flattened)

  const tNorms: number[] = [];
  const tWets: number[] = [];
  const tMoss: number[] = [];

  const tVertIdx = new Int32Array(SIZE_X * SIZE_Y * SIZE_Z).fill(-1);

  const snapEpsilon = 0.02;
  const snapBoundary = (v: number, limit: number) => {
    if (Math.abs(v - PAD) < snapEpsilon) return PAD;
    if (Math.abs(v - (PAD + limit)) < snapEpsilon) return PAD + limit;
    return v;
  };

  // 1. Vertex Generation
  for (let z = 0; z < SIZE_Z - 1; z++) {
    for (let y = 0; y < SIZE_Y - 1; y++) {
      for (let x = 0; x < SIZE_X - 1; x++) {

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

        if (mask !== 0 && mask !== 255) {
          let edgeCount = 0;
          let avgX = 0;
          let avgY = 0;
          let avgZ = 0;

          const addInter = (valA: number, valB: number, axis: 'x' | 'y' | 'z', offX: number, offY: number, offZ: number) => {
            if ((valA > ISO_LEVEL) !== (valB > ISO_LEVEL)) {
              let denominator = valB - valA;
              if (Math.abs(denominator) < 0.00001) {
                denominator = (Math.sign(denominator) || 1) * 0.00001;
              }
              const mu = (ISO_LEVEL - valA) / denominator;
              const clampedMu = Math.max(0.001, Math.min(0.999, mu));

              if (axis === 'x') { avgX += x + clampedMu; avgY += y + offY; avgZ += z + offZ; }
              if (axis === 'y') { avgX += x + offX; avgY += y + clampedMu; avgZ += z + offZ; }
              if (axis === 'z') { avgX += x + offX; avgY += y + offY; avgZ += z + clampedMu; }
              edgeCount++;
            }
          };

          addInter(v000, v100, 'x', 0, 0, 0);
          addInter(v010, v110, 'x', 0, 1, 0);
          addInter(v001, v101, 'x', 0, 0, 1);
          addInter(v011, v111, 'x', 0, 1, 1);
          addInter(v000, v010, 'y', 0, 0, 0);
          addInter(v100, v110, 'y', 1, 0, 0);
          addInter(v001, v011, 'y', 0, 0, 1);
          addInter(v101, v111, 'y', 1, 0, 1);
          addInter(v000, v001, 'z', 0, 0, 0);
          addInter(v100, v101, 'z', 1, 0, 0);
          addInter(v010, v011, 'z', 0, 1, 0);
          addInter(v110, v111, 'z', 1, 1, 0);

          if (edgeCount > 0) {
            avgX /= edgeCount;
            avgY /= edgeCount;
            avgZ /= edgeCount;

            const px = snapBoundary(avgX, CHUNK_SIZE_XZ) - PAD;
            const py = snapBoundary(avgY, CHUNK_SIZE_Y) - PAD + MESH_Y_OFFSET;
            const pz = snapBoundary(avgZ, CHUNK_SIZE_XZ) - PAD;

            tVerts.push(px, py, pz);
            const centerX = Math.round(avgX);
            const centerY = Math.round(avgY);
            const centerZ = Math.round(avgZ);

            // Normal Calculation
            const fx = avgX - x;
            const fy = avgY - y;
            const fz = avgZ - z;
            const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

            const x00 = lerp(v000, v010, fy);
            const x01 = lerp(v001, v011, fy);
            const val_x0 = lerp(x00, x01, fz);
            const x10 = lerp(v100, v110, fy);
            const x11 = lerp(v101, v111, fy);
            const val_x1 = lerp(x10, x11, fz);
            const nx = val_x0 - val_x1;

            const y00 = lerp(v000, v100, fx);
            const y01 = lerp(v001, v101, fx);
            const val_y0 = lerp(y00, y01, fz);
            const y10 = lerp(v010, v110, fx);
            const y11 = lerp(v011, v111, fx);
            const val_y1 = lerp(y10, y11, fz);
            const ny = val_y0 - val_y1;

            const z00 = lerp(v000, v100, fx);
            const z01 = lerp(v010, v110, fx);
            const val_z0 = lerp(z00, z01, fy);
            const z10 = lerp(v001, v101, fx);
            const z11 = lerp(v011, v111, fx);
            const val_z1 = lerp(z10, z11, fy);
            const nz = val_z0 - val_z1;

            const lenSq = nx * nx + ny * ny + nz * nz;

            if (Number.isFinite(lenSq) && lenSq >= MIN_NORMAL_LEN_SQ) {
              const len = Math.sqrt(lenSq);
              tNorms.push(nx / len, ny / len, nz / len);
            } else {
              const sx = clampSampleCoord(centerX, SIZE_X);
              const sy = clampSampleCoord(centerY, SIZE_Y);
              const sz = clampSampleCoord(centerZ, SIZE_Z);

              const fnx = getVal(density, sx + 1, sy, sz) - getVal(density, sx - 1, sy, sz);
              const fny = getVal(density, sx, sy + 1, sz) - getVal(density, sx, sy - 1, sz);
              const fnz = getVal(density, sx, sy, sz + 1) - getVal(density, sx, sy, sz - 1);
              const fallbackLenSq = fnx * fnx + fny * fny + fnz * fnz;

              if (Number.isFinite(fallbackLenSq) && fallbackLenSq >= 0.000001) {
                const len = Math.sqrt(fallbackLenSq);
                tNorms.push(fnx / len, fny / len, fnz / len);
              } else {
                tNorms.push(0, 1, 0);
              }
            }

            // Fixed-channel weight splatting
            const BLEND_RADIUS = 3;
            const localWeights = new Float32Array(16);
            let bestWet = 0;
            let bestMoss = 0;
            let bestVal = -Infinity;
            let totalWeight = 0;

            for (let dy = -BLEND_RADIUS; dy <= BLEND_RADIUS; dy++) {
              for (let dz = -BLEND_RADIUS; dz <= BLEND_RADIUS; dz++) {
                for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
                  const sx = centerX + dx;
                  const sy = centerY + dy;
                  const sz = centerZ + dz;

                  const val = getVal(density, sx, sy, sz);
                  if (val > ISO_LEVEL) {
                    const mat = getMat(material, sx, sy, sz);
                    const channel = resolveChannel(mat);
                    if (channel > -1 && mat !== MaterialType.AIR && mat !== MaterialType.WATER) {
                      const distSq = dx * dx + dy * dy + dz * dz;
                      const weight = 1.0 / (distSq + 0.1);
                      localWeights[channel] += weight;
                      totalWeight += weight;
                    }

                    if (val > bestVal) {
                      bestVal = val;
                      bestWet = getByte(wetData, sx, sy, sz);
                      bestMoss = getByte(mossData, sx, sy, sz);
                    }
                  }
                }
              }
            }

            // Fallback
            if (totalWeight <= 0.0001) {
              const dirtChannel = resolveChannel(MaterialType.DIRT);
              if (dirtChannel > -1) {
                 localWeights[dirtChannel] = 1.0;
                 totalWeight = 1.0;
              }
            } else {
                // Normalize all first
                for(let i=0; i<16; i++) localWeights[i] /= totalWeight;
            }

            // Find Top 4 Weights
            // Map to objects
            const weightObjs = [];
            for(let i=0; i<16; i++) {
                if (localWeights[i] > 0) weightObjs.push({ id: i, w: localWeights[i] });
            }
            // Sort Descending
            weightObjs.sort((a, b) => b.w - a.w);

            // Take top 4
            const finalIndices = [0, 0, 0, 0];
            const finalWeights = [0, 0, 0, 0];
            let sumTop4 = 0;

            for(let i=0; i<4 && i<weightObjs.length; i++) {
                finalIndices[i] = weightObjs[i].id;
                finalWeights[i] = weightObjs[i].w;
                sumTop4 += weightObjs[i].w;
            }

            // Renormalize if sum > 0
            if (sumTop4 > 0.0001) {
                for(let i=0; i<4; i++) finalWeights[i] /= sumTop4;
            } else {
                // Should not happen due to fallback, but safe guard
                finalIndices[0] = 2; // Stone
                finalWeights[0] = 1.0;
            }

            // Push to buffers
            tMatIndices.push(...finalIndices);
            tMatWeights.push(...finalWeights);

            tWets.push(bestWet / 255.0);
            tMoss.push(bestMoss / 255.0);
            tVertIdx[bufIdx(x, y, z)] = (tVerts.length / 3) - 1;
          }
        }
      }
    }
  }

  // 2. Quad Generation
  const start = PAD;
  const endX = PAD + CHUNK_SIZE_XZ;
  const endY = PAD + CHUNK_SIZE_Y;

  const pushQuad = (i0: number, i1: number, i2: number, i3: number, flipped: boolean) => {
    const c0 = tVertIdx[i0];
    const c1 = tVertIdx[i1];
    const c2 = tVertIdx[i2];
    const c3 = tVertIdx[i3];

    if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
      if (!flipped) tInds.push(c0, c1, c2, c2, c1, c3);
      else tInds.push(c2, c1, c0, c3, c1, c2);
    }
  };

  for (let z = start; z <= endX; z++) {
    for (let y = start; y <= endY; y++) {
      for (let x = start; x <= endX; x++) {
        const val = getVal(density, x, y, z);

        if (x < endX) {
          const vX = getVal(density, x + 1, y, z);
          if ((val > ISO_LEVEL) !== (vX > ISO_LEVEL)) {
            pushQuad(
              bufIdx(x, y - 1, z - 1), bufIdx(x, y - 1, z),
              bufIdx(x, y, z - 1), bufIdx(x, y, z),
              val > ISO_LEVEL
            );
          }
        }

        if (y < endY) {
          const vY = getVal(density, x, y + 1, z);
          if ((val > ISO_LEVEL) !== (vY > ISO_LEVEL)) {
            pushQuad(
              bufIdx(x - 1, y, z - 1), bufIdx(x, y, z - 1),
              bufIdx(x - 1, y, z), bufIdx(x, y, z),
              val > ISO_LEVEL
            );
          }
        }

        if (z < endX) {
          const vZ = getVal(density, x, y, z + 1);
          if ((val > ISO_LEVEL) !== (vZ > ISO_LEVEL)) {
            // Swapped indices 1 and 2 for Z-face winding
            pushQuad(
              bufIdx(x - 1, y - 1, z), bufIdx(x - 1, y, z),
              bufIdx(x, y - 1, z), bufIdx(x, y, z),
              val > ISO_LEVEL
            );
          }
        }
      }
    }
  }

  return {
    positions: new Float32Array(tVerts),
    indices: new Uint32Array(tInds),
    normals: new Float32Array(tNorms),
    materialIndices: new Uint8Array(tMatIndices), // Output correct type
    materialWeights: new Float32Array(tMatWeights), // Output correct type
    wetness: new Float32Array(tWets),
    mossiness: new Float32Array(tMoss),
    waterPositions: new Float32Array(0),
    waterIndices: new Uint32Array(0),
    waterNormals: new Float32Array(0),
  } as MeshData;
}
