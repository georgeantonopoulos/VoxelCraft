# ChunkDataManager Integration Plan

## Overview

This plan integrates `ChunkDataManager` into the existing VoxelTerrain system as a **parallel path** initially, with a feature flag to switch between old and new systems.

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURRENT FLOW                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  terrain.worker.ts                                                  │
│       │                                                             │
│       │ postMessage({ type: 'GENERATED', payload })                 │
│       ▼                                                             │
│  WorkerPool.addMessageListener()                                    │
│       │                                                             │
│       │ workerMessageQueue.current.push(e.data)                     │
│       ▼                                                             │
│  useFrame() → processWorkerMessages()                               │
│       │                                                             │
│       │ chunkDataRef.current.set(key, newChunk)                     │
│       │ queueVersionAdd(key)                                        │
│       ▼                                                             │
│  flushVersionUpdates() → setChunkVersions()                         │
│       │                                                             │
│       │ React re-render (O(n) reconciliation)                       │
│       ▼                                                             │
│  {Object.keys(chunkVersions).map() → <ChunkMesh />}                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TARGET FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  terrain.worker.ts (UNCHANGED)                                      │
│       │                                                             │
│       │ postMessage({ type: 'GENERATED', payload })                 │
│       ▼                                                             │
│  WorkerPool.addMessageListener()                                    │
│       │                                                             │
│       │ chunkDataManager.addChunk(key, chunk)                       │
│       ▼                                                             │
│  ChunkDataManager                                                   │
│       │  - LRU cache management                                     │
│       │  - Dirty tracking                                           │
│       │  - Event emission                                           │
│       │                                                             │
│       │ emit('chunk-ready', { key, chunk })                         │
│       ▼                                                             │
│  VoxelTerrain (event listener)                                      │
│       │                                                             │
│       │ queueVersionAdd(key)  // SAME as before                     │
│       ▼                                                             │
│  flushVersionUpdates() → setChunkVersions()                         │
│       │                                                             │
│       │ React re-render (still O(n), but cleaner separation)        │
│       ▼                                                             │
│  {Object.keys(chunkVersions).map() → <ChunkMesh />}                 │
│                                                                     │
│  FUTURE: Replace React rendering with ChunkViewManager              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Wire ChunkDataManager to Worker Messages (LOW RISK)

**Goal**: Route worker messages through ChunkDataManager without changing behavior.

**Files to modify**:
- `src/features/terrain/components/VoxelTerrain.tsx`

**Changes**:

1. Import ChunkDataManager:
```typescript
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
```

2. In worker message handler for `GENERATED` (line ~1344):
```typescript
// BEFORE:
chunkDataRef.current.set(key, newChunk);
queueVersionAdd(key);

// AFTER:
chunkDataManager.addChunk(key, newChunk);
chunkDataRef.current.set(key, newChunk); // Keep for now (backward compat)
queueVersionAdd(key);
```

3. In worker message handler for `REMESHED` (line ~1413):
```typescript
// BEFORE:
const existing = chunkDataRef.current.get(key);
// ... update existing ...

// AFTER:
const existing = chunkDataManager.getChunk(key) || chunkDataRef.current.get(key);
// ... update existing ...
chunkDataManager.addChunk(key, existing); // Update manager
```

**Verification**:
- Run game with `?profile` flag
- Check `window.__chunkDataManager.getStats()` shows chunks
- Behavior should be identical to before

---

### Phase 2: Wire Terrain Modifications (MEDIUM RISK)

**Goal**: Track dirty chunks through ChunkDataManager.

**Files to modify**:
- `src/features/terrain/components/VoxelTerrain.tsx`

**Changes**:

1. After terrain modification (dig/build) at line ~2416:
```typescript
// BEFORE:
TerrainService.modifyChunk(chunk.density, chunk.material, ...);
remeshQueue.current.add(key);

// AFTER:
TerrainService.modifyChunk(chunk.density, chunk.material, ...);
chunkDataManager.markDirty(key);  // NEW: Track modification
remeshQueue.current.add(key);
```

2. After SMASH/CHOP actions modify ground items (line ~2050):
```typescript
chunkDataManager.markDirty(key);
```

**Verification**:
- Dig some blocks
- Check `__chunkDataManager.getDirtyCount()` increases
- Dirty chunks should not be evicted

---

### Phase 3: Replace chunkDataRef with ChunkDataManager (MEDIUM RISK)

**Goal**: Single source of truth for chunk data.

**Files to modify**:
- `src/features/terrain/components/VoxelTerrain.tsx`

**Changes**:

1. Remove `chunkDataRef` usage, replace with ChunkDataManager:
```typescript
// BEFORE:
const chunk = chunkDataRef.current.get(key);

// AFTER:
const chunk = chunkDataManager.getChunk(key);
```

2. Update all reads throughout VoxelTerrain.tsx:
   - Line ~1668: `chunkDataRef.current.get(key)` → `chunkDataManager.getChunk(key)`
   - Line ~1840: Same
   - Line ~2350: Same
   - All raycast/interaction code

3. Keep `chunkDataRef` for now but make it a mirror:
```typescript
// After chunkDataManager.addChunk(key, chunk):
chunkDataRef.current.set(key, chunkDataManager.getChunk(key)!);
```

**Verification**:
- All gameplay should work identically
- Console: `__chunkDataManager.getChunkCount()` matches expected

---

### Phase 4: Hook Up Persistence (MEDIUM RISK)

**Goal**: Save dirty chunks to IndexedDB on hide/unload.

**Files to modify**:
- `src/core/terrain/ChunkDataManager.ts`
- `src/state/WorldDB.ts`

**Changes**:

1. Implement `persistChunk()` in ChunkDataManager:
```typescript
private async persistChunk(key: string): Promise<void> {
  const entry = this.chunks.get(key);
  if (!entry || !entry.isDirty) return;

  const chunk = entry.chunk;
  const [cx, cz] = key.split(',').map(Number);

  // Save all modified voxels
  const modifications: ChunkModification[] = [];
  for (let i = 0; i < chunk.density.length; i++) {
    // Only save voxels that differ from procedural generation
    // This requires storing the original density or re-generating to compare
    // For now, save the full chunk
  }

  await WorldDB.saveChunkModifications(cx, cz, chunk.density, chunk.material);
}
```

2. Add to WorldDB.ts:
```typescript
async saveChunkModifications(
  cx: number,
  cz: number,
  density: Float32Array,
  material: Uint8Array
): Promise<void> {
  // Diff against procedural generation would be ideal
  // For now, store full modified chunks
  await this.db.chunks.put({
    key: `${cx},${cz}`,
    density: Array.from(density),
    material: Array.from(material),
    timestamp: Date.now()
  });
}
```

3. Add beforeunload handler:
```typescript
// In VoxelTerrain.tsx useEffect:
const handleUnload = async () => {
  await chunkDataManager.saveAllDirty();
};
window.addEventListener('beforeunload', handleUnload);
```

**Verification**:
- Dig blocks, walk away, return - modifications persist
- Refresh page - modifications persist
- Check IndexedDB in DevTools

---

### Phase 5: Subscribe to Events (LOW RISK)

**Goal**: Use event system instead of direct updates.

**Files to modify**:
- `src/features/terrain/components/VoxelTerrain.tsx`

**Changes**:

1. Subscribe to ChunkDataManager events in useEffect:
```typescript
useEffect(() => {
  const unsubReady = chunkDataManager.on('chunk-ready', ({ key, chunk }) => {
    queueVersionAdd(key);
  });

  const unsubUpdate = chunkDataManager.on('chunk-updated', ({ key }) => {
    queueVersionIncrement(key);
  });

  const unsubRemove = chunkDataManager.on('chunk-remove', ({ key }) => {
    queueVersionRemoval(key);
  });

  return () => {
    unsubReady();
    unsubUpdate();
    unsubRemove();
  };
}, []);
```

2. Worker message handler becomes simpler:
```typescript
// BEFORE:
chunkDataRef.current.set(key, newChunk);
queueVersionAdd(key);

// AFTER:
chunkDataManager.addChunk(key, newChunk);
// Events handle the rest
```

**Verification**:
- Same behavior, cleaner code
- Events fire correctly (add logging temporarily)

---

### Phase 6: Memory Management (LOW RISK)

**Goal**: LRU eviction of clean chunks.

**Changes**:

1. ChunkDataManager already has LRU eviction implemented
2. Just need to verify it works:
   - Walk far from spawn
   - Check `__chunkDataManager.getStats()` - should cap at ~150 chunks
   - Dirty chunks should never be evicted

**Verification**:
- Walk to distant area (>150 chunks explored)
- Memory stays bounded
- Return to spawn - terrain regenerates correctly

---

## Risk Assessment

| Phase | Risk | Rollback Strategy |
|-------|------|-------------------|
| 1 | LOW | Remove import, changes are additive |
| 2 | LOW | Remove markDirty calls |
| 3 | MEDIUM | Keep chunkDataRef as backup, feature flag |
| 4 | MEDIUM | Disable persistence, changes are isolated |
| 5 | LOW | Revert to direct updates |
| 6 | LOW | Increase maxCacheSize to effectively disable |

## Feature Flag

Add URL parameter to toggle:
```typescript
const useChunkDataManager = useMemo(() => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('chunkManager');
}, []);
```

This allows A/B testing and easy rollback.

## Testing Checklist

After each phase:
- [ ] `npm run build` passes
- [ ] `npm run test:unit` passes
- [ ] Game loads without errors
- [ ] Walk around - terrain streams correctly
- [ ] Dig blocks - modification works
- [ ] Place blocks - building works
- [ ] Colliders work - player doesn't fall through
- [ ] No memory leaks (check DevTools Memory tab)
- [ ] `__chunkDataManager.getStats()` shows expected values

## Future: Imperative Rendering

Once ChunkDataManager is stable, the next major refactor is replacing React chunk rendering with imperative Three.js. This plan focuses only on the data layer.

The view layer refactor will:
1. Create `ChunkViewManager` that subscribes to ChunkDataManager events
2. Manage THREE.Group/Mesh objects imperatively
3. Eliminate React reconciliation entirely for chunks
4. Expected result: 10-50x faster chunk updates

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| 1 | 30 min | None |
| 2 | 30 min | Phase 1 |
| 3 | 1-2 hr | Phase 2 |
| 4 | 2-3 hr | Phase 3 |
| 5 | 30 min | Phase 3 |
| 6 | 30 min | Phase 5 |

Total: ~5-7 hours of focused work, spread across multiple sessions recommended.
