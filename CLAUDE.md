# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run test:unit    # Run Vitest tests
npm run preview      # Preview production build
```

**Before finishing work**: Always run `npm run build` and `npm run test:unit`, then do a quick `npm run dev` smoke test.

## Architecture Overview

VoxelCraft is a voxel terrain engine using React Three Fiber, Three.js, and Rapier physics. Heavy computation runs in web workers to maintain 60 FPS.

### Terrain Pipeline

```
Player moves → Calculate visible chunks (RENDER_DISTANCE=3)
    → ChunkDataManager checks memory cache (LRU, maxSize=150)
    → If miss: Check IndexedDB for player modifications (WorldDB)
    → If miss: Worker generates chunk via 3D Simplex noise
    → Apply persisted modifications if they exist
    → Surface Nets meshing produces smooth geometry
    → Trimesh colliders created (throttled via colliderEnableQueue)
    → ChunkMesh mounted with TriplanarMaterial
    → Player modifications tracked as dirty in ChunkDataManager
    → Dirty chunks persisted to IndexedDB (debounced 2s)
```

### Key Directories

- `src/core/` - Shared engine: materials, shaders, worker pools, math utilities
- `src/features/terrain/` - Chunk generation, meshing, streaming (VoxelTerrain.tsx, mesher.ts)
- `src/features/flora/` - Trees, vegetation, particle systems
- `src/features/player/` - Movement, input, camera
- `src/features/interaction/` - Tools, digging, building, inventory
- `src/features/environment/` - Atmosphere, post-processing, lighting
- `src/state/` - Zustand stores (Settings, Inventory, World, Entity tracking)
- `src/tests/` - Vitest unit tests (mesher, terrain, stores)

### Worker Architecture

Workers handle expensive operations via `WorkerPool` (src/core/workers/WorkerPool.ts):
- `terrain.worker.ts` - Chunk generation + meshing
- `simulation.worker.ts` - Flora updates
- `fractal.worker.ts` - Tree geometry generation

Message format: `{ type: string, payload: {...} }`. Use transferables for Float32Arrays.

### State Management

11 Zustand stores handle different concerns:
- `SettingsStore` - Graphics quality, input mode
- `InventoryStore` - Player inventory (9 slots)
- `WorldStore` - Active entities (flora, torches, items)
- `EntityHistoryStore` - Health/damage tracking
- `ChunkCache` / `WorldDB` - IndexedDB persistence

**ChunkDataManager** (src/core/terrain/ChunkDataManager.ts):
- Single source of truth for all chunk data
- LRU cache (maxSize=150) with dirty chunk protection
- Event system (chunk-ready, chunk-updated, chunk-remove, chunk-dirty)
- Dirty tracking for player-modified chunks (digging, flora pickup, tree removal)
- Debounced persistence to WorldDB (2s delay)

### Material System

TriplanarMaterial uses custom shaders with:
- Sharp triplanar blending (power 8) across 16 materials
- Material weight channels (matWeightsA-D, 4 materials each)
- Shared uniforms updated once per frame in VoxelTerrain.tsx

## Critical Constants (src/constants.ts)

```
CHUNK_SIZE_XZ = 32, CHUNK_SIZE_Y = 128, PAD = 2
ISO_LEVEL = 0.5 (density threshold)
RENDER_DISTANCE = 3 (49 chunks max)
WATER_LEVEL = 4.5
```

Changing these breaks mesher output dimensions and worker communication.

## Debug Flags

- `?debug` - Enable Leva debug panels (sun, shadows, fog controls)
- `?mode=map` - Biome/map debug view
- `?normals` - Normal material for geometry inspection
- `?profile` or `localStorage.vcProfiler = "1"` - Enable FrameProfiler with spike detection
- `?nocolliders` - Disable all terrain colliders (physics debugging)
- `?nosim` - Disable simulation worker (performance isolation)
- `?nominimap` - Disable minimap rendering (performance isolation)
- `localStorage.vcDebugPlacement = "1"` - Vegetation placement debug
- `window.__chunkDataManager.getStats()` - View chunk cache stats (total, dirty, pending persistence, memory MB)

## Key Invariants

See `AGENTS.md` for the complete list. Most critical:

1. **Chunk data ownership**: ChunkDataManager is the single source of truth. Always use `chunkDataManager.getChunk(key)` to access chunk data. Never mutate chunk data directly - use `markDirty()` or `modifyTerrain()`.
2. **Collider throttling**: Trimesh creation causes 10-30ms stalls. Always use `colliderEnableQueue`.
3. **CustomShaderMaterial**: Use `three-custom-shader-material/vanilla` for class usage. Never redeclare `vNormal` or `vViewDir`.
4. **Material channels**: Mesher outputs matWeightsA-D bound in ChunkMesh.tsx. Shader expects this structure.
5. **Held item poses**: Never edit HeldItemPoses.ts directly - use in-game pose tooling.
6. **Point light caps**: MAX_LIGHTS_PER_CHUNK = 8 to avoid React overhead.

## Common Pitfalls

- `Array(n).fill(obj)` creates shared references - use `Array.from({length:n}, () => new Obj())`
- React StrictMode mounts effects twice - store timeout IDs in refs
- If `ShaderMaterial` has `fog=true`, must provide fogColor/fogNear/fogFar uniforms
- Ground items need original stride-8 data for interaction, not just optimized render buffers
- **React state batching**: Multiple `setState` calls per frame cause multiple reconciliations. Use batched update queues flushed once per frame (see `VoxelTerrain.tsx` `flushVersionUpdates`)
- **Version adds vs increments**: When adding new chunks to `chunkVersions`, use `queueVersionAdd` (sets value). `queueVersionIncrement` only works on existing entries

## Testing

Tests focus on math kernels (mesher, noise) and state logic. Located in `src/tests/`.

```bash
npm run test:unit    # Run all tests
```

## Detailed Engineering Guidance

See `AGENTS.md` for:
- Complete list of known pitfalls with code pointers
- Debug workflows and verification checklists
- Performance optimization details
- Worklog of recent changes
