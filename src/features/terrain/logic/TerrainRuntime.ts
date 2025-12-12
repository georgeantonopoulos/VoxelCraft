import { CHUNK_SIZE_XZ, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET, ISO_LEVEL, WATER_LEVEL } from '@/constants';
import { MaterialType } from '@/types';

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
}

// Singleton instance used across gameplay systems.
export const terrainRuntime = new TerrainRuntime();

