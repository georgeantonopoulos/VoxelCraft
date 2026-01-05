import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, CHUNK_SIZE_XZ, CHUNK_SIZE_Y, PAD, ISO_LEVEL, MESH_Y_OFFSET, SNAP_EPSILON, WATER_LEVEL, LIGHT_CELL_SIZE, LIGHT_GRID_SIZE_XZ, LIGHT_GRID_SIZE_Y } from '@/constants';
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


/**
 * Computes smoothed normals using area-weighted face normal averaging.
 * This produces smoother shading on steep slopes and cave openings by
 * blending normals from adjacent triangles based on their surface area.
 *
 * Larger triangles contribute more to the final normal, which naturally
 * weights toward the dominant surface orientation and reduces artifacts
 * from small sliver triangles.
 */
function computeAreaWeightedNormals(
  positions: number[],
  indices: number[],
  originalNormals: number[]
): number[] {
  const vertexCount = positions.length / 3;

  // Accumulator for weighted normals (initialized to zero)
  const accumulated = new Float32Array(vertexCount * 3);

  // First pass: accumulate area-weighted face normals
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

    // Get vertex positions
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];

    // Edge vectors
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;

    // Cross product = face normal × 2×area (unnormalized)
    // We don't normalize here - the magnitude IS the area weight
    const crossX = e1y * e2z - e1z * e2y;
    const crossY = e1z * e2x - e1x * e2z;
    const crossZ = e1x * e2y - e1y * e2x;

    // Add to each vertex of this triangle
    accumulated[i0 * 3 + 0] += crossX;
    accumulated[i0 * 3 + 1] += crossY;
    accumulated[i0 * 3 + 2] += crossZ;

    accumulated[i1 * 3 + 0] += crossX;
    accumulated[i1 * 3 + 1] += crossY;
    accumulated[i1 * 3 + 2] += crossZ;

    accumulated[i2 * 3 + 0] += crossX;
    accumulated[i2 * 3 + 1] += crossY;
    accumulated[i2 * 3 + 2] += crossZ;
  }

  // Second pass: normalize accumulated normals, falling back to original if degenerate
  const result: number[] = new Array(originalNormals.length);

  for (let i = 0; i < vertexCount; i++) {
    const nx = accumulated[i * 3 + 0];
    const ny = accumulated[i * 3 + 1];
    const nz = accumulated[i * 3 + 2];
    const lenSq = nx * nx + ny * ny + nz * nz;

    if (lenSq >= MIN_NORMAL_LEN_SQ) {
      const len = Math.sqrt(lenSq);
      result[i * 3 + 0] = nx / len;
      result[i * 3 + 1] = ny / len;
      result[i * 3 + 2] = nz / len;
    } else {
      // Fall back to original density-gradient normal
      result[i * 3 + 0] = originalNormals[i * 3 + 0];
      result[i * 3 + 1] = originalNormals[i * 3 + 1];
      result[i * 3 + 2] = originalNormals[i * 3 + 2];
    }
  }

  return result;
}

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

const isLiquidMaterial = (mat: number) => mat === MaterialType.WATER || mat === MaterialType.ICE;

/**
 * Sample the light grid at a given local chunk position.
 * Returns RGB values as floats (0-1 range).
 */
function sampleLightGrid(
  lightGrid: Uint8Array | undefined,
  localX: number,
  localY: number,
  localZ: number
): [number, number, number] {
  if (!lightGrid || lightGrid.length === 0) {
    // Fallback ambient when no light grid
    return [0.35, 0.35, 0.35];
  }

  // Convert local position to grid cell (accounting for MESH_Y_OFFSET)
  const worldY = localY - MESH_Y_OFFSET;
  const cellX = Math.floor(localX / LIGHT_CELL_SIZE);
  const cellY = Math.floor((worldY + 35) / LIGHT_CELL_SIZE); // +35 to undo offset
  const cellZ = Math.floor(localZ / LIGHT_CELL_SIZE);

  // Clamp to grid bounds
  const cx = Math.max(0, Math.min(LIGHT_GRID_SIZE_XZ - 1, cellX));
  const cy = Math.max(0, Math.min(LIGHT_GRID_SIZE_Y - 1, cellY));
  const cz = Math.max(0, Math.min(LIGHT_GRID_SIZE_XZ - 1, cellZ));

  // Calculate grid index (RGBA stride of 4)
  const idx = (cx + cy * LIGHT_GRID_SIZE_XZ + cz * LIGHT_GRID_SIZE_XZ * LIGHT_GRID_SIZE_Y) * 4;

  // Read RGB and convert from 0-255 to 0-1
  const r = lightGrid[idx + 0] / 255;
  const g = lightGrid[idx + 1] / 255;
  const b = lightGrid[idx + 2] / 255;

  return [r, g, b];
}

export type WaterSurfaceMeshData = {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  shoreMask: Uint8Array;
};

/**
 * Generates a separate mesh for the water surface.
 * Rendering water as a separate mesh avoids expensive "water volume" faces against the seabed.
 * 
 * Uses a simple chunk-spanning quad at WATER_LEVEL. Shoreline transitions are handled entirely
 * by the shore mask SDF in the shader, ensuring seamless chunk boundaries.
 *
 * IMPORTANT: This mesh is purely visual (no colliders). Player interaction queries the voxel
 * material grid at runtime rather than relying on physics for water.
 */
export function generateWaterSurfaceMesh(density: Float32Array, material: Uint8Array): WaterSurfaceMeshData {
  const waterVerts: number[] = [];
  const waterInds: number[] = [];
  const waterNorms: number[] = [];

  // Convert world-space sea level to the chunk's padded grid Y index.
  const seaGridYRaw = Math.floor(WATER_LEVEL - MESH_Y_OFFSET) + PAD;
  const seaGridY = Math.max(0, Math.min(SIZE_Y - 2, seaGridYRaw));

  const isLiquidCell = (x: number, y: number, z: number) => {
    const mat = getMat(material, x, y, z);
    if (!isLiquidMaterial(mat)) return false;
    return getVal(density, x, y, z) <= ISO_LEVEL;
  };

  const waterW = CHUNK_SIZE_XZ;
  const waterH = CHUNK_SIZE_XZ;
  const waterMask = new Uint8Array(waterW * waterH);
  let hasAnyWater = false;

  for (let lz = 0; lz < waterH; lz++) {
    const gz = PAD + lz;
    for (let lx = 0; lx < waterW; lx++) {
      const gx = PAD + lx;
      const hasLiquid = isLiquidCell(gx, seaGridY, gz);
      const hasLiquidAbove = isLiquidCell(gx, seaGridY + 1, gz);
      const v = hasLiquid && !hasLiquidAbove ? 1 : 0;
      waterMask[lx + lz * waterW] = v;
      if (v) hasAnyWater = true;
    }
  }

  // Emit a chunk-wide sea-level quad only if this chunk actually has sea-level water.
  // The shoreline is handled by a mask in WaterMaterial, so geometry stays simple.
  // Using exact chunk boundaries (0 to CHUNK_SIZE_XZ) ensures seamless tiling.
  if (hasAnyWater) {
    const y = WATER_LEVEL;
    waterVerts.push(
      0, y, 0,
      CHUNK_SIZE_XZ, y, 0,
      0, y, CHUNK_SIZE_XZ,
      CHUNK_SIZE_XZ, y, CHUNK_SIZE_XZ
    );
    waterNorms.push(
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0
    );
    waterInds.push(
      0, 2, 1,
      2, 3, 1
    );
  }

  // --- Compute shoreline SDF mask for the shader ---
  const shoreMask = new Uint8Array(waterW * waterH);
  if (hasAnyWater) {
    const INF = 0x3fff;
    const insideDist = new Int16Array(waterW * waterH);
    const outsideDist = new Int16Array(waterW * waterH);
    insideDist.fill(INF);
    outsideDist.fill(INF);

    const qx: number[] = [];
    const qz: number[] = [];
    let qh = 0;
    const push = (x: number, z: number) => { qx.push(x); qz.push(z); };
    const isWater = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= waterW || z >= waterH) return false;
      return waterMask[x + z * waterW] === 1;
    };

    const hasDiffNeighbor = (x: number, z: number) => {
      const v = isWater(x, z);
      if (x > 0 && isWater(x - 1, z) !== v) return true;
      if (x < waterW - 1 && isWater(x + 1, z) !== v) return true;
      if (z > 0 && isWater(x, z - 1) !== v) return true;
      if (z < waterH - 1 && isWater(x, z + 1) !== v) return true;
      return false;
    };

    // BFS for inside water distance
    for (let z = 0; z < waterH; z++) {
      for (let x = 0; x < waterW; x++) {
        if (!hasDiffNeighbor(x, z)) continue;
        if (isWater(x, z)) {
          insideDist[x + z * waterW] = 0;
          push(x, z);
        }
      }
    }
    while (qh < qx.length) {
      const x = qx[qh];
      const z = qz[qh];
      qh++;
      const d = insideDist[x + z * waterW];
      const nd = d + 1;
      const step = (nx: number, nz: number) => {
        if (nx < 0 || nz < 0 || nx >= waterW || nz >= waterH) return;
        if (!isWater(nx, nz)) return;
        const i = nx + nz * waterW;
        if (insideDist[i] <= nd) return;
        insideDist[i] = nd;
        push(nx, nz);
      };
      step(x - 1, z); step(x + 1, z); step(x, z - 1); step(x, z + 1);
    }

    // BFS for outside (land) distance
    qx.length = 0; qz.length = 0; qh = 0;
    for (let z = 0; z < waterH; z++) {
      for (let x = 0; x < waterW; x++) {
        if (!hasDiffNeighbor(x, z)) continue;
        if (!isWater(x, z)) {
          outsideDist[x + z * waterW] = 0;
          push(x, z);
        }
      }
    }
    while (qh < qx.length) {
      const x = qx[qh];
      const z = qz[qh];
      qh++;
      const d = outsideDist[x + z * waterW];
      const nd = d + 1;
      const step = (nx: number, nz: number) => {
        if (nx < 0 || nz < 0 || nx >= waterW || nz >= waterH) return;
        if (isWater(nx, nz)) return;
        const i = nx + nz * waterW;
        if (outsideDist[i] <= nd) return;
        outsideDist[i] = nd;
        push(nx, nz);
      };
      step(x - 1, z); step(x + 1, z); step(x, z - 1); step(x, z + 1);
    }

    // Encode signed distance: water positive, land negative, boundary = 0.5
    const maxDist = 10.0;
    for (let z = 0; z < waterH; z++) {
      for (let x = 0; x < waterW; x++) {
        const i = x + z * waterW;
        const sdf = isWater(x, z)
          ? Math.min(maxDist, insideDist[i])
          : -Math.min(maxDist, outsideDist[i]);
        const n = Math.max(0, Math.min(1, 0.5 + (sdf / maxDist) * 0.5));
        shoreMask[i] = Math.floor(n * 255);
      }
    }
  }

  return {
    positions: new Float32Array(waterVerts),
    indices: new Uint32Array(waterInds),
    normals: new Float32Array(waterNorms),
    shoreMask,
  };
}

/**
 * The main entry point for mesh generation. Extracting both visual and physics geometry
 * from the density and material buffers using a Dual-Contouring-like Surface Nets approach.
 */
export function generateMesh(
  density: Float32Array,
  material: Uint8Array,
  wetness?: Uint8Array,
  mossiness?: Uint8Array,
  lightGrid?: Uint8Array
): MeshData {
  const wetData = wetness ?? new Uint8Array(SIZE_X * SIZE_Y * SIZE_Z);
  const mossData = mossiness ?? new Uint8Array(SIZE_X * SIZE_Y * SIZE_Z);

  // --- Intermediate Buffers ---
  const tVerts: number[] = [];
  const tInds: number[] = [];
  const tWa: number[] = [];
  const tWb: number[] = [];
  const tWc: number[] = [];
  const tWd: number[] = [];
  const tNorms: number[] = [];
  const tWets: number[] = [];
  const tMoss: number[] = [];
  const tCavity: number[] = [];
  const tLightColors: number[] = []; // Per-vertex GI light

  const tVertIdx = new Int32Array(SIZE_X * SIZE_Y * SIZE_Z).fill(-1);


  // Snap epsilon is used to close seams by snapping vertices near chunk borders.
  // IMPORTANT: Do NOT clamp vertices to the chunk interior. Surface-Nets-style vertices can land
  // slightly outside the chunk due to averaging edge intersections. We only snap very-near-boundary
  // vertices onto the exact plane and rely on index emission to manage borders.
  //
  // Snap epsilon is tuned via Leva in `App.tsx` through `setSnapEpsilon(...)`.
  // This is used to close seams by snapping vertices near chunk borders.
  //
  // IMPORTANT: Do NOT clamp vertices to the chunk interior. Surface-Nets-style vertices can land
  // slightly outside the chunk due to averaging edge intersections, and hard clamping can literally
  // "cut" the surface at the border, producing visible holes into caverns. Instead, we only snap
  // very-near-boundary vertices onto the exact plane and rely on seam ownership (index emission)
  // + optional polygonOffset (debug) to mitigate any Z-fighting from overlaps.
  const snapEpsilon = SNAP_EPSILON;
  const snapBoundary = (v: number, limit: number) => {
    const minV = PAD;
    const maxV = PAD + limit;
    if (Math.abs(v - minV) < snapEpsilon) return minV;
    if (Math.abs(v - maxV) < snapEpsilon) return maxV;
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
          let avgX = 0, avgY = 0, avgZ = 0;

          const addInter = (valA: number, valB: number, axis: 'x' | 'y' | 'z', offX: number, offY: number, offZ: number) => {
            if ((valA > ISO_LEVEL) !== (valB > ISO_LEVEL)) {
              // 1. Safe Denominator: Prevent Infinity/NaN
              // Preserve sign to keep vertex on correct side of edge
              let denominator = valB - valA;
              if (Math.abs(denominator) < 0.00001) denominator = (Math.sign(denominator) || 1) * 0.00001;
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
            avgX /= edgeCount; avgY /= edgeCount; avgZ /= edgeCount;
            const px = snapBoundary(avgX, CHUNK_SIZE_XZ) - PAD;
            const py = snapBoundary(avgY, CHUNK_SIZE_Y) - PAD + MESH_Y_OFFSET;
            const pz = snapBoundary(avgZ, CHUNK_SIZE_XZ) - PAD;

            tVerts.push(px, py, pz);
            const centerX = Math.round(avgX), centerY = Math.round(avgY), centerZ = Math.round(avgZ);

            // Central difference normal calculation - simpler and faster than trilinear interpolation
            // with minimal visual quality loss. Uses 6 density samples instead of 8 lerps.
            const sx = clampSampleCoord(centerX, SIZE_X), sy = clampSampleCoord(centerY, SIZE_Y), sz = clampSampleCoord(centerZ, SIZE_Z);
            const nx = getVal(density, sx - 1, sy, sz) - getVal(density, sx + 1, sy, sz);
            const ny = getVal(density, sx, sy - 1, sz) - getVal(density, sx, sy + 1, sz);
            const nz = getVal(density, sx, sy, sz - 1) - getVal(density, sx, sy, sz + 1);
            const lenSq = nx * nx + ny * ny + nz * nz;

            if (Number.isFinite(lenSq) && lenSq >= MIN_NORMAL_LEN_SQ) {
              const len = Math.sqrt(lenSq);
              tNorms.push(nx / len, ny / len, nz / len);
            } else {
              tNorms.push(0, 1, 0);
            }

            // Reduced blend radius from 3 to 2: samples 5x5x5=125 voxels instead of 7x7x7=343 (2.7x faster)
            const BLEND_RADIUS = 2;
            // Fresh allocation per vertex - V8 returns pre-zeroed typed arrays, and small allocations
            // are very efficient in the nursery. This avoids the overhead of fill(0) per vertex.
            const localWeights = new Float32Array(16);
            let bestWet = 0, bestMoss = 0, bestVal = -Infinity;
            let totalWeight = 0, occTotalW = 0, occSolidW = 0;
            let nearestSolidMat = MaterialType.AIR, minSolidDistSq = Infinity;

            for (let dy = -BLEND_RADIUS; dy <= BLEND_RADIUS; dy++) {
              for (let dz = -BLEND_RADIUS; dz <= BLEND_RADIUS; dz++) {
                for (let dx = -BLEND_RADIUS; dx <= BLEND_RADIUS; dx++) {
                  const sx = centerX + dx, sy = centerY + dy, sz = centerZ + dz;
                  const val = getVal(density, sx, sy, sz);
                  const distSq = dx * dx + dy * dy + dz * dz;
                  const w = 1.0 / (distSq + 0.1);
                  occTotalW += w;
                  if (val > ISO_LEVEL) occSolidW += w;
                  if (val > ISO_LEVEL) {
                    const mat = getMat(material, sx, sy, sz);
                    if (mat !== MaterialType.AIR && !isLiquidMaterial(mat)) {
                      if (distSq < minSolidDistSq) { minSolidDistSq = distSq; nearestSolidMat = mat; }
                    }
                    const channel = resolveChannel(mat);
                    if (channel > -1 && mat !== MaterialType.AIR && mat !== MaterialType.WATER) { localWeights[channel] += w; totalWeight += w; }
                    if (val > bestVal) { bestVal = val; bestWet = getByte(wetData, sx, sy, sz); bestMoss = getByte(mossData, sx, sy, sz); }
                  }
                }
              }
            }
            if (totalWeight > 0.0001) { for (let i = 0; i < localWeights.length; i++) localWeights[i] /= totalWeight; }
            else if (nearestSolidMat !== MaterialType.AIR) { const channel = resolveChannel(nearestSolidMat); if (channel > -1) localWeights[channel] = 1.0; }
            else {
              const dirtChannel = resolveChannel(MaterialType.DIRT), sandChannel = resolveChannel(MaterialType.SAND);
              const fallbackChannel = ((centerY - PAD) + MESH_Y_OFFSET <= WATER_LEVEL + 4.0) ? sandChannel : dirtChannel;
              if (fallbackChannel > -1) localWeights[fallbackChannel] = 1.0;
            }

            tWa.push(localWeights[0], localWeights[1], localWeights[2], localWeights[3]);
            tWb.push(localWeights[4], localWeights[5], localWeights[6], localWeights[7]);
            tWc.push(localWeights[8], localWeights[9], localWeights[10], localWeights[11]);
            tWd.push(localWeights[12], localWeights[13], localWeights[14], localWeights[15]);
            tWets.push(bestWet / 255.0); tMoss.push(bestMoss / 255.0);
            const solidFrac = occTotalW > 0.0001 ? occSolidW / occTotalW : 0.5;
            tCavity.push(Math.max(0, Math.min(1, (solidFrac - 0.55) / (0.9 - 0.55))));

            // Sample GI light at vertex position
            const [lr, lg, lb] = sampleLightGrid(lightGrid, px, py, pz);
            tLightColors.push(lr, lg, lb);

            tVertIdx[bufIdx(x, y, z)] = (tVerts.length / 3) - 1;
          }
        }
      }
    }
  }

  const start = PAD, endX = PAD + CHUNK_SIZE_XZ, endY = PAD + CHUNK_SIZE_Y;

  /**
   * Push a quad as two triangles, choosing the shorter diagonal for splitting.
   * This minimizes distortion on non-planar quads (common at cave openings and steep slopes).
   *
   * Quad vertices:  c0 --- c1
   *                  |     |
   *                 c2 --- c3
   *
   * Two possible splits:
   *   - Diagonal c0-c3: triangles (c0,c1,c3) and (c0,c3,c2)
   *   - Diagonal c1-c2: triangles (c0,c1,c2) and (c2,c1,c3)
   *
   * We measure both diagonals and pick the shorter one to minimize triangle distortion.
   */
  const pushQuad = (i0: number, i1: number, i2: number, i3: number, flipped: boolean) => {
    const c0 = tVertIdx[i0], c1 = tVertIdx[i1], c2 = tVertIdx[i2], c3 = tVertIdx[i3];
    if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
      // Get vertex positions for diagonal length comparison
      const p0x = tVerts[c0 * 3], p0y = tVerts[c0 * 3 + 1], p0z = tVerts[c0 * 3 + 2];
      const p1x = tVerts[c1 * 3], p1y = tVerts[c1 * 3 + 1], p1z = tVerts[c1 * 3 + 2];
      const p2x = tVerts[c2 * 3], p2y = tVerts[c2 * 3 + 1], p2z = tVerts[c2 * 3 + 2];
      const p3x = tVerts[c3 * 3], p3y = tVerts[c3 * 3 + 1], p3z = tVerts[c3 * 3 + 2];

      // Choose diagonal split that minimizes the angle between resulting triangle normals.
      // This produces more consistent shading on non-planar quads (saddle shapes at cave openings).
      //
      // Quad layout:  c0 --- c1
      //                |     |
      //               c2 --- c3

      // Option A: Split along c0-c3 diagonal -> triangles (c0,c1,c3) and (c0,c3,c2)
      // Triangle A1 normal: (c1-c0) × (c3-c0)
      const a1e1x = p1x - p0x, a1e1y = p1y - p0y, a1e1z = p1z - p0z;
      const a1e2x = p3x - p0x, a1e2y = p3y - p0y, a1e2z = p3z - p0z;
      const a1nx = a1e1y * a1e2z - a1e1z * a1e2y;
      const a1ny = a1e1z * a1e2x - a1e1x * a1e2z;
      const a1nz = a1e1x * a1e2y - a1e1y * a1e2x;

      // Triangle A2 normal: (c3-c0) × (c2-c0)
      const a2e1x = p3x - p0x, a2e1y = p3y - p0y, a2e1z = p3z - p0z;
      const a2e2x = p2x - p0x, a2e2y = p2y - p0y, a2e2z = p2z - p0z;
      const a2nx = a2e1y * a2e2z - a2e1z * a2e2y;
      const a2ny = a2e1z * a2e2x - a2e1x * a2e2z;
      const a2nz = a2e1x * a2e2y - a2e1y * a2e2x;

      // Option B: Split along c1-c2 diagonal -> triangles (c0,c1,c2) and (c2,c1,c3)
      // Triangle B1 normal: (c1-c0) × (c2-c0)
      const b1e1x = p1x - p0x, b1e1y = p1y - p0y, b1e1z = p1z - p0z;
      const b1e2x = p2x - p0x, b1e2y = p2y - p0y, b1e2z = p2z - p0z;
      const b1nx = b1e1y * b1e2z - b1e1z * b1e2y;
      const b1ny = b1e1z * b1e2x - b1e1x * b1e2z;
      const b1nz = b1e1x * b1e2y - b1e1y * b1e2x;

      // Triangle B2 normal: (c1-c2) × (c3-c2)
      const b2e1x = p1x - p2x, b2e1y = p1y - p2y, b2e1z = p1z - p2z;
      const b2e2x = p3x - p2x, b2e2y = p3y - p2y, b2e2z = p3z - p2z;
      const b2nx = b2e1y * b2e2z - b2e1z * b2e2y;
      const b2ny = b2e1z * b2e2x - b2e1x * b2e2z;
      const b2nz = b2e1x * b2e2y - b2e1y * b2e2x;

      // Dot products of normals (higher = more aligned = flatter split)
      const dotA = a1nx * a2nx + a1ny * a2ny + a1nz * a2nz;
      const dotB = b1nx * b2nx + b1ny * b2ny + b1nz * b2nz;

      // Choose the split where triangles are more coplanar (higher dot product)
      if (dotA > dotB) {
        // Split along c0-c3 diagonal
        if (!flipped) {
          tInds.push(c0, c1, c3, c0, c3, c2);
        } else {
          tInds.push(c3, c1, c0, c2, c3, c0);
        }
      } else {
        // Split along c1-c2 diagonal
        if (!flipped) {
          tInds.push(c0, c1, c2, c2, c1, c3);
        } else {
          tInds.push(c2, c1, c0, c3, c1, c2);
        }
      }
    }
  };

  // 2. Quad Generation
  // Seam ownership rule (crack-free, overlap-free):
  // - Only emit quads for interior cells: [PAD .. PAD+CHUNK_SIZE) (half-open).
  // - Still sample neighbor side via PAD when reading x+1 / z+1.
  // This ensures exactly one chunk owns the shared border plane.
  for (let z = start; z < endX; z++) {
    for (let y = start; y < endY; y++) {
      for (let x = start; x < endX; x++) {
        const val = getVal(density, x, y, z);
        if (x < endX) {
          const vNext = getVal(density, x + 1, y, z);
          if ((val > ISO_LEVEL) !== (vNext > ISO_LEVEL)) pushQuad(bufIdx(x, y - 1, z - 1), bufIdx(x, y - 1, z), bufIdx(x, y, z - 1), bufIdx(x, y, z), val > ISO_LEVEL);
        }
        if (y < endY) {
          const vNext = getVal(density, x, y + 1, z);
          if ((val > ISO_LEVEL) !== (vNext > ISO_LEVEL)) pushQuad(bufIdx(x - 1, y, z - 1), bufIdx(x, y, z - 1), bufIdx(x - 1, y, z), bufIdx(x, y, z), val > ISO_LEVEL);
        }
        if (z < endX) {
          const vNext = getVal(density, x, y, z + 1);
          if ((val > ISO_LEVEL) !== (vNext > ISO_LEVEL)) pushQuad(bufIdx(x - 1, y - 1, z), bufIdx(x - 1, y, z), bufIdx(x, y - 1, z), bufIdx(x, y, z), val > ISO_LEVEL);
        }
      }
    }
  }

  // === Post-processing: Smooth normals ===
  // NOTE: Vertex welding and degenerate triangle filtering have been removed
  // as they caused issues with chunk boundaries. The cave size filtering in
  // terrainService.ts is the proper fix for mesh artifacts at cave openings.

  // Compute area-weighted smoothed normals to improve shading on steep slopes
  const smoothedNormals = computeAreaWeightedNormals(tVerts, tInds, tNorms);

  const water = generateWaterSurfaceMesh(density, material);
  const collider = generateColliderData(density);

  return {
    positions: new Float32Array(tVerts),
    indices: new Uint32Array(tInds),
    normals: new Float32Array(smoothedNormals),
    matWeightsA: new Float32Array(tWa),
    matWeightsB: new Float32Array(tWb),
    matWeightsC: new Float32Array(tWc),
    matWeightsD: new Float32Array(tWd),
    wetness: new Float32Array(tWets),
    mossiness: new Float32Array(tMoss),
    cavity: new Float32Array(tCavity),
    lightColors: new Float32Array(tLightColors),
    waterPositions: water.positions,
    waterIndices: water.indices,
    waterNormals: water.normals,
    waterShoreMask: water.shoreMask,
    ...collider
  } as MeshData;
}

/**
 * Strategy: Optimize collision by using a Heightfield where possible,
 * or a high-accuracy simplified trimesh where caves or overhangs exist.
 */
function generateColliderData(density: Float32Array) {
  const isHf = isHeightfieldCompatible(density);
  if (isHf) {
    return { isHeightfield: true, colliderHeightfield: extractHeightfield(density) };
  }
  const simple = generateSimplifiedTrimesh(density);
  return { isHeightfield: false, colliderPositions: simple.positions, colliderIndices: simple.indices };
}

/**
 * Logic to decide if a chunk can use a memory-efficient Heightfield collider.
 * It scans columns; if any air pockets are found under solid surfaces, it returns false (Complex terrain/caves).
 */
function isHeightfieldCompatible(density: Float32Array): boolean {
  for (let z = PAD; z < CHUNK_SIZE_XZ + PAD; z++) {
    for (let x = PAD; x < CHUNK_SIZE_XZ + PAD; x++) {
      let foundSolid = false;
      for (let y = SIZE_Y - PAD - 1; y >= PAD; y--) {
        const val = density[x + y * SIZE_X + z * SIZE_X * SIZE_Y];
        if (val > ISO_LEVEL) foundSolid = true;
        else if (foundSolid && val <= ISO_LEVEL) return false;
      }
    }
  }
  return true;
}

/**
 * Extracts a (CHUNK_SIZE_XZ + 1) height grid from the density field.
 * This resolution is required by Rapier to provide 32 subdivisions of collision.
 * 
 * IMPORTANT: Rapier expects heightfield data in COLUMN-MAJOR order:
 * - Each "column" in the matrix corresponds to a different X position
 * - Elements within a column are consecutive Z positions
 * - So for index: `heights[z + x * numSamplesZ] = height`
 */
function extractHeightfield(density: Float32Array): Float32Array {
  const numSamples = CHUNK_SIZE_XZ + 1;
  const heights = new Float32Array(numSamples * numSamples);
  for (let lz = 0; lz < numSamples; lz++) {
    for (let lx = 0; lx < numSamples; lx++) {
      const gx = lx + PAD, gz = lz + PAD;
      let h = MESH_Y_OFFSET;
      for (let y = SIZE_Y - PAD - 1; y >= PAD; y--) {
        const val = density[gx + y * SIZE_X + gz * SIZE_X * SIZE_Y];
        if (val > ISO_LEVEL) {
          const valAbove = getVal(density, gx, y + 1, gz);
          const t = (ISO_LEVEL - val) / (valAbove - val);
          h = (y - PAD + t) + MESH_Y_OFFSET;
          break;
        }
      }
      // Column-major order for Rapier: index = z + x * numSamplesZ
      heights[lz + lx * numSamples] = h;
    }
  }
  return heights;
}

/**
 * Generates a low-resolution trimesh for complex terrain (caves/overhangs).
 *
 * HIGH-ACCURACY FIX: We use a Surface Nets approach with centroid placement.
 * Instead of placing vertices at the voxel cell centers, we calculate the exact
 * edge crossing points and average them. This ensures the physics collider
 * tightly follows the visual terrain, preventing the "floating" or "puffy"
 * boundary artifacts seen with simpler voxel-center approaches.
 */
function generateSimplifiedTrimesh(density: Float32Array): { positions: Float32Array, indices: Uint32Array } {
  const step = 2; // Reduce resolution by 2x (8x volume reduction)
  const verts: number[] = [];
  const inds: number[] = [];
  const vertIdx = new Int32Array(SIZE_X * SIZE_Y * SIZE_Z).fill(-1);

  for (let z = 0; z <= SIZE_Z - step; z += step) {
    for (let y = 0; y <= SIZE_Y - step; y += step) {
      for (let x = 0; x <= SIZE_X - step; x += step) {
        let mask = 0;
        const v0 = getVal(density, x, y, z), v1 = getVal(density, x + step, y, z), v2 = getVal(density, x, y + step, z), v3 = getVal(density, x + step, y + step, z);
        const v4 = getVal(density, x, y, z + step), v5 = getVal(density, x + step, y, z + step), v6 = getVal(density, x, y + step, z + step), v7 = getVal(density, x + step, y + step, z + step);
        if (v0 > ISO_LEVEL) mask |= 1; if (v1 > ISO_LEVEL) mask |= 2; if (v2 > ISO_LEVEL) mask |= 4; if (v3 > ISO_LEVEL) mask |= 8;
        if (v4 > ISO_LEVEL) mask |= 16; if (v5 > ISO_LEVEL) mask |= 32; if (v6 > ISO_LEVEL) mask |= 64; if (v7 > ISO_LEVEL) mask |= 128;
        if (mask !== 0 && mask !== 255) {
          // Centroid Placement: find crossing points on all 12 edges and average them.
          let avgX = 0, avgY = 0, avgZ = 0, count = 0;
          const lerpPos = (vA: number, vB: number) => (ISO_LEVEL - vA) / (vB - vA);
          const check = (va: number, vb: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
            if ((va > ISO_LEVEL) !== (vb > ISO_LEVEL)) {
              const t = lerpPos(va, vb);
              avgX += x1 + (x2 - x1) * t;
              avgY += y1 + (y2 - y1) * t;
              avgZ += z1 + (z2 - z1) * t;
              count++;
            }
          };
          // Check all 12 edges of the 2x2x2 cell
          check(v0, v1, x, y, z, x + step, y, z);
          check(v2, v3, x, y + step, z, x + step, y + step, z);
          check(v4, v5, x, y, z + step, x + step, y, z + step);
          check(v6, v7, x, y + step, z + step, x + step, y + step, z + step);

          check(v0, v2, x, y, z, x, y + step, z);
          check(v1, v3, x + step, y, z, x + step, y + step, z);
          check(v4, v6, x, y, z + step, x, y + step, z + step);
          check(v5, v7, x + step, y, z + step, x + step, y + step, z + step);

          check(v0, v4, x, y, z, x, y, z + step);
          check(v1, v5, x + step, y, z, x + step, y, z + step);
          check(v2, v6, x, y + step, z, x, y + step, z + step);
          check(v3, v7, x + step, y + step, z, x + step, y + step, z + step);
          if (count > 0) { avgX /= count; avgY /= count; avgZ /= count; vertIdx[bufIdx(x, y, z)] = verts.length / 3; verts.push(avgX - PAD, avgY - PAD + MESH_Y_OFFSET, avgZ - PAD); }
        }
      }
    }
  }
  const push = (i0: number, i1: number, i2: number, i3: number, flipped: boolean) => {
    const c0 = vertIdx[i0], c1 = vertIdx[i1], c2 = vertIdx[i2], c3 = vertIdx[i3];
    if (c0 > -1 && c1 > -1 && c2 > -1 && c3 > -1) {
      if (!flipped) inds.push(c0, c1, c2, c2, c1, c3);
      else inds.push(c2, c1, c0, c3, c1, c2);
    }
  };
  for (let z = PAD; z < PAD + CHUNK_SIZE_XZ; z += step) {
    for (let y = PAD; y < PAD + CHUNK_SIZE_Y; y += step) {
      for (let x = PAD; x < PAD + CHUNK_SIZE_XZ; x += step) {
        const val = getVal(density, x, y, z);
        if (x < PAD + CHUNK_SIZE_XZ) { const vNext = getVal(density, x + step, y, z); if ((val > ISO_LEVEL) !== (vNext > ISO_LEVEL)) push(bufIdx(x, y - step, z - step), bufIdx(x, y - step, z), bufIdx(x, y, z - step), bufIdx(x, y, z), val > ISO_LEVEL); }
        if (y < PAD + CHUNK_SIZE_Y) { const vNext = getVal(density, x, y + step, z); if ((val > ISO_LEVEL) !== (vNext > ISO_LEVEL)) push(bufIdx(x - step, y, z - step), bufIdx(x, y, z - step), bufIdx(x - step, y, z), bufIdx(x, y, z), val > ISO_LEVEL); }
        if (z < PAD + CHUNK_SIZE_XZ) { const vNext = getVal(density, x, y, z + step); if ((val > ISO_LEVEL) !== (vNext > ISO_LEVEL)) push(bufIdx(x - step, y - step, z), bufIdx(x - step, y, z), bufIdx(x, y - step, z), bufIdx(x, y, z), val > ISO_LEVEL); }
      }
    }
  }
  return { positions: new Float32Array(verts), indices: new Uint32Array(inds) };
}
