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
    → Generate voxel light grid (8×32×8 cells, sky + point lights)
    → Surface Nets meshing produces smooth geometry with baked GI
    → Trimesh colliders created (throttled via colliderEnableQueue)
    → ChunkMesh mounted with TriplanarMaterial
    → Player modifications tracked as dirty in ChunkDataManager
    → Dirty chunks persisted to IndexedDB (debounced 2s)
```

### Key Directories

- `src/core/` - Shared engine: materials, shaders, worker pools, math utilities, lighting
  - `items/ItemGeometry.ts` - Single source of truth for all item visuals, geometry, colors
- `src/features/terrain/` - Chunk generation, meshing, streaming
  - `components/VoxelTerrain.tsx` - Chunk streaming and rendering orchestration
  - `hooks/useTerrainInteraction.ts` - Dig, build, chop, smash interaction logic
  - `logic/mesher.ts`, `raycastUtils.ts` - Meshing and raycast utilities
- `src/features/flora/` - Trees, vegetation, particle systems
- `src/features/player/` - Movement, input, camera
- `src/features/interaction/` - Tools, digging, building, inventory
- `src/features/environment/` - Atmosphere, post-processing, lighting
- `src/state/` - Zustand stores (Settings, Inventory, World, Entity tracking)
- `src/tests/` - Vitest unit tests (mesher, terrain, stores)

### Worker Architecture

Workers handle expensive operations via `WorkerPool` (src/core/workers/WorkerPool.ts):
- `terrain.worker.ts` - Chunk generation, light grid, meshing
- `simulation.worker.ts` - Flora updates
- `fractal.worker.ts` - Tree geometry generation

Message format: `{ type: string, payload: {...} }`. Use transferables for Float32Arrays.

### Lighting System

**Voxel-based Global Illumination** (src/core/lighting/lightPropagation.ts):
- Low-res 3D light grid (8×32×8 cells, LIGHT_CELL_SIZE=4 voxels per cell)
- Sky light traces down from above, attenuates through solid voxels
- Point lights (torches, Lumina) seed grid with colored light
- 6-iteration flood-fill propagation spreads light through space
- Per-vertex light colors baked into mesh (aLightColor attribute)
- Zero runtime cost - light is fully baked during meshing

Ambient light reduced to minimal levels (surface: 0.08, cave: 0.04). GI provides all indirect lighting.

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
- Per-vertex GI light (aLightColor attribute) from voxel light grid
- Shared uniforms updated once per frame in VoxelTerrain.tsx

### Item System

**ItemGeometry.ts** (src/core/items/ItemGeometry.ts) is the single source of truth for all item visuals:
- Unified color palette matching terrain materials for world coherence
- Geometry factories: createStickGeometry(), createStoneGeometry(), createShardGeometry(), createLargeRockGeometry(), createLashingGeometry()
- Material variant system (obsidian, basalt, sandstone, clay stones; flint, volcanic shards)
- Geometry caching for performance (geometries created once and reused)
- Used by: UniversalTool (held/crafting), GroundItemsLayer (terrain clutter), PhysicsItem (thrown), ItemThumbnail (inventory)

Shard geometry is a stretched octahedron (not cone) for blade-like appearance. Lashing geometry uses helix curves for realistic tool bindings.

### Item Shader System

**GroundItemShaders.ts** (src/core/graphics/GroundItemShaders.ts) is the single source of truth for all item shaders:

| Shader | Purpose | Key Effects |
|--------|---------|-------------|
| `STICK_SHADER` | Wood/bark materials | Wood grain, bark ridges, knots, weathering, micro fibers |
| `ROCK_SHADER` | Stone materials | Mineral crystals, mica shimmer, veins, iron staining, moss |
| `SHARD_SHADER` | Obsidian/flint shards | Conchoidal fractures, iridescence, flow banding, edge highlights |
| `FLORA_SHADER` | Bioluminescent flora | Cell structure, pulsing veins, subsurface scattering, breathing animation |
| `TORCH_SHADER` | Torch handle wood | Wood grain with charring gradient toward flame end |

Each shader has both `vertex` and `fragment` properties. **When modifying item visuals, update the shader in GroundItemShaders.ts** - all consumers will inherit the change.

**Consumers of GroundItemShaders** (update ALL when changing shaders):
- `UniversalTool.tsx` - Held items, crafting preview (StickMesh, StoneMesh, ShardMesh, FloraMesh, Torch)
- `GroundItemsLayer.tsx` - Terrain clutter (instanced rendering with `uInstancing: true`)
- `PhysicsItem.tsx` - Thrown items (uses UniversalTool internally)
- `LuminaFlora.tsx` - World flora (has its own pooled material, may need sync with FLORA_SHADER)

**Uniform requirements by shader**:
- All shaders: `uSeed`, `uNoiseTexture`, `uColor`
- STICK: `uInstancing`, `uHeight`
- ROCK/SHARD: `uInstancing`, `uDisplacementStrength`
- FLORA: `uTime` (animated)
- Instanced rendering adds: `aInstancePos`, `aInstanceNormal`, `aSeed` attributes

## Critical Constants (src/constants.ts)

```
CHUNK_SIZE_XZ = 32, CHUNK_SIZE_Y = 128, PAD = 2
ISO_LEVEL = 0.5 (density threshold)
RENDER_DISTANCE = 3 (49 chunks max)
WATER_LEVEL = 4.5

Light Grid (GI):
LIGHT_CELL_SIZE = 4 (each cell = 4×4×4 voxels)
LIGHT_GRID_SIZE_XZ = 8, LIGHT_GRID_SIZE_Y = 32 (2048 cells/chunk)
LIGHT_PROPAGATION_ITERATIONS = 6
LIGHT_FALLOFF = 0.82, SKY_LIGHT_ATTENUATION = 0.7
```

Changing these breaks mesher output dimensions and worker communication. Light grid dimensions must divide evenly into chunk size.

## Debug Flags

- `?debug` - Enable Leva debug panels (sun, shadows, fog controls, GI toggle)
- `?mode=map` - Biome/map debug view
- `?normals` - Normal material for geometry inspection
- `?profile` or `localStorage.vcProfiler = "1"` - Enable FrameProfiler with spike detection
- `?nocolliders` - Disable all terrain colliders (physics debugging)
- `?nosim` - Disable simulation worker (performance isolation)
- `?nominimap` - Disable minimap rendering (performance isolation)
- `localStorage.vcDebugPlacement = "1"` - Vegetation placement debug
- `window.__chunkDataManager.getStats()` - View chunk cache stats (total, dirty, pending persistence, memory MB)

**GI Tuning**: uGIEnabled (0/1 toggle), uGIIntensity (multiplier, default 1.2) accessible via debug panel.

## Key Invariants

See `AGENTS.md` for the complete list. Most critical:

1. **Chunk data ownership**: ChunkDataManager is the single source of truth. Always use `chunkDataManager.getChunk(key)` to access chunk data. Never mutate chunk data directly - use `markDirty()` or `modifyTerrain()`.
2. **Collider throttling**: Trimesh creation causes 10-30ms stalls. Always use `colliderEnableQueue`.
3. **CustomShaderMaterial**: Use `three-custom-shader-material/vanilla` for class usage. Never redeclare `vNormal` or `vViewDir`.
4. **Material channels**: Mesher outputs matWeightsA-D bound in ChunkMesh.tsx. Shader expects this structure.
5. **Held item poses**: Never edit HeldItemPoses.ts directly - use in-game pose tooling.
6. **Point light caps**: MAX_LIGHTS_PER_CHUNK = 8 to avoid React overhead.
7. **Light grid order**: Light grid generated BEFORE meshing in terrain.worker.ts. Mesher samples grid to bake per-vertex colors.
8. **Item visual consistency**: ItemGeometry.ts is the single source of truth for all item geometry, colors, and materials. Never define item visuals elsewhere.
9. **Item shader consistency**: GroundItemShaders.ts defines all item shaders (STICK, ROCK, SHARD, FLORA, TORCH). When adding visual detail to items, update the shader here - never copy shader code to individual components. All consumers (UniversalTool, GroundItemsLayer, LuminaFlora) must use both `vertex` AND `fragment` properties.

## Logging Best Practices

**Profile-only logging**: Console logs can cause significant performance overhead, especially in hot paths. Gate all timing/debug logs behind `?profile` URL param:

```typescript
// In React components - use shouldProfile()
const shouldProfile = () => typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('profile');

if (shouldProfile()) {
  console.log(`[Component] Operation took ${duration.toFixed(1)}ms`);
}

// In workers - check profileMode flag (set via CONFIGURE message)
let profileMode = false;
const profile = (label: string, fn: () => void) => {
  if (!profileMode) { fn(); return; }
  const start = performance.now();
  fn();
  const duration = performance.now() - start;
  if (duration > 1) console.log(`[worker] ${label}: ${duration.toFixed(1)}ms`);
};
```

**Never add console.log calls** that run every frame or on every chunk. Use `?profile` for performance debugging.

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

## Subagent Usage Guide

Claude Code has access to specialized subagents for different tasks. **Use these proactively** - they reduce context usage and provide better results for their specialized domains.

### Available Subagents

| Agent | When to Use | Example Triggers |
|-------|-------------|------------------|
| **Explore** | Codebase exploration, finding files, understanding architecture | "Where is X handled?", "How does Y work?", "Find all files that..." |
| **Plan** | Designing implementation strategies for new features or refactors | "Add crafting system", "Refactor terrain pipeline", multi-file changes |
| **root-cause-analyst** | Debugging errors, stack traces, unexpected behavior | Error messages, "X is broken", "doesn't work", crashes |
| **docs-sync** | Updating CLAUDE.md/AGENTS.md after completing changes | After refactors, new features, architecture changes |
| **claude-code-guide** | Questions about Claude Code itself, hooks, MCP servers | "Can Claude do...", "How do I configure..." |

### When to Use Each Agent

**Explore Agent** - Use for ANY open-ended codebase questions:
```
❌ Direct Glob/Grep for "where are errors handled?"
✅ Task(Explore): "Find where client errors are handled and explain the error handling pattern"
```

**Plan Agent** - Use BEFORE implementing non-trivial features:
```
❌ Start coding a new feature immediately
✅ Task(Plan): "Design implementation for player crafting system with inventory integration"
```

**Root Cause Analyst** - Use when user reports issues:
```
❌ Immediately try to fix based on error message
✅ Task(root-cause-analyst): "Investigate why terrain chunks aren't loading - user reports [error]"
```

**Docs Sync** - Use AFTER completing significant changes:
```
❌ Forget to update documentation
✅ Task(docs-sync): "Update CLAUDE.md and AGENTS.md after GI lighting system implementation"
```

### Agent Usage Rules

1. **Prefer agents over direct tool calls** for complex searches - they explore more thoroughly
2. **Launch agents in parallel** when investigating multiple independent questions
3. **Always summarize agent results** back to the user - agent output is not visible to them
4. **Resume agents** using their ID for follow-up work in the same domain
5. **Use appropriate thoroughness** for Explore: "quick" for simple lookups, "very thorough" for architecture questions

6. **Shader debugger** - GLSL-specific debugging and optimization

### Missing Agents (Request These)

If you find yourself repeatedly doing similar complex tasks, consider requesting these specialized agents:
- **Performance profiler** - Systematic performance investigation
- **Test writer** - Generate tests for new functionality

- **Worker debugger** - Web Worker message flow analysis

## Detailed Engineering Guidance

See `AGENTS.md` for:
- Complete list of known pitfalls with code pointers
- Debug workflows and verification checklists
- Performance optimization details
- Worklog of recent changes
- If you notice important refactoring opportunities while doing other changes, make a note of them here for the future.

## Refactoring Opportunities

### Crafting System Enhancements (Identified 2026-01-04)

1. ~~**Ground Item Shader Consistency**~~: RESOLVED (2026-01-05) - All item shaders now centralized in `GroundItemShaders.ts` with both vertex and fragment shaders. UniversalTool, GroundItemsLayer, and all rendering contexts use the same shaders.

2. **Material Variant Persistence**: `StoneMesh` and `ShardMesh` now accept `variant` and `seed` props for material variety (obsidian, basalt, sandstone, clay), but item instances don't store this data. To make harvested items retain their biome-specific appearance:
   - Extend `ItemType` or create item metadata in `InventoryStore`
   - Store variant/seed when item is picked up
   - Pass stored values to mesh components

3. **GI Light Query System**: Tools currently use standard Three.js lighting. To integrate with the voxel GI system:
   - Expose `lightGrid` data from `ChunkDataManager` at runtime
   - Create a `sampleLightAtPosition(worldPos)` utility
   - Pass sampled light color to tool shaders
   - This would make tools respond to cave/surface lighting like terrain does

4. **Recipe System Formalization**: Recipes in `CraftingData.ts` are defined but loosely enforced. Consider:
   - Adding a `validateRecipe(attachments)` function
   - Showing recipe hints before all ingredients are attached
   - Supporting partial recipe matching for guidance

## Known Bugs

### FractalTree Not Growing (Identified 2026-01-05)
**Status**: Active bug - FractalTree component does not visually grow when RootHollow transitions to GROWING state.
**Location**: `src/features/flora/components/FractalTree.tsx`, `src/features/flora/components/RootHollow.tsx`
**Symptoms**: RootHollow absorbs flora item, swarm particles appear, but tree never becomes visible.
**Investigation needed**: Check if worker is generating geometry, verify `active`/`visible` props are triggering correctly.

### Root Hollow / FractalTree Persistence (Identified 2026-01-05)
**Status**: Needs investigation - Root Hollows and grown FractalTrees may not persist correctly to IndexedDB.
**Location**: `src/state/WorldDB.ts`, `src/features/flora/components/RootHollow.tsx`
**Investigation needed**:
- Verify Root Hollow positions are saved/loaded with chunk data
- Verify FractalTree growth state persists across chunk unload/reload
- Check if ChunkDataManager dirty tracking includes flora state changes

## Future Features (TODO)

### Sacred Grove Ecosystem (Planned)
Root Hollows are terraforming seeds that transform the landscape:
1. **Barren Zone**: Area around dormant Root Hollow is desert-like (RED_DESERT material)
2. **Tree Growth**: When FractalTree grows, it begins spreading life (NOT YET IMPLEMENTED)
3. **Humidity Spreading**: Gradual biome transformation from barren to lush (NOT YET IMPLEMENTED)
4. **Vegetation Spawning**: Trees and flora spawn in transformed areas (NOT YET IMPLEMENTED) 
