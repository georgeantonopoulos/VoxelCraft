/**
 * Voxel-based Light Propagation System
 *
 * Generates a low-resolution 3D light grid for global illumination.
 * Each cell in the grid represents LIGHT_CELL_SIZE^3 voxels and stores
 * RGB light color accumulated from sky light and point light sources.
 *
 * The algorithm:
 * 1. Seed sky light from above (traces down, attenuates through solid)
 * 2. Seed point lights (torches, Lumina) at their positions
 * 3. Flood-fill propagate light through the grid
 * 4. Light is blocked/attenuated by solid voxels
 *
 * The resulting grid is sampled in the terrain shader to provide
 * indirect/ambient lighting that responds to the environment.
 */

import {
  TOTAL_SIZE_XZ,
  TOTAL_SIZE_Y,
  PAD,
  ISO_LEVEL,
  LIGHT_CELL_SIZE,
  LIGHT_GRID_SIZE_XZ,
  LIGHT_GRID_SIZE_Y,
  LIGHT_PROPAGATION_ITERATIONS,
  LIGHT_FALLOFF,
  SKY_LIGHT_ATTENUATION
} from '@/constants';

// Light source types
export interface LightSource {
  x: number;  // Local chunk position (0-31)
  y: number;  // World Y position
  z: number;  // Local chunk position (0-31)
  r: number;  // Red 0-1
  g: number;  // Green 0-1
  b: number;  // Blue 0-1
  intensity: number; // Light strength
  radius: number; // Falloff radius in voxels
}

// Sun/sky light configuration
export interface SkyLightConfig {
  r: number;
  g: number;
  b: number;
  intensity: number; // 0-1, based on time of day
}

// 6-direction neighbors for flood fill
const NEIGHBORS: [number, number, number][] = [
  [-1, 0, 0], [1, 0, 0],  // X axis
  [0, -1, 0], [0, 1, 0],  // Y axis
  [0, 0, -1], [0, 0, 1]   // Z axis
];

/**
 * Get the average density of a light cell from the voxel density field.
 * Used to determine how much light is blocked by solid material.
 */
function getCellOcclusion(
  density: Float32Array,
  cellX: number,
  cellY: number,
  cellZ: number
): number {
  // Sample center of the cell
  const voxelX = cellX * LIGHT_CELL_SIZE + LIGHT_CELL_SIZE / 2 + PAD;
  const voxelY = cellY * LIGHT_CELL_SIZE + LIGHT_CELL_SIZE / 2;
  const voxelZ = cellZ * LIGHT_CELL_SIZE + LIGHT_CELL_SIZE / 2 + PAD;

  // Clamp to valid range
  const x = Math.min(Math.max(Math.floor(voxelX), 0), TOTAL_SIZE_XZ - 1);
  const y = Math.min(Math.max(Math.floor(voxelY), 0), TOTAL_SIZE_Y - 1);
  const z = Math.min(Math.max(Math.floor(voxelZ), 0), TOTAL_SIZE_XZ - 1);

  const idx = x + y * TOTAL_SIZE_XZ + z * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
  const d = density[idx] || 0;

  // Convert density to occlusion (0 = air/transparent, 1 = solid/opaque)
  // Density > ISO_LEVEL means solid
  return d > ISO_LEVEL ? Math.min((d - ISO_LEVEL) * 2, 1.0) : 0;
}

/**
 * Convert 3D grid coordinates to flat array index
 */
function gridIndex(x: number, y: number, z: number): number {
  return x + y * LIGHT_GRID_SIZE_XZ + z * LIGHT_GRID_SIZE_XZ * LIGHT_GRID_SIZE_Y;
}

/**
 * Check if grid coordinates are within bounds
 */
function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < LIGHT_GRID_SIZE_XZ &&
         y >= 0 && y < LIGHT_GRID_SIZE_Y &&
         z >= 0 && z < LIGHT_GRID_SIZE_XZ;
}

/**
 * Generate the light grid for a chunk.
 *
 * @param density - The chunk's voxel density field
 * @param pointLights - Array of point light sources (torches, Lumina, etc.)
 * @param skyLight - Sky/sun light configuration
 * @returns Uint8Array of RGBA values for the 3D light texture
 */
export function generateLightGrid(
  density: Float32Array,
  pointLights: LightSource[],
  skyLight: SkyLightConfig
): Uint8Array {
  const gridSize = LIGHT_GRID_SIZE_XZ * LIGHT_GRID_SIZE_Y * LIGHT_GRID_SIZE_XZ;

  // Working buffer in float for accumulation (RGB per cell)
  const lightR = new Float32Array(gridSize);
  const lightG = new Float32Array(gridSize);
  const lightB = new Float32Array(gridSize);

  // Pre-compute occlusion grid (cached for propagation)
  const occlusion = new Float32Array(gridSize);
  for (let z = 0; z < LIGHT_GRID_SIZE_XZ; z++) {
    for (let y = 0; y < LIGHT_GRID_SIZE_Y; y++) {
      for (let x = 0; x < LIGHT_GRID_SIZE_XZ; x++) {
        occlusion[gridIndex(x, y, z)] = getCellOcclusion(density, x, y, z);
      }
    }
  }

  // ========================================
  // Step 1: Seed sky light from above
  // ========================================
  for (let z = 0; z < LIGHT_GRID_SIZE_XZ; z++) {
    for (let x = 0; x < LIGHT_GRID_SIZE_XZ; x++) {
      let skyR = skyLight.r * skyLight.intensity;
      let skyG = skyLight.g * skyLight.intensity;
      let skyB = skyLight.b * skyLight.intensity;

      for (let y = LIGHT_GRID_SIZE_Y - 1; y >= 0; y--) {
        const idx = gridIndex(x, y, z);
        const occ = occlusion[idx];

        // Add sky contribution to this cell
        lightR[idx] += skyR;
        lightG[idx] += skyG;
        lightB[idx] += skyB;

        // Attenuate for next cell below
        const transmission = 1 - occ;
        const attenuation = transmission * SKY_LIGHT_ATTENUATION + (1 - transmission) * 0.1;
        skyR *= attenuation;
        skyG *= attenuation;
        skyB *= attenuation;

        // Stop if light is negligible
        if (skyR + skyG + skyB < 0.01) break;
      }
    }
  }

  // ========================================
  // Step 2: Seed point lights
  // ========================================
  for (const light of pointLights) {
    // Convert world position to grid cell
    const cellX = Math.floor(light.x / LIGHT_CELL_SIZE);
    const cellY = Math.floor((light.y + 35) / LIGHT_CELL_SIZE); // Account for MESH_Y_OFFSET
    const cellZ = Math.floor(light.z / LIGHT_CELL_SIZE);

    if (!inBounds(cellX, cellY, cellZ)) continue;

    // Add light to surrounding cells based on radius
    const cellRadius = Math.ceil(light.radius / LIGHT_CELL_SIZE);

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
          const nx = cellX + dx;
          const ny = cellY + dy;
          const nz = cellZ + dz;

          if (!inBounds(nx, ny, nz)) continue;

          // Distance falloff (in cells)
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > cellRadius) continue;

          // Inverse square falloff, clamped
          const falloff = Math.max(0, 1 - (dist / cellRadius));
          const contribution = falloff * falloff * light.intensity;

          const idx = gridIndex(nx, ny, nz);

          // Check if path to light is occluded
          const occ = occlusion[idx];
          const transmission = 1 - occ * 0.5; // Partial transmission even through solid

          lightR[idx] += light.r * contribution * transmission;
          lightG[idx] += light.g * contribution * transmission;
          lightB[idx] += light.b * contribution * transmission;
        }
      }
    }
  }

  // ========================================
  // Step 3: Flood-fill propagation
  // ========================================
  for (let iter = 0; iter < LIGHT_PROPAGATION_ITERATIONS; iter++) {
    // Copy current state
    const prevR = new Float32Array(lightR);
    const prevG = new Float32Array(lightG);
    const prevB = new Float32Array(lightB);

    for (let z = 0; z < LIGHT_GRID_SIZE_XZ; z++) {
      for (let y = 0; y < LIGHT_GRID_SIZE_Y; y++) {
        for (let x = 0; x < LIGHT_GRID_SIZE_XZ; x++) {
          const idx = gridIndex(x, y, z);
          const occ = occlusion[idx];

          // Skip heavily occluded cells
          if (occ > 0.9) continue;

          let sumR = 0, sumG = 0, sumB = 0;
          let count = 0;

          // Sample neighbors
          for (const [dx, dy, dz] of NEIGHBORS) {
            const nx = x + dx;
            const ny = y + dy;
            const nz = z + dz;

            if (!inBounds(nx, ny, nz)) continue;

            const nidx = gridIndex(nx, ny, nz);
            const neighborOcc = occlusion[nidx];

            // Light transmission through neighbor
            const transmission = 1 - neighborOcc * 0.7;
            if (transmission < 0.1) continue;

            sumR += prevR[nidx] * transmission;
            sumG += prevG[nidx] * transmission;
            sumB += prevB[nidx] * transmission;
            count++;
          }

          if (count > 0) {
            // Add fraction of neighbor light (spread)
            const spread = LIGHT_FALLOFF * (1 - occ * 0.5) / count;
            lightR[idx] += sumR * spread * 0.15;
            lightG[idx] += sumG * spread * 0.15;
            lightB[idx] += sumB * spread * 0.15;
          }
        }
      }
    }
  }

  // ========================================
  // Step 4: Convert to Uint8 RGBA output
  // ========================================
  const output = new Uint8Array(gridSize * 4);

  for (let i = 0; i < gridSize; i++) {
    const r = lightR[i];
    const g = lightG[i];
    const b = lightB[i];

    // Simple Reinhard tone mapping per channel
    output[i * 4 + 0] = Math.min(255, Math.floor((r / (1 + r)) * 255 * 2));
    output[i * 4 + 1] = Math.min(255, Math.floor((g / (1 + g)) * 255 * 2));
    output[i * 4 + 2] = Math.min(255, Math.floor((b / (1 + b)) * 255 * 2));
    output[i * 4 + 3] = 255; // Full alpha
  }

  return output;
}

/**
 * Extract point light sources from flora positions array.
 * Lumina flora emit cyan light.
 */
export function extractLuminaLights(floraPositions: Float32Array): LightSource[] {
  const lights: LightSource[] = [];
  const stride = 4; // x, y, z, type

  for (let i = 0; i < floraPositions.length; i += stride) {
    const x = floraPositions[i];
    const y = floraPositions[i + 1];
    const z = floraPositions[i + 2];

    // Skip invalid positions
    if (y < -9999) continue;

    lights.push({
      x,
      y,
      z,
      r: 0.0,   // Cyan color
      g: 0.9,
      b: 1.0,
      intensity: 0.8,
      radius: 12
    });
  }

  return lights;
}

/**
 * Get default sky light based on sun height.
 */
export function getSkyLightConfig(sunNormalizedHeight: number): SkyLightConfig {
  if (sunNormalizedHeight < -0.15) {
    // Night - very dim blue
    return { r: 0.1, g: 0.1, b: 0.2, intensity: 0.15 };
  } else if (sunNormalizedHeight < 0.0) {
    // Sunrise/sunset transition
    const t = (sunNormalizedHeight + 0.15) / 0.15;
    return {
      r: 0.1 + t * 0.9,
      g: 0.1 + t * 0.5,
      b: 0.2 + t * 0.3,
      intensity: 0.15 + t * 0.35
    };
  } else if (sunNormalizedHeight < 0.3) {
    // Golden hour
    const t = sunNormalizedHeight / 0.3;
    return {
      r: 1.0,
      g: 0.6 + t * 0.35,
      b: 0.5 + t * 0.45,
      intensity: 0.5 + t * 0.3
    };
  } else {
    // Full daylight - warm white
    return { r: 1.0, g: 0.95, b: 0.9, intensity: 0.8 };
  }
}
