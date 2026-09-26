import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET, ISO_LEVEL, WATER_LEVEL } from '@/constants';
import * as THREE from 'three';
import { MaterialType } from '@/types';
import { BiomeManager, WorldType } from './BiomeManager';

// A small cone upward helps detect cave mouths without needing camera-direction raycasts.
// (Straight-up alone would incorrectly classify shallow overhangs as "no sky".)
const SKY_VIS_DIRS = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0.55, 1, 0).normalize(),
  new THREE.Vector3(-0.55, 1, 0).normalize(),
  new THREE.Vector3(0, 1, 0.55).normalize(),
  new THREE.Vector3(0, 1, -0.55).normalize(),
];

export interface RuntimeChunkData {
  cx: number;
  cz: number;
  density: Float32Array;
  material: Uint8Array;
}

/**
 * TerrainRuntime
 * A lightweight runtime query service for the currently loaded terrain chunks.
 *
 * Motivation:
 * - Water is rendered as a separate visual mesh (no physics), so gameplay systems need a fast way
 *   to query "is there water here?" directly from the voxel material grid.
 * - Queries must be chunk-aware and handle chunk lifecycles (load/unload).
 */
export class TerrainRuntime {
  private chunks = new Map<string, RuntimeChunkData>();

  /**
   * Register (or replace) a chunk's backing arrays for runtime queries.
   * @param key - Chunk key `"cx,cz"`
   * @param cx - Chunk X coordinate
   * @param cz - Chunk Z coordinate
   * @param density - Padded density field (TOTAL_SIZE_XZ * TOTAL_SIZE_Y * TOTAL_SIZE_XZ)
   * @param material - Padded material field (same shape as density)
   */
  registerChunk(key: string, cx: number, cz: number, density: Float32Array, material: Uint8Array): void {
    this.chunks.set(key, { cx, cz, density, material });
  }

  /**
   * Unregister a chunk when it is unloaded.
   * @param key - Chunk key `"cx,cz"`
   */
  unregisterChunk(key: string): void {
    this.chunks.delete(key);
  }

  /** Unregister every chunk (world restart). */
  clear(): void {
    this.chunks.clear();
  }

  private getChunkAtWorld(wx: number, wz: number): RuntimeChunkData | null {
    const cx = Math.floor(wx / CHUNK_SIZE_XZ);
    const cz = Math.floor(wz / CHUNK_SIZE_XZ);
    const key = `${cx},${cz}`;
    return this.chunks.get(key) ?? null;
  }

  private getIndexInChunk(chunk: RuntimeChunkData, wx: number, wy: number, wz: number): number | null {
    // World -> chunk-local voxel coordinates, then into padded grid.
    const lx = Math.floor(wx - chunk.cx * CHUNK_SIZE_XZ) + PAD;
    const lz = Math.floor(wz - chunk.cz * CHUNK_SIZE_XZ) + PAD;
    // Grid worldY = (yIndex - PAD) + MESH_Y_OFFSET  =>  yIndex = worldY - MESH_Y_OFFSET + PAD.
    const ly = Math.floor(wy - MESH_Y_OFFSET) + PAD;

    if (lx < 0 || lx >= TOTAL_SIZE_XZ) return null;
    if (ly < 0 || ly >= TOTAL_SIZE_Y) return null;
    if (lz < 0 || lz >= TOTAL_SIZE_XZ) return null;

    return lx + ly * TOTAL_SIZE_XZ + lz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
  }

  /**
   * Get the material ID at a world position (nearest voxel).
   * Returns null if the chunk isn't currently loaded or coordinates are out of bounds.
   */
  getMaterialAtWorld(wx: number, wy: number, wz: number): MaterialType | null {
    const chunk = this.getChunkAtWorld(wx, wz);
    if (!chunk) return null;
    const idx = this.getIndexInChunk(chunk, wx, wy, wz);
    if (idx == null) return null;
    return chunk.material[idx] as MaterialType;
  }

  /**
   * Returns true if a world position is inside a liquid voxel.
   *
   * Liquid is defined as:
   * - density <= ISO_LEVEL (air space)
   * - material is WATER or ICE (frozen water behaves like water for gameplay queries in V1)
   */
  isLiquidAtWorld(wx: number, wy: number, wz: number): boolean {
    const chunk = this.getChunkAtWorld(wx, wz);
    if (!chunk) return false;
    const idx = this.getIndexInChunk(chunk, wx, wy, wz);
    if (idx == null) return false;

    const mat = chunk.material[idx] as MaterialType;
    if (mat !== MaterialType.WATER && mat !== MaterialType.ICE) return false;
    return chunk.density[idx] <= ISO_LEVEL;
  }

  /**
   * Returns the sea-level water surface Y at (x,z) if that column currently has sea-level water.
   * This is used for buoyancy/surface floating behavior.
   */
  getSeaSurfaceYAtWorld(wx: number, wz: number): number | null {
    const chunk = this.getChunkAtWorld(wx, wz);
    if (!chunk) return null;

    const seaGridYRaw = Math.floor(WATER_LEVEL - MESH_Y_OFFSET) + PAD;
    const seaGridY = Math.max(0, Math.min(TOTAL_SIZE_Y - 2, seaGridYRaw));

    const lx = Math.floor(wx - chunk.cx * CHUNK_SIZE_XZ) + PAD;
    const lz = Math.floor(wz - chunk.cz * CHUNK_SIZE_XZ) + PAD;
    if (lx < 0 || lx >= TOTAL_SIZE_XZ) return null;
    if (lz < 0 || lz >= TOTAL_SIZE_XZ) return null;

    const idx = lx + seaGridY * TOTAL_SIZE_XZ + lz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
    const mat = chunk.material[idx] as MaterialType;
    if (mat !== MaterialType.WATER && mat !== MaterialType.ICE) return null;
    if (chunk.density[idx] > ISO_LEVEL) return null;

    return WATER_LEVEL;
  }

  /**
   * Estimate how much "open sky" is visible from a world position.
   *
   * Returns a value in [0..1]:
   * - 1.0 means rays upward do not hit solid terrain within `maxDistance`
   * - 0.0 means terrain is very close overhead (deeply occluded)
   *
   * This is a cheap, camera-local approximation used by atmosphere/lighting to reduce
   * sun/moon artifacts inside caverns/overhangs. It is NOT a replacement for real
   * skylight propagation (which would be computed per-voxel in the worker/mesher).
   */
  estimateSkyVisibility(
    wx: number,
    wy: number,
    wz: number,
    opts?: {
      /** Maximum ray length to check above the point. */
      maxDistance?: number;
      /** Step size along each ray. Larger = cheaper but less accurate. */
      step?: number;
    }
  ): number | null {
    const maxDistance = opts?.maxDistance ?? 60;
    const step = opts?.step ?? 3;

    // "Is there a roof?", not "is terrain nearby?". The vertical ray decides:
    // - it reaches the sky: open (a narrow canyon or dune valley costs at most 10%);
    // - it is blocked: enclosed, brightened up to 0.5 by tilted rays that escape
    //   (cave mouth vs. deep cave).
    // Tilted rays only count as blocked when terrain is close (a cliff 20m away is
    // not a ceiling). Averaging all rays equally made open valleys read ~30% underground.
    const TILTED_BLOCK_DIST = 12;
    let verticalOpen: boolean | null = null;
    let tiltedOpen = 0;
    let tiltedKnown = 0;

    for (let r = 0; r < SKY_VIS_DIRS.length; r++) {
      const dir = SKY_VIS_DIRS[r];
      const limit = r === 0 ? maxDistance : Math.min(maxDistance, TILTED_BLOCK_DIST);
      let escaped = true;
      let unknown = false;

      // Start a bit above the point to avoid self-intersection with the ground voxel.
      for (let d = 1.0; d <= limit; d += step) {
        const sx = wx + dir.x * d;
        const sy = wy + dir.y * d;
        const sz = wz + dir.z * d;

        // Above the voxel grid is open sky.
        if (sy - MESH_Y_OFFSET + PAD >= TOTAL_SIZE_Y) break;

        const chunk = this.getChunkAtWorld(sx, sz);
        if (!chunk) { unknown = true; break; }
        const idx = this.getIndexInChunk(chunk, sx, sy, sz);
        if (idx == null) { unknown = true; break; }

        // Solid terrain is density > ISO_LEVEL; liquids live in air space and don't occlude.
        if (chunk.density[idx] > ISO_LEVEL) { escaped = false; break; }
      }

      // Missing chunks: skip this ray (callers keep their last estimate on null).
      if (unknown) continue;
      if (r === 0) verticalOpen = escaped;
      else { tiltedKnown++; if (escaped) tiltedOpen++; }
    }

    if (verticalOpen === null) return null;
    const tiltedFrac = tiltedKnown > 0 ? tiltedOpen / tiltedKnown : (verticalOpen ? 1 : 0);
    if (verticalOpen) return 0.9 + 0.1 * tiltedFrac;
    if (BiomeManager.getWorldType() !== WorldType.SKY_ISLANDS) return 0.5 * tiltedFrac;

    // Among floating islands a roof overhead is usually another island: open
    // all around, it is shade, not a cave (the fog and exposure went cave-black
    // under every island). Caves still have walls on most sides.
    const SIDE_DIST = 24;
    let sideOpen = 0, sideKnown = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let escaped = true, unknown = false;
      for (let d = 2; d <= SIDE_DIST; d += step) {
        const sx = wx + dx * d, sz = wz + dz * d;
        const chunk = this.getChunkAtWorld(sx, sz);
        if (!chunk) { unknown = true; break; }
        const idx = this.getIndexInChunk(chunk, sx, wy, sz);
        if (idx == null) { unknown = true; break; }
        if (chunk.density[idx] > ISO_LEVEL) { escaped = false; break; }
      }
      if (unknown) continue;
      sideKnown++;
      if (escaped) sideOpen++;
    }
    const sideFrac = sideKnown > 0 ? sideOpen / sideKnown : 0;
    const enclosed = 0.5 * tiltedFrac;
    // Mostly open sides lift it toward open air (0.8 when every side is open).
    return Math.max(enclosed, 0.8 * smoothRange(sideFrac, 0.5, 0.9));
  }
}

function smoothRange(x: number, lo: number, hi: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

// Singleton instance used across gameplay systems.
export const terrainRuntime = new TerrainRuntime();

// Console debugging: window.__terrainRuntime.estimateSkyVisibility(x, y, z)
if (typeof window !== 'undefined') {
  (window as unknown as { __terrainRuntime?: TerrainRuntime }).__terrainRuntime = terrainRuntime;
}
