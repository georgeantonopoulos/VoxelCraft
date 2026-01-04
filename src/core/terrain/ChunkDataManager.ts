/**
 * ChunkDataManager - Centralized chunk data ownership and lifecycle management.
 *
 * Key responsibilities:
 * - Single source of truth for all ChunkState data
 * - LRU cache for memory management (clean chunks can be evicted and regenerated)
 * - Dirty tracking for player-modified chunks (these MUST be persisted)
 * - Event emission for view layer updates
 * - Persistence coordination with IndexedDB
 *
 * Design principles:
 * - Terrain generation is deterministic (seed 1337), so clean chunks don't need persistence
 * - Only player-modified (dirty) chunks need IndexedDB storage
 * - View layer subscribes to events, doesn't directly access internal state
 */

import { ChunkState, MaterialType } from '@/types';
import { CHUNK_SIZE_XZ, CHUNK_SIZE_Y, TOTAL_SIZE_XZ, TOTAL_SIZE_Y, PAD, MESH_Y_OFFSET } from '@/constants';
import { saveChunkModificationsBulk, getChunkModifications } from '@/state/WorldDB';

// Event types emitted by ChunkDataManager
export type ChunkEventType = 'chunk-ready' | 'chunk-updated' | 'chunk-remove' | 'chunk-dirty';

export interface ChunkEventData {
  key: string;
  chunk?: ChunkState;
}

type ChunkEventCallback = (event: ChunkEventData) => void;

// LRU cache entry with access tracking
interface CacheEntry {
  chunk: ChunkState;
  lastAccess: number;
  isDirty: boolean;
  modifiedVoxels: Set<number>; // Track which voxel indices were modified
}

class ChunkDataManager {
  // Main chunk storage
  private chunks = new Map<string, CacheEntry>();

  // Event listeners
  private listeners = new Map<ChunkEventType, Set<ChunkEventCallback>>();

  // Configuration
  private maxCacheSize = 150; // Keep ~150 chunks in memory (3x render distance squared)
  private persistenceDebounceMs = 2000;

  // Persistence queue
  private persistenceQueue = new Set<string>();
  private persistenceTimer: number | null = null;

  constructor() {
    // Initialize event listener sets
    this.listeners.set('chunk-ready', new Set());
    this.listeners.set('chunk-updated', new Set());
    this.listeners.set('chunk-remove', new Set());
    this.listeners.set('chunk-dirty', new Set());
  }

  // === EVENT SYSTEM ===

  /**
   * Subscribe to chunk events.
   * Returns unsubscribe function.
   */
  on(event: ChunkEventType, callback: ChunkEventCallback): () => void {
    this.listeners.get(event)?.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: ChunkEventType, data: ChunkEventData): void {
    this.listeners.get(event)?.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error(`[ChunkDataManager] Error in ${event} listener:`, e);
      }
    });
  }

  // === CHUNK LIFECYCLE ===

  /**
   * Add or update a chunk.
   * Called when worker produces new chunk data.
   */
  addChunk(key: string, chunk: ChunkState): void {
    const existing = this.chunks.get(key);
    const now = performance.now();

    if (existing) {
      // Merge: if existing is dirty, preserve player modifications
      if (existing.isDirty) {
        this.mergeChunkData(existing.chunk, chunk);
        existing.lastAccess = now;
        this.emit('chunk-updated', { key, chunk: existing.chunk });
      } else {
        // Replace entirely
        existing.chunk = chunk;
        existing.lastAccess = now;
        this.emit('chunk-updated', { key, chunk });
      }
    } else {
      // New chunk
      this.chunks.set(key, {
        chunk,
        lastAccess: now,
        isDirty: false,
        modifiedVoxels: new Set(),
      });
      this.emit('chunk-ready', { key, chunk });

      // Check if we need to evict old chunks
      this.evictIfNeeded();
    }
  }

  /**
   * Get a chunk if it exists in memory.
   * Updates LRU access time.
   */
  getChunk(key: string): ChunkState | undefined {
    const entry = this.chunks.get(key);
    if (entry) {
      entry.lastAccess = performance.now();
      return entry.chunk;
    }
    return undefined;
  }

  /**
   * Check if chunk exists in memory.
   */
  hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  /**
   * Check if chunk is dirty (has player modifications).
   */
  isDirty(key: string): boolean {
    return this.chunks.get(key)?.isDirty ?? false;
  }

  /**
   * Signal that a chunk is no longer visible.
   * Doesn't remove from cache, just notifies view layer.
   */
  hideChunk(key: string): void {
    // If dirty, ensure it's queued for persistence
    const entry = this.chunks.get(key);
    if (entry?.isDirty) {
      this.queuePersistence(key);
    }

    this.emit('chunk-remove', { key });
  }

  /**
   * Get all loaded chunk keys.
   */
  getLoadedKeys(): Set<string> {
    return new Set(this.chunks.keys());
  }

  /**
   * Get count of chunks in memory.
   */
  getChunkCount(): number {
    return this.chunks.size;
  }

  /**
   * Get count of dirty chunks.
   */
  getDirtyCount(): number {
    let count = 0;
    for (const entry of this.chunks.values()) {
      if (entry.isDirty) count++;
    }
    return count;
  }

  // === MODIFICATION TRACKING ===

  /**
   * Mark a chunk as modified by player action.
   * This ensures it will be persisted and not evicted.
   *
   * @param voxelIndices Optional array of modified voxel indices for precise persistence
   */
  markDirty(key: string, voxelIndices?: number[]): void {
    const entry = this.chunks.get(key);
    if (!entry) return;

    if (!entry.isDirty) {
      entry.isDirty = true;
      this.emit('chunk-dirty', { key, chunk: entry.chunk });
    }

    // Track modified voxels if provided
    if (voxelIndices) {
      for (const idx of voxelIndices) {
        entry.modifiedVoxels.add(idx);
      }
    }

    this.queuePersistence(key);
  }

  /**
   * Apply terrain modifications (dig/build) to a chunk.
   * Automatically marks the chunk as dirty.
   *
   * @param key Chunk key
   * @param modifications Array of voxel modifications
   */
  modifyTerrain(
    key: string,
    modifications: Array<{
      localX: number;
      localY: number;
      localZ: number;
      density: number;
      material?: number;
    }>
  ): boolean {
    const entry = this.chunks.get(key);
    if (!entry) return false;

    const chunk = entry.chunk;

    for (const mod of modifications) {
      const idx = this.localToIndex(mod.localX, mod.localY, mod.localZ);
      if (idx >= 0 && idx < chunk.density.length) {
        chunk.density[idx] = mod.density;
        if (mod.material !== undefined && chunk.material) {
          chunk.material[idx] = mod.material;
        }
        // Track this voxel as modified for persistence
        entry.modifiedVoxels.add(idx);
      }
    }

    // Mark dirty and bump terrain version to trigger remesh
    entry.isDirty = true;
    chunk.terrainVersion = (chunk.terrainVersion || 0) + 1;

    this.emit('chunk-dirty', { key, chunk });
    this.emit('chunk-updated', { key, chunk });
    this.queuePersistence(key);

    return true;
  }

  // === LRU CACHE MANAGEMENT ===

  /**
   * Evict least-recently-used CLEAN chunks if over capacity.
   * Dirty chunks are never evicted (they have player data).
   */
  private evictIfNeeded(): void {
    if (this.chunks.size <= this.maxCacheSize) return;

    // Find eviction candidates (clean chunks only)
    const candidates: Array<{ key: string; lastAccess: number }> = [];
    for (const [key, entry] of this.chunks) {
      if (!entry.isDirty) {
        candidates.push({ key, lastAccess: entry.lastAccess });
      }
    }

    // Sort by last access (oldest first)
    candidates.sort((a, b) => a.lastAccess - b.lastAccess);

    // Evict oldest until under capacity
    const toEvict = this.chunks.size - this.maxCacheSize;
    for (let i = 0; i < toEvict && i < candidates.length; i++) {
      const key = candidates[i].key;
      this.chunks.delete(key);
      // Note: We don't emit 'chunk-remove' here because the view layer
      // should have already hidden these chunks when they went out of range.
      // This is just memory cleanup.
    }

    if (toEvict > candidates.length) {
      console.warn(
        `[ChunkDataManager] Cannot evict enough chunks. ` +
        `Need to evict ${toEvict} but only ${candidates.length} clean chunks available. ` +
        `${this.getDirtyCount()} dirty chunks in memory.`
      );
    }
  }

  /**
   * Force eviction of a specific chunk.
   * Will persist if dirty before evicting.
   */
  async forceEvict(key: string): Promise<void> {
    const entry = this.chunks.get(key);
    if (!entry) return;

    if (entry.isDirty) {
      await this.persistChunk(key);
    }

    this.chunks.delete(key);
    this.emit('chunk-remove', { key });
  }

  // === PERSISTENCE ===

  /**
   * Queue a chunk for persistence (debounced).
   */
  private queuePersistence(key: string): void {
    this.persistenceQueue.add(key);

    if (this.persistenceTimer === null) {
      this.persistenceTimer = window.setTimeout(() => {
        this.flushPersistence();
        this.persistenceTimer = null;
      }, this.persistenceDebounceMs);
    }
  }

  /**
   * Persist all queued chunks.
   */
  private async flushPersistence(): Promise<void> {
    const keys = [...this.persistenceQueue];
    this.persistenceQueue.clear();

    for (const key of keys) {
      await this.persistChunk(key);
    }
  }

  /**
   * Persist a single chunk to IndexedDB.
   */
  private async persistChunk(key: string): Promise<void> {
    const entry = this.chunks.get(key);
    if (!entry || !entry.isDirty) return;

    // Skip if no specific voxels were tracked as modified
    // (this means only metadata changed, not terrain)
    if (entry.modifiedVoxels.size === 0) return;

    try {
      const chunk = entry.chunk;
      const [cxStr, czStr] = key.split(',');
      const cx = parseInt(cxStr);
      const cz = parseInt(czStr);

      // Build modifications array from tracked voxels
      const modifications: Array<{ voxelIndex: number; material: MaterialType; density: number }> = [];
      for (const idx of entry.modifiedVoxels) {
        modifications.push({
          voxelIndex: idx,
          material: chunk.material[idx] as MaterialType,
          density: chunk.density[idx]
        });
      }

      // Save to IndexedDB
      await saveChunkModificationsBulk(cx, cz, modifications);

      // Note: We intentionally don't clear isDirty here.
      // The chunk remains dirty in memory so we know it has player modifications.
      // isDirty is only cleared when loading a persisted chunk from IndexedDB.
    } catch (e) {
      console.error(`[ChunkDataManager] Failed to persist chunk ${key}:`, e);
      // Re-queue for retry
      this.queuePersistence(key);
    }
  }

  /**
   * Save all dirty chunks immediately (e.g., before page unload).
   */
  async saveAllDirty(): Promise<void> {
    if (this.persistenceTimer !== null) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    const dirtyKeys: string[] = [];
    for (const [key, entry] of this.chunks) {
      if (entry.isDirty) {
        dirtyKeys.push(key);
      }
    }

    for (const key of dirtyKeys) {
      await this.persistChunk(key);
    }
  }

  /**
   * Load and apply persisted modifications to a chunk.
   * Call this after a chunk is procedurally generated to restore player modifications.
   *
   * @returns true if modifications were applied, false if none existed
   */
  async applyPersistedModifications(key: string): Promise<boolean> {
    const entry = this.chunks.get(key);
    if (!entry) return false;

    try {
      const [cxStr, czStr] = key.split(',');
      const cx = parseInt(cxStr);
      const cz = parseInt(czStr);

      const modifications = await getChunkModifications(cx, cz);
      if (modifications.length === 0) return false;

      const chunk = entry.chunk;

      // Apply each modification
      for (const mod of modifications) {
        if (mod.voxelIndex >= 0 && mod.voxelIndex < chunk.density.length) {
          chunk.density[mod.voxelIndex] = mod.density;
          chunk.material[mod.voxelIndex] = mod.material;
          entry.modifiedVoxels.add(mod.voxelIndex);
        }
      }

      // Mark as dirty since it has player modifications
      entry.isDirty = true;

      return true;
    } catch (e) {
      console.error(`[ChunkDataManager] Failed to load persisted modifications for ${key}:`, e);
      return false;
    }
  }

  // === HELPERS ===

  /**
   * Convert local chunk coordinates to flat array index.
   */
  private localToIndex(localX: number, localY: number, localZ: number): number {
    // Account for padding
    const ix = Math.floor(localX) + PAD;
    const iy = Math.floor(localY - MESH_Y_OFFSET) + PAD;
    const iz = Math.floor(localZ) + PAD;

    if (ix < 0 || ix >= TOTAL_SIZE_XZ ||
        iy < 0 || iy >= TOTAL_SIZE_Y ||
        iz < 0 || iz >= TOTAL_SIZE_XZ) {
      return -1;
    }

    return ix + iy * TOTAL_SIZE_XZ + iz * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
  }

  /**
   * Merge incoming chunk data with existing dirty chunk.
   * Preserves player modifications while updating mesh data.
   */
  private mergeChunkData(existing: ChunkState, incoming: ChunkState): void {
    // For a dirty chunk, we keep the existing density/material (player modifications)
    // but update the mesh data and other derived fields

    // Update mesh data (this will be regenerated anyway based on density)
    existing.meshPositions = incoming.meshPositions;
    existing.meshIndices = incoming.meshIndices;
    existing.meshNormals = incoming.meshNormals;
    existing.meshMatWeightsA = incoming.meshMatWeightsA;
    existing.meshMatWeightsB = incoming.meshMatWeightsB;
    existing.meshMatWeightsC = incoming.meshMatWeightsC;
    existing.meshMatWeightsD = incoming.meshMatWeightsD;
    existing.meshWetness = incoming.meshWetness;
    existing.meshMossiness = incoming.meshMossiness;
    existing.meshCavity = incoming.meshCavity;

    // Update water mesh
    existing.meshWaterPositions = incoming.meshWaterPositions;
    existing.meshWaterIndices = incoming.meshWaterIndices;
    existing.meshWaterShoreMask = incoming.meshWaterShoreMask;

    // Update collider data
    existing.colliderPositions = incoming.colliderPositions;
    existing.colliderIndices = incoming.colliderIndices;
    existing.colliderHeightfield = incoming.colliderHeightfield;
    existing.isHeightfield = incoming.isHeightfield;

    // Update vegetation/flora (these don't change with player modifications)
    existing.vegetationData = incoming.vegetationData;
    existing.treePositions = incoming.treePositions;
    existing.treeInstanceBatches = incoming.treeInstanceBatches;
    existing.floraPositions = incoming.floraPositions;
    existing.lightPositions = incoming.lightPositions;
    existing.rootHollowPositions = incoming.rootHollowPositions;
    existing.drySticks = incoming.drySticks;
    existing.jungleSticks = incoming.jungleSticks;
    existing.rockDataBuckets = incoming.rockDataBuckets;
    existing.largeRockPositions = incoming.largeRockPositions;

    // Firefly registry
    existing.fireflyPositions = incoming.fireflyPositions;

    // Update LOD
    existing.lodLevel = incoming.lodLevel;
  }

  // === DEBUG ===

  /**
   * Get debug statistics.
   */
  getStats(): {
    totalChunks: number;
    dirtyChunks: number;
    pendingPersistence: number;
    memoryEstimateMB: number;
  } {
    let memoryEstimate = 0;
    let dirtyCount = 0;

    for (const entry of this.chunks.values()) {
      if (entry.isDirty) dirtyCount++;

      // Rough estimate: density + material arrays
      const chunk = entry.chunk;
      if (chunk.density) memoryEstimate += chunk.density.length * 4; // Float32
      if (chunk.material) memoryEstimate += chunk.material.length * 1; // Uint8
      if (chunk.meshPositions) memoryEstimate += chunk.meshPositions.length * 4;
      if (chunk.meshIndices) memoryEstimate += chunk.meshIndices.length * 4;
    }

    return {
      totalChunks: this.chunks.size,
      dirtyChunks: dirtyCount,
      pendingPersistence: this.persistenceQueue.size,
      memoryEstimateMB: memoryEstimate / (1024 * 1024),
    };
  }

  /**
   * Clear all data (for testing/reset).
   */
  clear(): void {
    if (this.persistenceTimer !== null) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = null;
    }

    this.chunks.clear();
    this.persistenceQueue.clear();
  }
}

// Singleton instance
export const chunkDataManager = new ChunkDataManager();

// Expose to window for debugging
if (typeof window !== 'undefined') {
  (window as any).__chunkDataManager = chunkDataManager;
}
