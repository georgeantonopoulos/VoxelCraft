import { TerrainService } from '@features/terrain/logic/terrainService';
import { getChunkModifications } from '@/state/WorldDB';
import { BiomeManager } from '../logic/BiomeManager';
import { getVegetationForBiome } from '../logic/VegetationConfig';
import { noise } from '@core/math/noise';
import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, ISO_LEVEL } from '@/constants';
import { isSharedArrayBuffer, toSharedFloat32Array, toSharedUint8Array, toSharedVegetationBuckets } from './sharedBuffers';

const ctx: Worker = self as any;

// Instantiate DB connection implicitly by importing it (Singleton in WorldDB.ts)
// The user requested: "Ensure you instantiate WorldDB outside the onmessage handler."
// Since `worldDB` is exported as a const instance in `WorldDB.ts`, it is instantiated on module load.
// We don't need to do anything extra here, just usage is fine.

/**
 * Generation-only worker.
 *
 * Responsibilities:
 * - Read persistent chunk modifications (WorldDB)
 * - Generate density/material/metadata + placements
 * - Generate ambient vegetation instance buckets
 *
 * NOT responsible for meshing (handled by `mesher.worker.ts`).
 */
ctx.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'CONFIGURE') {
      const { worldType } = payload;
      BiomeManager.setWorldType(worldType);
      console.log('[terrainGen.worker] Configured WorldType:', worldType);
      return;
    }

    if (type === 'GENERATE') {
      const { cx, cz } = payload;

      // 1. Fetch persistent modifications (Async)
      // This happens BEFORE generation so we can pass them in
      let modifications: any[] = [];
      try {
        modifications = await getChunkModifications(cx, cz);
      } catch (err) {
        console.error('[terrainGen.worker] DB Read Error:', err);
        // Continue generation even if DB fails, to avoid game crash
      }

      // 2. Generate with mods
      const { density, material, metadata, floraPositions, treePositions, rootHollowPositions } =
        TerrainService.generateChunk(cx, cz, modifications);

      // --- AMBIENT VEGETATION GENERATION ---
      const vegetationBucketsRaw: Record<number, number[]> = {};

      // We iterate strictly within the CHUNK bounds (excluding padding)
      // But we access the padded density array.
      // Padded size is TOTAL_SIZE_XZ (XZ + 2*PAD).
      // TerrainService generates [TOTAL_SIZE_XZ, TOTAL_SIZE_Y, TOTAL_SIZE_XZ].
      // We want world coordinates to map biomes.
      for (let z = 0; z < CHUNK_SIZE_XZ; z++) {
        for (let x = 0; x < CHUNK_SIZE_XZ; x++) {
          const worldX = cx * CHUNK_SIZE_XZ + x;
          const worldZ = cz * CHUNK_SIZE_XZ + z;

          const biome = BiomeManager.getBiomeAt(worldX, worldZ);
          let biomeDensity = BiomeManager.getVegetationDensity(worldX, worldZ);
          // Beaches should read as clean shoreline; reduce ambient ground clutter and avoid
          // paying for unnecessary surface scans in the worker.
          if (biome === 'BEACH') biomeDensity *= 0.1;

          // 1. Density Noise (Smaller, more frequent patches)
          // Scale 0.15 = ~6-7 blocks per cycle (much smaller patches)
          const densityNoise = noise(worldX * 0.15, 0, worldZ * 0.15);
          const normalizedDensity = (densityNoise + 1) * 0.5;

          // Jitter to break edges
          const jitter = noise(worldX * 0.8, 0, worldZ * 0.8) * 0.3;

          const finalDensity = normalizedDensity + jitter;
          const threshold = 1.0 - biomeDensity;

          if (finalDensity <= threshold) continue;

          // Simple Raycast from top down to find surface
          let surfaceY = -1;
          const pad = 2;
          const dx = x + pad;
          const dz = z + pad;
          const sizeX = TOTAL_SIZE_XZ;
          const sizeY = TOTAL_SIZE_Y;
          const sizeZ = TOTAL_SIZE_XZ;

          // Scan down
          for (let y = sizeY - 2; y >= 0; y--) {
            const idx = dx + y * sizeX + dz * sizeX * sizeY;
            const d = density[idx];

            if (d > ISO_LEVEL) {
              surfaceY = y;
              const idxAbove = idx + sizeX;
              const dAbove = density[idxAbove];
              const t = (ISO_LEVEL - d) / (dAbove - d);
              surfaceY += t;
              break;
            }
          }

          if (surfaceY < 0) continue;

          const worldY = surfaceY - pad;

          // Sample pseudo-normal by reading density around the surface cell.
          const sx = dx;
          const sy = Math.max(pad, Math.min(sizeY - pad - 1, Math.floor(surfaceY)));
          const sz = dz;
          const idxC = sx + sy * sizeX + sz * sizeX * sizeY;

          const idxXp = idxC + 1;
          const idxXm = idxC - 1;
          const idxZp = idxC + sizeX * sizeY;
          const idxZm = idxC - sizeX * sizeY;
          const idxYp = idxC + sizeX;
          const idxYm = idxC - sizeX;

          const ddx = density[idxXp] - density[idxXm];
          const ddz = density[idxZp] - density[idxZm];
          const ddy = density[idxYp] - density[idxYm];

          // Normal points opposite the gradient for an SDF where solid is > ISO.
          let nx = -ddx;
          let ny = -ddy;
          let nz = -ddz;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          const invLen = len > 0.0001 ? 1 / len : 1;
          const finalNx = len > 0.0001 ? nx * invLen : 0;
          const finalNy = len > 0.0001 ? ny * invLen : 1;
          const finalNz = len > 0.0001 ? nz * invLen : 0;

          // Re-assign to simple vars for usage below
          const nx_val = finalNx;
          const ny_val = finalNy;
          const nz_val = finalNz;

          // 2. Clumping Logic
          // If density is very high, place multiple plants
          let numPlants = 1;

          // HIGH DENSITY BIOMES (The Ghibli Look)
          if (biome === 'JUNGLE' || biome === 'THE_GROVE') {
            // We push the count much higher.
            // Since we spherized the normals in the shader,
            // these extra instances won't look "noisy", they will look like soft volume.
            if (finalDensity > threshold + 0.30) numPlants = 7; // Extremely dense core
            else if (finalDensity > threshold + 0.15) numPlants = 5;
            else if (finalDensity > threshold + 0.05) numPlants = 3;
          } else {
            // Standard Biomes (Plains, etc) - Keep optimized
            if (finalDensity > threshold + 0.4) numPlants = 3;
            else if (finalDensity > threshold + 0.2) numPlants = 2;
          }

          // 3. Type Noise
          const typeNoise = noise(worldX * 0.1 + 100, 0, worldZ * 0.1 + 100);
          const normalizedType = (typeNoise + 1) * 0.5;
          const vegType = getVegetationForBiome(biome, normalizedType);

          if (vegType === null) continue;
          if (!vegetationBucketsRaw[vegType]) vegetationBucketsRaw[vegType] = [];

          for (let i = 0; i < numPlants; i++) {
            // Unique hash for each sub-plant
            const seed = worldX * 31 + worldZ * 17 + i * 13;
            const r1 = Math.sin(seed) * 43758.5453;
            const r2 = Math.cos(seed) * 43758.5453;

            // Spread Logic Update:
            // Increased multiplier from 1.2 to 1.4
            // This allows grass to step further off the grid center,
            // blending chunks together so you don't see "rows" of grass.
            const offX = (r1 - Math.floor(r1) - 0.5) * 1.4;
            const offZ = (r2 - Math.floor(r2) - 0.5) * 1.4;

            // Tiny Y Jitter
            // Randomly sink the grass slightly (-0.15 to 0.0)
            // This prevents the "flat bottom" look on hills.
            const offY = ((r1 + r2) % 1) * -0.15;

            // --- SLOPE CORRECTION ---
            // Since we moved X/Z, we must adjust Y based on the slope (normal).
            // Plane eq: nx*x + ny*y + nz*z = 0
            // dy = -(nx*dx + nz*dz) / ny
            // We clamp ny to avoid division by zero (though ny should be > 0 for ground)
            let slopeY = 0;
            if (ny_val > 0.1) {
              slopeY = -(nx_val * offX + nz_val * offZ) / ny_val;
            }
            // Clamp slope correction to avoid wild spikes on steep terrain
            slopeY = Math.max(-1.0, Math.min(1.0, slopeY));

            vegetationBucketsRaw[vegType].push(
              x + offX,
              worldY - 0.1 + offY + slopeY, // Apply sink + slope correction
              z + offZ,
              // Normal (nx, ny, nz)
              nx_val,
              ny_val,
              nz_val
            );
          }
        }
      }

      // Flatten to Float32Arrays
      const vegetationBuckets: Record<number, Float32Array> = {};
      for (const [key, positions] of Object.entries(vegetationBucketsRaw)) {
        vegetationBuckets[parseInt(key, 10)] = new Float32Array(positions);
      }

      // Shared-array wrapping (when available)
      const densityShared = toSharedFloat32Array(density);
      const materialShared = toSharedUint8Array(material);
      const wetnessShared = toSharedUint8Array(metadata.wetness);
      const mossinessShared = toSharedUint8Array(metadata.mossiness);
      const floraShared = toSharedFloat32Array(floraPositions);
      const treeShared = toSharedFloat32Array(treePositions);
      const rootHollowShared = toSharedFloat32Array(rootHollowPositions);

      const { vegetationData, vegetationBuffers } = toSharedVegetationBuckets(vegetationBuckets);

      const response = {
        key: `${cx},${cz}`,
        cx,
        cz,
        density: densityShared,
        material: materialShared,
        metadata: {
          ...metadata,
          wetness: wetnessShared,
          mossiness: mossinessShared
        },
        vegetationData,
        floraPositions: floraShared,
        treePositions: treeShared,
        rootHollowPositions: rootHollowShared
      };

      // Only transfer non-shared buffers; SharedArrayBuffer stays shared.
      const transfer: ArrayBuffer[] = [...vegetationBuffers];
      const maybePush = (arr: ArrayBuffer) => {
        if (!isSharedArrayBuffer(arr)) transfer.push(arr);
      };
      maybePush(densityShared.buffer as any);
      maybePush(materialShared.buffer as any);
      maybePush(wetnessShared.buffer as any);
      maybePush(mossinessShared.buffer as any);
      maybePush(floraShared.buffer as any);
      maybePush(treeShared.buffer as any);
      maybePush(rootHollowShared.buffer as any);

      ctx.postMessage({ type: 'GENERATED_BASE', payload: response }, transfer);
    }
  } catch (error) {
    console.error('[terrainGen.worker] Error:', error);
  }
};
