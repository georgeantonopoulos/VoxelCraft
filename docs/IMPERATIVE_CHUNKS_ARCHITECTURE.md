# Imperative Chunk Architecture

## Executive Summary

This document describes a refactor of VoxelTerrain's chunk rendering from React-managed components to imperative Three.js objects. The goal is to eliminate React reconciliation overhead (currently 17-328ms for 49 chunks) while enabling better persistence and multiplayer support.

## Current Architecture Problems

### React Reconciliation Overhead

```
Current flow:
┌─────────────────────────────────────────────────────────────────┐
│  Worker produces chunk data                                      │
│       ↓                                                          │
│  queueVersionAdd(key) → pendingVersionAdds.set(key, 1)          │
│       ↓                                                          │
│  flushVersionUpdates() → setChunkVersions({...prev, [key]: 1})  │
│       ↓                                                          │
│  React re-renders VoxelTerrain                                   │
│       ↓                                                          │
│  Object.keys(chunkVersions).map() creates 49 JSX elements       │
│       ↓                                                          │
│  React diffs ALL 49 ChunkMesh components                        │
│       ↓                                                          │
│  Only 1 actually changed, but we paid O(n) cost                 │
└─────────────────────────────────────────────────────────────────┘
```

**Measured Impact**: 17-328ms per state update, potentially 60x/sec

### Data/View Coupling

Currently, when a chunk goes out of RENDER_DISTANCE:
1. React unmounts `<ChunkMesh>`
2. Geometry is disposed
3. If chunk had player modifications, they must be explicitly saved
4. Revisiting the chunk requires full regeneration

This couples **view lifecycle** (what's visible) to **data lifecycle** (what exists in the world).

---

## Proposed Architecture

### Core Principle: Separation of Concerns

```
┌─────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  ChunkCache     │  │  WorldDB        │  │  ChunkState     │ │
│  │  (in-memory)    │  │  (IndexedDB)    │  │  (per-chunk)    │ │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘ │
│           │                    │                    │           │
│           └────────────────────┼────────────────────┘           │
│                                ↓                                 │
│                    ChunkDataManager (singleton)                  │
│                    - Owns all ChunkState objects                 │
│                    - Handles persistence                         │
│                    - Tracks dirty chunks                         │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 │ Events: chunk-ready, chunk-updated, chunk-remove
                                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                        VIEW LAYER                                │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   ChunkViewManager                          ││
│  │  - Listens to ChunkDataManager events                       ││
│  │  - Creates/disposes Three.js objects imperatively           ││
│  │  - Manages visible subset of world data                     ││
│  │  - Owns a single THREE.Group added to scene                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  ChunkView      │  │  ChunkView      │  │  ChunkView      │ │
│  │  (THREE.Group)  │  │  (THREE.Group)  │  │  (THREE.Group)  │ │
│  │  - terrain mesh │  │  - terrain mesh │  │  - terrain mesh │ │
│  │  - water mesh   │  │  - water mesh   │  │  - water mesh   │ │
│  │  - vegetation   │  │  - vegetation   │  │  - vegetation   │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Detailed Component Design

### 1. ChunkDataManager

**Location**: `src/core/terrain/ChunkDataManager.ts`

```typescript
import { EventEmitter } from 'events';
import { ChunkState } from '@/types';
import { WorldDB } from '@state/WorldDB';

export interface ChunkEvents {
  'chunk-ready': (key: string, chunk: ChunkState) => void;
  'chunk-updated': (key: string, chunk: ChunkState) => void;
  'chunk-remove': (key: string) => void;
  'chunk-dirty': (key: string) => void;
}

class ChunkDataManager extends EventEmitter {
  private chunks = new Map<string, ChunkState>();
  private dirtyChunks = new Set<string>();
  private persistenceQueue: string[] = [];
  private persistenceTimer: number | null = null;

  // === CHUNK LIFECYCLE ===

  /**
   * Called when worker produces new chunk data.
   * Stores the data and emits event for view layer.
   */
  addChunk(key: string, chunk: ChunkState): void {
    const existing = this.chunks.get(key);

    if (existing) {
      // Merge: preserve player modifications, update terrain
      this.mergeChunkData(existing, chunk);
      this.emit('chunk-updated', key, existing);
    } else {
      this.chunks.set(key, chunk);
      this.emit('chunk-ready', key, chunk);
    }
  }

  /**
   * Called when chunk goes out of render distance.
   * Does NOT delete data - just notifies view to remove visuals.
   */
  hideChunk(key: string): void {
    // Persist if dirty before hiding
    if (this.dirtyChunks.has(key)) {
      this.persistChunk(key);
    }
    this.emit('chunk-remove', key);
    // Note: chunk data stays in this.chunks for quick reload
  }

  /**
   * Called when memory pressure requires unloading.
   * Actually removes data from memory.
   */
  unloadChunk(key: string): void {
    if (this.dirtyChunks.has(key)) {
      this.persistChunkSync(key); // Must save before unload
    }
    this.chunks.delete(key);
    this.emit('chunk-remove', key);
  }

  /**
   * Get chunk data (may return cached or need to load from DB).
   */
  getChunk(key: string): ChunkState | undefined {
    return this.chunks.get(key);
  }

  /**
   * Check if chunk exists in memory (doesn't mean it's visible).
   */
  hasChunk(key: string): boolean {
    return this.chunks.has(key);
  }

  // === MODIFICATION TRACKING ===

  /**
   * Mark a chunk as modified by player action.
   * Called after digging, placing blocks, etc.
   */
  markDirty(key: string): void {
    if (!this.chunks.has(key)) return;
    this.dirtyChunks.add(key);
    this.emit('chunk-dirty', key);
    this.schedulePersistence(key);
  }

  /**
   * Apply a terrain modification (dig/build).
   */
  modifyTerrain(
    key: string,
    modifications: Array<{ x: number; y: number; z: number; density: number; material?: number }>
  ): void {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Apply modifications to density/material arrays
    for (const mod of modifications) {
      const idx = this.worldToChunkIndex(mod.x, mod.y, mod.z, chunk);
      if (idx >= 0) {
        chunk.density[idx] = mod.density;
        if (mod.material !== undefined) {
          chunk.material[idx] = mod.material;
        }
      }
    }

    this.markDirty(key);
    this.emit('chunk-updated', key, chunk);
  }

  // === PERSISTENCE ===

  private schedulePersistence(key: string): void {
    if (!this.persistenceQueue.includes(key)) {
      this.persistenceQueue.push(key);
    }

    if (this.persistenceTimer === null) {
      // Debounce: save after 2 seconds of no changes
      this.persistenceTimer = window.setTimeout(() => {
        this.flushPersistence();
        this.persistenceTimer = null;
      }, 2000);
    }
  }

  private async flushPersistence(): Promise<void> {
    const toSave = [...this.persistenceQueue];
    this.persistenceQueue = [];

    for (const key of toSave) {
      await this.persistChunk(key);
    }
  }

  private async persistChunk(key: string): Promise<void> {
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Save to IndexedDB
    await WorldDB.saveChunk(key, {
      density: chunk.density,
      material: chunk.material,
      // Include any player-placed entities in this chunk
      entities: this.getChunkEntities(key),
      version: chunk.terrainVersion,
      lastModified: Date.now(),
    });

    this.dirtyChunks.delete(key);
  }

  private persistChunkSync(key: string): void {
    // Synchronous version for unload - uses blocking IndexedDB write
    // In practice, we'd use a more sophisticated approach
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Queue for async save and hope it completes
    this.persistChunk(key);
  }

  // === HELPERS ===

  private worldToChunkIndex(wx: number, wy: number, wz: number, chunk: ChunkState): number {
    const localX = Math.floor(wx - chunk.cx * CHUNK_SIZE_XZ);
    const localY = Math.floor(wy);
    const localZ = Math.floor(wz - chunk.cz * CHUNK_SIZE_XZ);

    if (localX < 0 || localX >= CHUNK_SIZE_XZ ||
        localY < 0 || localY >= CHUNK_SIZE_Y ||
        localZ < 0 || localZ >= CHUNK_SIZE_XZ) {
      return -1;
    }

    return localX + localY * TOTAL_SIZE_XZ + localZ * TOTAL_SIZE_XZ * TOTAL_SIZE_Y;
  }

  private mergeChunkData(existing: ChunkState, incoming: ChunkState): void {
    // If existing was modified, we need to re-apply modifications
    // For now, just update mesh data but keep density/material if dirty
    if (this.dirtyChunks.has(existing.key)) {
      // Keep existing density/material, update only mesh
      existing.meshPositions = incoming.meshPositions;
      existing.meshIndices = incoming.meshIndices;
      // ... etc
    } else {
      // Full replacement
      Object.assign(existing, incoming);
    }
  }

  private getChunkEntities(key: string): any[] {
    // Query WorldStore for entities in this chunk's bounds
    // Used for persistence
    return [];
  }
}

export const chunkDataManager = new ChunkDataManager();
```

### 2. ChunkViewManager

**Location**: `src/core/terrain/ChunkViewManager.ts`

```typescript
import * as THREE from 'three';
import { chunkDataManager } from './ChunkDataManager';
import { ChunkState } from '@/types';
import { TriplanarMaterial } from '@core/graphics/TriplanarMaterial';

interface ChunkView {
  group: THREE.Group;
  terrainMesh: THREE.Mesh | null;
  waterMesh: THREE.Mesh | null;
  vegetationGroup: THREE.Group | null;
  collider: any | null; // Rapier collider reference
  lodLevel: number;
  lastUpdate: number;
}

export class ChunkViewManager {
  private scene: THREE.Scene;
  private rootGroup: THREE.Group;
  private views = new Map<string, ChunkView>();
  private sharedMaterial: THREE.Material;

  // Pool for geometry reuse
  private geometryPool: THREE.BufferGeometry[] = [];
  private maxPoolSize = 20;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'ChunkViewManager';
    this.scene.add(this.rootGroup);

    // Shared material for all terrain chunks
    this.sharedMaterial = this.createSharedMaterial();

    // Subscribe to data layer events
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    chunkDataManager.on('chunk-ready', this.onChunkReady.bind(this));
    chunkDataManager.on('chunk-updated', this.onChunkUpdated.bind(this));
    chunkDataManager.on('chunk-remove', this.onChunkRemove.bind(this));
  }

  // === EVENT HANDLERS ===

  private onChunkReady(key: string, chunk: ChunkState): void {
    if (this.views.has(key)) {
      // Already have a view, just update it
      this.updateView(key, chunk);
      return;
    }

    // Create new view
    const view = this.createView(key, chunk);
    this.views.set(key, view);
    this.rootGroup.add(view.group);
  }

  private onChunkUpdated(key: string, chunk: ChunkState): void {
    const view = this.views.get(key);
    if (!view) {
      // Chunk was updated but we don't have a view - create one
      this.onChunkReady(key, chunk);
      return;
    }

    this.updateView(key, chunk);
  }

  private onChunkRemove(key: string): void {
    const view = this.views.get(key);
    if (!view) return;

    this.disposeView(view);
    this.views.delete(key);
  }

  // === VIEW CREATION ===

  private createView(key: string, chunk: ChunkState): ChunkView {
    const group = new THREE.Group();
    group.name = `chunk-${key}`;
    group.position.set(chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ);

    const view: ChunkView = {
      group,
      terrainMesh: null,
      waterMesh: null,
      vegetationGroup: null,
      collider: null,
      lodLevel: chunk.lodLevel ?? 0,
      lastUpdate: performance.now(),
    };

    // Create terrain mesh
    if (chunk.meshPositions?.length && chunk.meshIndices?.length) {
      view.terrainMesh = this.createTerrainMesh(chunk);
      group.add(view.terrainMesh);
    }

    // Create water mesh
    if (chunk.meshWaterPositions?.length && chunk.meshWaterIndices?.length) {
      view.waterMesh = this.createWaterMesh(chunk);
      group.add(view.waterMesh);
    }

    // Create vegetation (can be done lazily)
    if (chunk.vegetationData) {
      view.vegetationGroup = this.createVegetation(chunk);
      group.add(view.vegetationGroup);
    }

    return view;
  }

  private createTerrainMesh(chunk: ChunkState): THREE.Mesh {
    const geometry = this.getPooledGeometry() || new THREE.BufferGeometry();

    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions!, 3));
    if (chunk.meshNormals) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));
    }

    // Material weight attributes
    if (chunk.meshMatWeightsA) {
      geometry.setAttribute('aMatWeightsA', new THREE.BufferAttribute(chunk.meshMatWeightsA, 4));
    }
    // ... other attributes

    geometry.setIndex(new THREE.BufferAttribute(chunk.meshIndices!, 1));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, this.sharedMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { type: 'terrain', key: chunk.key };

    return mesh;
  }

  private createWaterMesh(chunk: ChunkState): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.meshWaterPositions!, 3));
    geometry.setIndex(new THREE.BufferAttribute(chunk.meshWaterIndices!, 1));
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(geometry, this.waterMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;

    return mesh;
  }

  private createVegetation(chunk: ChunkState): THREE.Group {
    const group = new THREE.Group();

    // Create instanced meshes for each vegetation type
    // This replaces VegetationLayer, TreeLayer, etc.

    if (chunk.vegetationData) {
      for (const [typeStr, positions] of Object.entries(chunk.vegetationData)) {
        const typeId = parseInt(typeStr);
        const instancedMesh = this.createVegetationInstances(typeId, positions as Float32Array);
        if (instancedMesh) {
          group.add(instancedMesh);
        }
      }
    }

    return group;
  }

  // === VIEW UPDATE ===

  private updateView(key: string, chunk: ChunkState): void {
    const view = this.views.get(key);
    if (!view) return;

    // Update terrain geometry
    if (view.terrainMesh && chunk.meshPositions?.length) {
      const geometry = view.terrainMesh.geometry;

      // Update existing buffer attributes in place (avoid allocation)
      const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
      if (posAttr.array.length === chunk.meshPositions.length) {
        posAttr.array.set(chunk.meshPositions);
        posAttr.needsUpdate = true;
      } else {
        // Size changed, need new geometry
        geometry.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));
      }

      // Update other attributes similarly...
      geometry.computeBoundingSphere();
    }

    view.lastUpdate = performance.now();
  }

  // === VIEW DISPOSAL ===

  private disposeView(view: ChunkView): void {
    // Remove from scene
    this.rootGroup.remove(view.group);

    // Dispose terrain mesh
    if (view.terrainMesh) {
      const geometry = view.terrainMesh.geometry;
      // Return to pool if small enough
      if (this.geometryPool.length < this.maxPoolSize) {
        this.geometryPool.push(geometry);
      } else {
        geometry.dispose();
      }
    }

    // Dispose water mesh
    if (view.waterMesh) {
      view.waterMesh.geometry.dispose();
    }

    // Dispose vegetation
    if (view.vegetationGroup) {
      view.vegetationGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
          obj.geometry.dispose();
        }
      });
    }

    // Remove collider
    if (view.collider) {
      // Rapier collider removal
    }
  }

  // === GEOMETRY POOLING ===

  private getPooledGeometry(): THREE.BufferGeometry | null {
    return this.geometryPool.pop() || null;
  }

  // === SHARED RESOURCES ===

  private createSharedMaterial(): THREE.Material {
    // Create single TriplanarMaterial instance shared by all chunks
    // Uniforms are updated once per frame in useFrame
    return new TriplanarMaterial({
      // ... material options
    });
  }

  // === PUBLIC API ===

  /**
   * Update LOD levels based on camera position.
   * Called from useFrame.
   */
  updateLODs(cameraPosition: THREE.Vector3): void {
    for (const [key, view] of this.views) {
      const [cx, cz] = key.split(',').map(Number);
      const chunkCenter = new THREE.Vector3(
        cx * CHUNK_SIZE_XZ + CHUNK_SIZE_XZ / 2,
        0,
        cz * CHUNK_SIZE_XZ + CHUNK_SIZE_XZ / 2
      );

      const distance = cameraPosition.distanceTo(chunkCenter);
      const newLod = this.calculateLOD(distance);

      if (newLod !== view.lodLevel) {
        view.lodLevel = newLod;
        this.updateViewLOD(key, view, newLod);
      }
    }
  }

  /**
   * Get visible chunk count for debugging.
   */
  getVisibleCount(): number {
    return this.views.size;
  }

  /**
   * Cleanup all resources.
   */
  dispose(): void {
    for (const view of this.views.values()) {
      this.disposeView(view);
    }
    this.views.clear();
    this.scene.remove(this.rootGroup);
    this.sharedMaterial.dispose();

    for (const geo of this.geometryPool) {
      geo.dispose();
    }
    this.geometryPool = [];
  }
}
```

### 3. React Integration Layer

**Location**: `src/features/terrain/components/VoxelTerrainImperative.tsx`

```typescript
import React, { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { ChunkViewManager } from '@core/terrain/ChunkViewManager';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { useSettingsStore } from '@state/SettingsStore';
import { updateSharedUniforms } from '@core/graphics/SharedUniforms';
import { frameProfiler } from '@core/utils/FrameProfiler';

/**
 * Thin React wrapper around the imperative chunk system.
 *
 * Responsibilities:
 * - Initialize ChunkViewManager with Three.js scene
 * - Run streaming logic in useFrame
 * - Bridge settings store to chunk system
 * - Cleanup on unmount
 *
 * NOT responsible for:
 * - Creating/updating/disposing chunk meshes (ChunkViewManager does this)
 * - Managing chunk data (ChunkDataManager does this)
 * - React reconciliation of chunks (eliminated!)
 */
export const VoxelTerrainImperative: React.FC<{
  initialSpawnPos?: [number, number, number];
  onInitialLoad?: () => void;
}> = ({ initialSpawnPos, onInitialLoad }) => {
  const { scene, camera } = useThree();
  const viewManager = useRef<ChunkViewManager | null>(null);

  // Settings from store
  const renderDistance = useSettingsStore((s) => s.renderDistance);
  const fogNear = useSettingsStore((s) => s.fogNear);
  const fogFar = useSettingsStore((s) => s.fogFar);

  // Initialize view manager
  useEffect(() => {
    viewManager.current = new ChunkViewManager(scene);

    return () => {
      viewManager.current?.dispose();
      viewManager.current = null;
    };
  }, [scene]);

  // Main update loop
  useFrame((state) => {
    frameProfiler.begin('terrain-imperative');

    if (!viewManager.current) {
      frameProfiler.end('terrain-imperative');
      return;
    }

    // 1. Determine which chunks should be visible
    const visibleKeys = calculateVisibleChunks(
      camera.position,
      renderDistance
    );

    // 2. Request chunks that aren't loaded
    for (const key of visibleKeys) {
      if (!chunkDataManager.hasChunk(key)) {
        requestChunkGeneration(key);
      }
    }

    // 3. Hide chunks that went out of range
    for (const key of chunkDataManager.getLoadedKeys()) {
      if (!visibleKeys.has(key)) {
        chunkDataManager.hideChunk(key);
      }
    }

    // 4. Update LODs
    viewManager.current.updateLODs(camera.position);

    // 5. Update shared uniforms (fog, sun direction, etc.)
    updateSharedUniforms({
      cameraPosition: camera.position,
      fogNear,
      fogFar,
      // ... other uniforms
    });

    frameProfiler.end('terrain-imperative');
  });

  // No children rendered! All chunk visuals are managed imperatively.
  return null;
};

// Helper functions
function calculateVisibleChunks(
  cameraPos: THREE.Vector3,
  renderDistance: number
): Set<string> {
  const keys = new Set<string>();
  const cx = Math.floor(cameraPos.x / CHUNK_SIZE_XZ);
  const cz = Math.floor(cameraPos.z / CHUNK_SIZE_XZ);

  for (let dx = -renderDistance; dx <= renderDistance; dx++) {
    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
      keys.add(`${cx + dx},${cz + dz}`);
    }
  }

  return keys;
}

function requestChunkGeneration(key: string): void {
  // Send message to terrain worker pool
  // When worker responds, it calls chunkDataManager.addChunk()
}
```

---

## Migration Strategy

### Phase 1: Parallel Implementation (Low Risk)

1. Create `ChunkDataManager` alongside existing code
2. Create `ChunkViewManager` alongside existing code
3. Create `VoxelTerrainImperative` component
4. Add feature flag: `?imperativeChunks`
5. Test thoroughly with flag enabled

### Phase 2: Gradual Migration

1. Move worker message handling to use `ChunkDataManager`
2. Keep old React path as fallback
3. A/B test performance in production

### Phase 3: Full Cutover

1. Remove React-based chunk rendering
2. Remove `chunkVersions` state
3. Simplify VoxelTerrain to just be the imperative wrapper

---

## Performance Expectations

| Metric | Current (React) | Imperative |
|--------|-----------------|------------|
| Chunk add/remove | O(n) reconciliation | O(1) direct |
| State updates/sec | 10 (throttled) | 0 (no React state) |
| Memory per chunk | ChunkState + React fiber | ChunkState only |
| GC pressure | High (JSX objects) | Low (reused objects) |
| Worst-case frame | 328ms (measured) | <5ms (estimated) |

---

## Persistence Integration

With this architecture, persistence becomes straightforward:

```typescript
// On player modification (dig/build):
chunkDataManager.modifyTerrain(key, modifications);
// → Automatically marks dirty
// → Automatically schedules IndexedDB save
// → View updates immediately via event

// On chunk unload:
chunkDataManager.hideChunk(key);
// → Saves if dirty
// → Removes view but keeps data in memory
// → Fast reload when player returns

// On game save:
await chunkDataManager.saveAllDirty();

// On game load:
const savedChunks = await WorldDB.getAllChunks();
for (const chunk of savedChunks) {
  chunkDataManager.addChunk(chunk.key, chunk);
}
```

---

## Multiplayer Considerations

The separation of data and view layers makes multiplayer easier:

```typescript
// Local player chunks
const localChunkData = new ChunkDataManager();

// Remote player chunks (received over network)
const remoteChunkUpdates = new Map<string, Partial<ChunkState>>();

// Network layer
socket.on('chunk-update', (key, delta) => {
  // Merge network delta with local data
  localChunkData.applyNetworkDelta(key, delta);
});

// When local player modifies terrain
chunkDataManager.on('chunk-dirty', (key) => {
  const delta = chunkDataManager.getDelta(key);
  socket.emit('chunk-update', key, delta);
});
```

The view layer doesn't care where data comes from - it just responds to events.

---

## Open Questions

1. **Collider Management**: Should colliders be managed by ChunkViewManager or a separate ColliderManager?

2. **Vegetation/Flora**: Keep as instanced meshes in ChunkView, or separate VegetationViewManager?

3. **Rapier Integration**: React-three-rapier expects React components. May need to use Rapier directly.

4. **Devtools**: How to provide visibility into chunk state without React DevTools?

---

## Files to Create/Modify

### New Files
- `src/core/terrain/ChunkDataManager.ts`
- `src/core/terrain/ChunkViewManager.ts`
- `src/features/terrain/components/VoxelTerrainImperative.tsx`

### Modified Files
- `src/features/terrain/components/VoxelTerrain.tsx` - Add feature flag
- `src/state/WorldDB.ts` - Add chunk persistence methods
- `src/features/terrain/workers/terrain.worker.ts` - Emit to ChunkDataManager

### Eventually Deprecated
- `src/features/terrain/components/ChunkMesh.tsx`
- `src/features/terrain/components/VegetationLayer.tsx`
- `src/features/terrain/components/TreeLayer.tsx`
- `src/features/terrain/components/LuminaLayer.tsx`
- `src/features/terrain/components/GroundItemsLayer.tsx`

---

## Next Steps

1. Review this document and provide feedback
2. Decide on Phase 1 scope
3. Create `ChunkDataManager` as first concrete step
4. Benchmark current vs imperative on a simple case
