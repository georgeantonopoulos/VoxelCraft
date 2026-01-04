/**
 * raycastUtils.ts
 *
 * Pure utility functions for ray intersection tests against terrain entities.
 * These are used by the interaction system to determine what the player is looking at.
 *
 * All functions are stateless and operate on provided data structures.
 */

import * as THREE from 'three';
import type { Collider } from '@dimforge/rapier3d-compat';
import { CHUNK_SIZE_XZ, PAD, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, MESH_Y_OFFSET } from '@/constants';
import { MaterialType, ChunkState, ItemType } from '@/types';
import { useWorldStore, FloraHotspot, GroundHotspot } from '@state/WorldStore';

// ============================================================================
// Types
// ============================================================================

export type GroundPickupArrayKey = 'stickPositions' | 'rockPositions';

export interface LuminaHit {
  key: string;
  index: number;
  t: number;
  position: THREE.Vector3;
}

export interface GroundHit {
  key: string;
  array: GroundPickupArrayKey;
  index: number;
  t: number;
  position: THREE.Vector3;
}

export interface TorchHit {
  id: string;
  t: number;
  position: THREE.Vector3;
}

// ============================================================================
// Material Utilities
// ============================================================================

/**
 * Get a display color for a material type (used for particles).
 */
export const getMaterialColor = (matId: number): string => {
  switch (matId) {
    case MaterialType.SNOW: return '#ffffff';
    case MaterialType.STONE: return '#666670';
    case MaterialType.BEDROCK: return '#222222';
    case MaterialType.SAND: return '#dcd0a0';
    case MaterialType.DIRT: return '#5d4037';
    case MaterialType.GRASS: return '#55aa33';
    case MaterialType.CLAY: return '#a67b5b';
    case MaterialType.WATER: return '#6ec2f7';
    case MaterialType.MOSSY_STONE: return '#5c8a3c';
    default: return '#888888';
  }
};

/**
 * Sample the terrain voxel material at a world-space point.
 * Used for "material-aware" feedback (particles + smart build).
 */
export const sampleMaterialAtWorldPoint = (
  chunks: Map<string, ChunkState>,
  worldPoint: THREE.Vector3
): MaterialType => {
  const cx = Math.floor(worldPoint.x / CHUNK_SIZE_XZ);
  const cz = Math.floor(worldPoint.z / CHUNK_SIZE_XZ);
  const key = `${cx},${cz}`;
  const chunk = chunks.get(key);
  if (!chunk) return MaterialType.DIRT;

  const localX = worldPoint.x - cx * CHUNK_SIZE_XZ;
  const localY = worldPoint.y;
  const localZ = worldPoint.z - cz * CHUNK_SIZE_XZ;

  // TerrainService grid mapping:
  // hx = localX + PAD
  // hy = localY - MESH_Y_OFFSET + PAD
  // hz = localZ + PAD
  const ix = THREE.MathUtils.clamp(Math.floor(localX) + PAD, 0, TOTAL_SIZE_XZ - 1);
  const iy = THREE.MathUtils.clamp(Math.floor(localY - MESH_Y_OFFSET) + PAD, 0, TOTAL_SIZE_Y - 1);
  const iz = THREE.MathUtils.clamp(Math.floor(localZ) + PAD, 0, TOTAL_SIZE_XZ - 1);

  const idx = ix + iy * TOTAL_SIZE_XZ + iz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
  const mat = chunk.material[idx] ?? MaterialType.DIRT;
  return mat as MaterialType;
};

// ============================================================================
// Collider Type Checks
// ============================================================================

/**
 * Check if a Rapier collider belongs to terrain.
 */
export const isTerrainCollider = (collider: Collider): boolean => {
  const parent = collider.parent();
  const userData = parent?.userData as { type?: string } | undefined;
  return userData?.type === 'terrain';
};

/**
 * Check if a Rapier collider belongs to a physics item (pickaxe, shard, etc).
 */
export const isPhysicsItemCollider = (collider: Collider): boolean => {
  const parent = collider.parent();
  const userData = parent?.userData as { type?: string } | undefined;
  // PhysicsItems have ItemType enum values in userData.type
  return Object.values(ItemType).includes(userData?.type as ItemType);
};

// ============================================================================
// Ray Hit Tests
// ============================================================================

/**
 * Test ray against placed flora entities (from WorldStore).
 * Returns the ID of the closest hit flora, or null.
 */
export const rayHitsFlora = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  floraRadius = 0.6
): string | null => {
  const state = useWorldStore.getState();
  let closestId: string | null = null;
  let closestT = maxDist + 1;
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();

  // Iterate over placed flora
  for (const flora of state.entities.values()) {
    if (flora.type !== ItemType.FLORA) continue;

    // Use the live physics position if available, otherwise fall back to initial spawn position
    const currentPos = flora.bodyRef?.current
      ? flora.bodyRef.current.translation()
      : flora.position;

    // Rapier translation returns {x,y,z}, ensure it's Vector3-like
    tmp.set(currentPos.x, currentPos.y, currentPos.z).sub(origin);

    const t = tmp.dot(dir);
    if (t < 0 || t > maxDist) continue; // Behind camera or too far
    proj.copy(dir).multiplyScalar(t);
    tmp.sub(proj);
    const distSq = tmp.lengthSq();
    if (distSq <= floraRadius * floraRadius && t < closestT) {
      closestT = t;
      closestId = flora.id;
    }
  }

  return closestId;
};

/**
 * Test ray against placed torches (from WorldStore).
 * Returns hit info with position and distance, or null.
 */
export const rayHitsTorch = (
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  torchRadius = 0.55
): TorchHit | null => {
  const state = useWorldStore.getState();
  let closest: TorchHit | null = null;
  let closestT = maxDist + 1;
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (const ent of state.entities.values()) {
    if (ent.type !== ItemType.TORCH) continue;
    p.copy(ent.position);
    tmp.copy(p).sub(origin);
    const t = tmp.dot(dir);
    if (t < 0 || t > maxDist) continue;
    if (t >= closestT) continue;
    proj.copy(dir).multiplyScalar(t);
    tmp.sub(proj);
    const distSq = tmp.lengthSq();
    if (distSq <= torchRadius * torchRadius) {
      closestT = t;
      closest = { id: ent.id, t, position: p.clone() };
    }
  }

  return closest;
};

/**
 * Ray-hit test against generated lumina flora (chunk `floraPositions`).
 * Returns the closest hit along the ray (single-target pickup).
 */
export const rayHitsGeneratedLuminaFlora = (
  chunks: Map<string, ChunkState>,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  floraRadius = 0.55
): LuminaHit | null => {
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const hitPos = new THREE.Vector3();

  const minCx = Math.floor((origin.x - maxDist) / CHUNK_SIZE_XZ);
  const maxCx = Math.floor((origin.x + maxDist) / CHUNK_SIZE_XZ);
  const minCz = Math.floor((origin.z - maxDist) / CHUNK_SIZE_XZ);
  const maxCz = Math.floor((origin.z + maxDist) / CHUNK_SIZE_XZ);

  let best: LuminaHit | null = null;
  let bestT = maxDist + 1;

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const key = `${cx},${cz}`;
      const chunk = chunks.get(key);
      if (!chunk?.floraPositions || chunk.floraPositions.length === 0) continue;

      const positions = chunk.floraPositions;
      for (let i = 0; i < positions.length; i += 4) {
        // Positions are already world space; do not add chunk origin again.
        if (positions[i + 1] < -9999) continue;
        hitPos.set(positions[i], positions[i + 1], positions[i + 2]);
        tmp.copy(hitPos).sub(origin);
        const t = tmp.dot(dir);
        if (t < 0 || t > maxDist) continue;
        if (t >= bestT) continue;
        proj.copy(dir).multiplyScalar(t);
        tmp.sub(proj);
        const distSq = tmp.lengthSq();
        if (distSq <= floraRadius * floraRadius) {
          bestT = t;
          best = { key, index: i, t, position: hitPos.clone() };
        }
      }
    }
  }

  return best;
};

/**
 * Ray-hit test against generated ground pickups (sticks + stones).
 * Data is chunk-local in XZ (chunk group space) but world-space in Y.
 */
export const rayHitsGeneratedGroundPickup = (
  chunks: Map<string, ChunkState>,
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  radius = 0.55
): GroundHit | null => {
  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const hitPos = new THREE.Vector3();

  const minCx = Math.floor((origin.x - maxDist) / CHUNK_SIZE_XZ);
  const maxCx = Math.floor((origin.x + maxDist) / CHUNK_SIZE_XZ);
  const minCz = Math.floor((origin.z - maxDist) / CHUNK_SIZE_XZ);
  const maxCz = Math.floor((origin.z + maxDist) / CHUNK_SIZE_XZ);

  let best: GroundHit | null = null;
  let bestT = maxDist + 1;

  const consider = (key: string, array: GroundPickupArrayKey, data: Float32Array) => {
    const chunk = chunks.get(key);
    if (!chunk) return;
    const originX = chunk.cx * CHUNK_SIZE_XZ;
    const originZ = chunk.cz * CHUNK_SIZE_XZ;

    // stride 8: x, y, z, nx, ny, nz, variant, seed
    for (let i = 0; i < data.length; i += 8) {
      const wy = data[i + 1];
      if (wy < -9999) continue;
      const wx = originX + data[i + 0];
      const wz = originZ + data[i + 2];
      hitPos.set(wx, wy, wz);
      tmp.copy(hitPos).sub(origin);
      const t = tmp.dot(dir);
      if (t < 0 || t > maxDist) continue;
      if (t >= bestT) continue;
      proj.copy(dir).multiplyScalar(t);
      tmp.sub(proj);
      const distSq = tmp.lengthSq();
      if (distSq <= radius * radius) {
        bestT = t;
        best = { key, array, index: i, t, position: hitPos.clone() };
      }
    }
  };

  for (let cx = minCx; cx <= maxCx; cx++) {
    for (let cz = minCz; cz <= maxCz; cz++) {
      const key = `${cx},${cz}`;
      const chunk = chunks.get(key);
      if (!chunk) continue;
      if (chunk.stickPositions && chunk.stickPositions.length > 0) consider(key, 'stickPositions', chunk.stickPositions);
      if (chunk.rockPositions && chunk.rockPositions.length > 0) consider(key, 'rockPositions', chunk.rockPositions);
    }
  }

  return best;
};

// ============================================================================
// Hotspot Builders
// ============================================================================

/**
 * Build flora hotspots from floraPositions array.
 * Hotspots are used for proximity-based effects like fireflies.
 */
export const buildFloraHotspots = (positions: Float32Array | undefined): FloraHotspot[] => {
  if (!positions || positions.length === 0) return [];
  const hotspots: FloraHotspot[] = [];
  for (let i = 0; i < positions.length; i += 4) {
    if (positions[i + 1] < -9999) continue;
    hotspots.push({ x: positions[i], z: positions[i + 2] });
  }
  return hotspots;
};

/**
 * Build ground hotspots from stick/rock position arrays.
 * Converts chunk-local coordinates to world coordinates.
 */
export const buildChunkLocalHotspots = (cx: number, cz: number, positions: Float32Array | undefined): GroundHotspot[] => {
  if (!positions || positions.length === 0) return [];
  const originX = cx * CHUNK_SIZE_XZ;
  const originZ = cz * CHUNK_SIZE_XZ;
  const hotspots: GroundHotspot[] = [];
  for (let i = 0; i < positions.length; i += 8) {
    if (positions[i + 1] < -9999) continue;
    hotspots.push({ x: originX + positions[i], z: originZ + positions[i + 2] });
  }
  return hotspots;
};
