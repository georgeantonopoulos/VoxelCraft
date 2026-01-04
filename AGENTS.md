## VoxelCraft — Agent Guide (curated)

This file exists to prevent repeat bugs and speed up safe changes. It should stay **small, stable, and actionable** (not a daily changelog).

> If you need older long-form “what happened” notes, use `git log -p -- AGENTS.md` to find the previous versions.

### How agents should update this file

1. Only add/remove content here if it is one of:
   - A **hard invariant** (breaking it causes bugs/regressions).
   - A **recurring pitfall** (has caused bugs at least once).
   - A **debug/verification workflow** that is consistently useful.
2. Keep each new note **short** (aim: <10 lines) and include a **code pointer** (file path + symbol/keyword).
3. Put long investigations in `docs/agent-worklog/YYYY-MM-DD.md` (create it if missing). Link it from here only if it contains reusable guidance.
4. If you do a **visual inspection**:
   - Wait **10 seconds** after entering the world (streaming settles).
   - Use the in-game controls to capture **4 screenshots** from different angles/states.
   - Add a **1–3 line** summary under “Worklog (short)” (include what changed and what you verified).
5. Back-check any new “facts” against the codebase before writing them here.
6. If something here is important and missing, add it.
7. If something here is wrong, fix it.
8. If something here is outdated, update it.
9. If something here is unclear, clarify it.

### Non-negotiables

- **Do not remove code comments**. Add clarifying comments when missing.
- **Do not force GLSL versions** (avoid adding `#version ...` unless you fully understand the shader pipeline impact).
- Always run **both** `npm run build` and a quick `npm run dev` smoke-start before finishing work.
- Always run vite tests, check Testing Strategy section
- **Comments**: DO NOT remove code comments. Add clarifying comments when missing.
---

## Quick Project Facts (verified)

- **Stack**: Vite + React + TypeScript + `three` + `@react-three/fiber` + `@react-three/rapier` (`package.json`).
- **CSS**: Tailwind is wired via PostCSS import in `src/index.css` (`@import "tailwindcss";`). `index.html` does not load Tailwind via CDN.
- **Entry**: `src/index.tsx` mounts `src/App.tsx`.
- **Dev server**: `vite.config.ts` sets `server.port = 3000` and adds COOP/COEP headers for `SharedArrayBuffer`.


## Repo Map (high-signal)

- `src/core/`: Common engine utilities, math, materials, and generic worker pools (e.g. `TriplanarMaterial.tsx`, `WorkerPool.ts`).
- `src/features/terrain/`: Voxel generation, meshing, and chunk streaming logic.
  - `components/VoxelTerrain.tsx` - Chunk streaming orchestration (1792 lines, down from 2701).
  - `hooks/useTerrainInteraction.ts` - Terrain interaction hook (dig/build/chop/smash, particles, audio).
  - `logic/mesher.ts`, `raycastUtils.ts` - Meshing and raycast utilities.
- `src/features/environment/`: Dynamic atmosphere, sky, cinematic post-processing, and performance monitoring.
- `src/features/player/`: Player movement, input handling, and first/third-person camera logic.
- `src/features/interaction/`: First-person tools, inventory logic, and real-time voxel modification.
- `src/features/flora/`: Generative vegetation, trees, and particle swarms.
- `src/state/`: Global Zustand stores for settings, inventory, world state, and environment.
- `src/ui/`: React-based HUD, settings menu, startup screens, and debug overlays.

#### Terrain System
- **Generation**: `TerrainService.generateChunk` uses 3D Simplex noise (`src/core/math/noise.ts`) to create a density field.
  - **Density > ISO_LEVEL (0.5)** = Solid.
  - **Materials**: Determined by height, slope, and noise (Bedrock, Stone, Dirt, Grass, etc.).
  - **Caverns**: Stateless "Noodle" Algorithm using domain-warped 3D ridged noise (`abs(noise) < threshold`) in `TerrainService.ts`. Configured per-biome via `BiomeManager.ts`.
- **Lighting**: `src/core/lighting/lightPropagation.ts` generates a voxel-based GI light grid (8×32×8 cells per chunk).
  - **Light Grid**: Low-resolution 3D grid (LIGHT_CELL_SIZE=4, each cell = 4×4×4 voxels).
  - **Sky Light**: Traces down from above, attenuates through solid voxels (SKY_LIGHT_ATTENUATION=0.7).
  - **Point Lights**: Torches and Lumina flora seed the grid with colored light (inverse-square falloff).
  - **Propagation**: 6-iteration flood-fill spreads light through 6-connected neighbors (LIGHT_FALLOFF=0.82).
  - **Critical Order**: Light grid MUST be generated before meshing (worker calls `generateLightGrid()` then `generateMesh()`).
- **Meshing**: `src/features/terrain/logic/mesher.ts` implements a Surface Nets-style algorithm (Dual Contouring variant) to generate smooth meshes from density data.
  - **Seam Fix**: Optimized loop logic explicitly handles boundary faces (X/Y/Z) with correct limits (`endX`, `endY`) to prevent disappearing textures at chunk edges.
  - **GI Baking**: Mesher samples the light grid to compute per-vertex RGB light colors (aLightColor attribute). Trilinear interpolation from 8 surrounding light cells.
  - **Physics**: Uses the full-resolution visual mesh for `trimesh` collision in Rapier. Throttled mounting (`mountQueue`) and worker-based generation are used to prevent main-thread spikes instead of mesh simplification.
- **Materials**: `TriplanarMaterial` uses custom shaders with sharp triplanar blending (pow 8) and projected noise sampling to avoid muddy transitions.
  - **Shader Stability**: Implements `safeNormalize` to prevent NaNs on degenerate geometry (e.g., sharp concave features from digging) which prevents flashing artifacts.
  - **Modular Shaders**: Shader code is extracted into `src/core/graphics/TriplanarShader.ts` for better maintainability.
  - **GI Integration**: Fragment shader reads `vLightColor` (interpolated from vertices) and applies it as ambient/indirect lighting. Replaces flat ambient light (now reduced to 0.08 surface / 0.04 cave).

## Testing Strategy
- **Headless Tests**: Run via `npm test` (Vitest).
- **Location**: All unit/kernel tests live in `src/tests/` (centralized).
- **Scope**: Focus on mathematical kernels (mesher, noise, data structures) and logic (digging, inventory).
- **Avoid**: Testing UI/React components heavily; prefer visual verification for those.
- **Key Files**: `src/tests/terrainService.test.ts`, `src/tests/mesher.test.ts`.

---

## Terrain: Hard Invariants (verified)

- Chunk sizing/padding lives in `src/constants.ts`:
  - `CHUNK_SIZE_XZ = 32`, `CHUNK_SIZE_Y = 128`, `PAD = 2`, `ISO_LEVEL = 0.5`.
  - `TOTAL_SIZE_XZ = CHUNK_SIZE_XZ + PAD * 2`, `TOTAL_SIZE_Y = CHUNK_SIZE_Y + PAD * 2`.
- The terrain mesh uses fixed "material weight channels":
  - Mesher output: `src/features/terrain/logic/mesher.ts` produces `matWeightsA`–`D`.
  - Render binding: `src/features/terrain/components/ChunkMesh.tsx` maps them to geometry attrs `aMatWeightsA`–`D`.

## Chunk Data Management (ChunkDataManager)

**Single source of truth** for all chunk data (`src/core/terrain/ChunkDataManager.ts`):
- **LRU Cache**: Keeps ~150 chunks in memory (3x render distance squared). Clean chunks can be evicted and regenerated.
- **Dirty Tracking**: Player-modified chunks (digging, flora pickup, tree removal) are marked dirty and NEVER evicted until persisted.
- **Event System**: Emits `chunk-ready`, `chunk-updated`, `chunk-remove`, `chunk-dirty` for view layer synchronization.
- **Persistence**: Debounced (2s) bulk persistence to WorldDB. `visibilitychange`/`beforeunload` handlers ensure dirty chunks are saved.
- **API**:
  - `getChunk(key)`: Retrieve chunk (updates LRU). Returns undefined if not in cache.
  - `addChunk(key, chunk)`: Add/update chunk. Triggers eviction if over capacity.
  - `markDirty(key, voxelIndices?)`: Mark chunk dirty (prevents eviction, queues persistence).
  - `modifyTerrain(key, modifications)`: Apply voxel changes and auto-mark dirty.
  - `hideChunk(key)`: Signal chunk no longer visible (persists if dirty).
- **Critical Rule**: NEVER directly mutate `chunk.density` or `chunk.material`. Always use `chunkDataManager.markDirty()` or `modifyTerrain()`.
- **Debug Access**: `window.__chunkDataManager.getStats()` returns `{ totalChunks, dirtyChunks, pendingPersistence, memoryEstimateMB }`.

## Workers & Messages (verified)

- Terrain generation/remesh runs via `src/features/terrain/workers/terrain.worker.ts`, managed by a **WorkerPool** (`src/core/utils/WorkerPool.ts`) in `src/features/terrain/components/VoxelTerrain.tsx`.
- Worker message convention is `{ type, payload }` (see `terrain.worker.ts`, `simulation.worker.ts`).
- Performance: Transfers large Float32Arrays to avoid main-thread serialization overhead.
- Simulation runs via `src/features/flora/workers/simulation.worker.ts` managed by `src/features/flora/logic/SimulationManager.ts` and posts `type: 'CHUNKS_UPDATED'`.

## Interaction & State (verified)

- Terrain targeting relies on `userData.type === 'terrain'` (`ChunkMesh.tsx`).
- **Global Settings**: `src/state/SettingsStore.ts` is the source of truth for graphics (resolution, shadows) and input mode (mouse vs touch). `App.tsx` subscribes to this.
- **Input Logic**: `src/features/player/usePlayerInput.ts` abstracts input sources (`useKeyboardControls` vs `InputStore`).
- **Touch Camera**: `src/features/player/TouchCameraControls.tsx` handles look rotation for touch mode, bypassing `PointerLockControls`.
- **Fire Mechanics**: `InteractionHandler.tsx` manages Raycast detection for Stone-on-Stone (sparks) and Stick-on-Fire (torch) events.
- **Fog & Atmosphere**: `AtmosphereManager.tsx` and `TriplanarShader.ts` handle fog.
  - **Three.js Fog**: Standard `THREE.Fog` attached to `scene.fog`. Color follows sky gradient.
  - **Shader Fog**: Custom exponential squared fog in terrain shader (`uShaderFogStrength`, `uFogNear`, `uFogFar`).
  - **Height Fog**: Ground-level fog layer controlled by `uHeightFogStrength`, `uHeightFogRange`, and `uHeightFogOffset`.
  - **Scaling**: Fog far distance is dynamically scaled by `viewDistance` setting.

## Known Pitfalls (keep this list small)

- **Shared references from `Array(n).fill(obj)`**: Use `Array.from({ length: n }, () => new Obj())` for per-particle/per-instance objects (common particle bug class).
- **React StrictMode timer bugs**: Effects can mount/unmount twice in dev; store timeout IDs in refs and clear them before setting new ones (see `src/features/flora/components/RootHollow.tsx`).
- **InstancedMesh scaling can “shrink your shader space”**: If instance matrices scale, shader-driven offsets may also scale; size particles via geometry radius when offsets must stay in world units (see `src/features/flora/components/LumaSwarm.tsx`).
- **Three.js fog uniform crash**: If a `ShaderMaterial` has `fog=true` but lacks `fogColor/fogNear/fogFar`, Three may throw during `refreshFogUniforms()` (see `src/features/creatures/FogDeer.tsx`).
- **Never edit held-item pose constants**: Do not touch `src/features/interaction/logic/HeldItemPoses.ts` (`RIGHT_HAND_HELD_ITEM_POSES`); these are hand-tuned and must only change via the in-game pose tooling (`src/features/interaction/components/FirstPersonTools.tsx` keyword: `/__vc/held-item-poses`). If a merge conflict hits this file, resolve by taking `main`.
- **Main-thread chunk arrival spikes**: Avoid expensive `useMemo` computation when chunks stream in; prefer precomputing in workers (shoreline mask / **simplified colliders**).
- **Terrain streaming “loaded” state can stall**: If chunk updates are wrapped in `startTransition`, UI state may lag; gate initial-load readiness off `chunksRef.current` in `src/features/terrain/components/VoxelTerrain.tsx` (keyword: `initialLoadTriggered`).
- **Input Mode Misidentification**: Laptops with touchscreens can default to `touch` mode, disabling `PointerLockControls`. Default is now `mouse` unless mobile UA is detected (`src/state/SettingsStore.ts`).
- **Pointer Lock Quitting**: Unlocking the pointer (ESC) should not quit the game; `handleUnlock` in `App.tsx` is now non-destructive.
- **Terrain backface Z-fighting**: Terrain uses `side={THREE.FrontSide}` in `src/core/graphics/TriplanarMaterial.tsx` (validate artifacts before changing).
- **Celestial orbit desync**: Use shared helpers in `src/core/graphics/celestial.ts` (`calculateOrbitAngle`, `getOrbitOffset`) for Sun/Moon/Sky/IBL; do not duplicate orbit math inside components (previously caused mismatched sky/fog vs lighting).
- **LOD Pop Regression**: `lodLevel` is derived from a continuous, quantized chunk-boundary distance. Reverting to integer Chebyshev distance will reintroduce visible popping (see `src/features/terrain/components/VoxelTerrain.tsx` `getChunkLodDistance`).
- **CustomShaderMaterial Imports**: In version 6.x+, the default import `import CSM from 'three-custom-shader-material'` is the **React component**. If you need to use it as a class/constructor (e.g. for material pooling or singleton materials), you MUST use `import CSM from 'three-custom-shader-material/vanilla'`. Mixing these up causes `CustomShaderMaterial is not a constructor` runtime errors.
- **CustomShaderMaterial redefinition errors**: When using `three-custom-shader-material` (CSM) with `MeshStandardMaterial`, do NOT declare `varying vec3 vNormal` or `varying vec3 vViewDir`. These are already defined by Three.js and will cause a `redefinition` error during merging. Use `csm_Normal` to set normals in the vertex shader; Three.js handles the fragment-side varying internally.
- **Responsive Item Offsets**: In portrait mode (aspect < 1), held items (torches, tools) must have their X-offsets scaled dynamically using `aspect` to prevent them from disappearing off the sides of the screen (see `FirstPersonTools.tsx` keywords: `responsiveX`).
- **Interaction Data vs Optimized Visuals**: Ground items (sticks, rocks) use optimized bucketted buffers for rendering (`drySticks`, `rockDataBuckets`), but the interaction logic (`rayHitsGeneratedGroundPickup`) still requires the original stride-8 data (`stickPositions`, `rockPositions`). If these are missing from the worker's `GENERATED` payload, items will be visible but impossible to pick up (see `VoxelTerrain.tsx`).
- **Instanced Geometry Disposal**: Do not call `geometry.dispose()` in an effect cleanup that depends on the *data* (e.g. `batch.positions`). This will destroy the geometry every time an item is picked up. Only dispose when the geometry object itself changes or on unmount (see `GroundItemsLayer.tsx`).
- **Interaction Logic Invariant**: All interaction must have logic. Every hit on an entity (stone, tree, etc.) MUST calculate damage based on tool properties (shards for sharpness, stones for smashiness) and entity properties (radius, material). Entities have explicit "life" (health) tracked in `EntityHistoryStore.ts`.
- **Trimesh Collider Creation is Expensive**: Rapier's `trimesh` colliders require building a BVH acceleration structure on the main thread. When `colliderEnabled` flips to `true`, the `<RigidBody colliders="trimesh">` creation can cause a 10-30ms stall depending on mesh complexity. The current throttled queue (`colliderEnableQueue` in `VoxelTerrain.tsx`) spreads this out, but doesn't eliminate the synchronous creation. Future optimization: use `requestIdleCallback` or pre-build colliders in a worker (if Rapier supports it).
- **Instance Matrix Calculations in Render Effects**: `TreeLayer.tsx` and `VegetationLayer.tsx` compute instance matrices in `useLayoutEffect` loops. For dense chunks (jungle trees, 100+ instances), this can block the main thread for 2-5ms. Consider pre-computing matrices in the terrain worker and passing them in the `GENERATED` payload.
- **Lumina Stride Mismatch**: `floraPositions` has stride 4 (x,y,z,type). Using stride 3 for extraction (e.g. for light positions in `LuminaLayer.tsx`) causes coordinate shifting and invisible/misplaced lights.
- **Point Light React Overhead**: Spawning hundreds of `PointLight` components (even if culled) kills React/R3F performance due to thousands of `useFrame` handlers and reconciliation checks. ALWAYS cap point lights per chunk (e.g. `MAX_LIGHTS_PER_CHUNK = 8`). Avoid using `useState` inside `useFrame` to toggle these lights; use imperative `visible` control via refs to bypass React's reconciler (see `LuminaLayer.tsx`).
- **Chunk Bounding Spheres and Frustum Culling**: If chunks disappear when viewed at grazing angles, verify `geometry.boundingSphere`. It must be centered at the chunk's visual center (e.g. `[16, 64, 16]`) and have a radius spanning the full volume. Misalignment (e.g. due to `PAD` offsets) will cause Three.js to cull the chunk prematurely. (Fixed in `ChunkMesh.tsx`).
- **Chunk Cache Restoration**: For items/trees to persist on revisit, ALL entity data (flora, trees, sticks, rocks, hotspots, and processed buckets/batches) MUST be saved to and correctly restored from `CachedChunk` in `terrain.worker.ts`.
- **HeightfieldCollider Pattern**: For heightfield colliders to work correctly: (1) Use `colliders={false}` on RigidBody to disable auto-generation, (2) Add `<HeightfieldCollider>` as a child with `args=[nRows, nCols, heights, scale]`, (3) Heights must be in column-major order (`heights[z + x * numSamplesZ]`), (4) Scale defines TOTAL size (`{x: 32, y: 1, z: 32}`), (5) Position at center of chunk (`[16, 0, 16]`). For cave chunks, use `colliders="trimesh"` which auto-generates from the first child mesh.
- **React Reconciliation Batching**: Multiple `setChunkVersions` calls per frame (e.g., from worker messages, LOD updates, chunk mounts) trigger multiple React reconciliation passes (60-90ms spikes). Solution: Queue updates in refs (`pendingVersionAdds`, `pendingVersionUpdates`, `pendingVersionRemovals`) and flush once at end of `useFrame` via `flushVersionUpdates()`. Use `startTransition` for post-initial-load flushes. See `VoxelTerrain.tsx` keyword: `BATCHED VERSION UPDATES`.
- **Version Add vs Increment Distinction**: `queueVersionAdd(key)` adds new chunks with version 1. `queueVersionIncrement(key)` increments existing entries. Using increment for new chunks does nothing (the `if (next[k] !== undefined)` guard fails). During initial load, new chunks MUST use `queueVersionAdd`, not `queueVersionIncrement`.
- **Initial Load vs Post-Load Code Paths**: `initialLoadTriggered.current` gates two different streaming behaviors. During initial load (`false`): chunks go directly to version state for immediate rendering. After initial load (`true`): chunks go through `mountQueue` for throttled addition. Mixing these paths causes spawn chunk to not appear.
- **Light Grid Dimensions**: `LIGHT_CELL_SIZE` MUST divide evenly into both `CHUNK_SIZE_XZ` and `CHUNK_SIZE_Y`. Current: 4 divides into 32 and 128 cleanly (8×32×8 grid). Changing to non-divisible values causes index out-of-bounds in `getCellOcclusion()` and mesher light sampling. See `src/core/lighting/lightPropagation.ts` and `src/constants.ts`.

---

## Testing Strategy (verified)

- **Headless Tests**: Run via `npm test` (Vitest).
- **Location**: All unit/kernel tests live in `src/tests/` (centralized).
- **Scope**: Focus on mathematical kernels (mesher, noise, data structures) and logic (digging, inventory).
- **Avoid**: Testing UI/React components heavily; prefer visual verification for those.
- **Key Files**: `src/tests/terrainService.test.ts`, `src/tests/mesher.test.ts`.
- If implementing significant new feature, add a new test. 

---

## Debug Switches (verified)

- `?debug`: enables debug UI paths (Leva/HUD/placement debug) (`src/App.tsx`, `src/ui/HUD.tsx`, `src/state/InventoryStore.ts`). Now includes **Granular Sun Controls**:
  - **Properties**: `sunIntensity`, `radius` (orbit size), `speed` (day/night duration), `timeOffset` (manual time scrubbing).
  - **Shadows**: `shadowsEnabled`, `bias`, `normalBias`, `mapSize`, `camSize` (frustum).
- **Export Config**: Use the **"Copy Config"** button in `Tools` folder to export all current settings to JSON (clipboard).
- `?mode=map`: shows the biome/map debug view (`src/App.tsx` -> `src/ui/MapDebug.tsx`).
- `?normals`: swaps terrain material to normal material for geometry inspection (`src/features/terrain/components/ChunkMesh.tsx`).
- `?vcDeerNear`, `?vcDeerStatic`: FogDeer spawn helpers (`src/features/creatures/FogDeer.tsx`).
- Placement tracing can also be enabled via `localStorage.vcDebugPlacement = "1"` or `window.__vcDebugPlacement = true` (`src/features/flora/components/FloraPlacer.tsx`).
- Streaming logs (opt-in): `?debug&vcStreamDebug` prints chunk drop/apply notes while tuning streaming (`src/features/terrain/components/VoxelTerrain.tsx` keyword: `vcStreamDebug`).
- **Performance Isolation Flags** (use to identify bottlenecks):
  - `?profile` or `localStorage.vcProfiler = "1"`: Enables `FrameProfiler` with auto-logging every 5s and spike detection (>50ms frames). Access via `window.frameProfiler.log()`.
  - `?nocolliders`: Disables all terrain colliders (isolates Rapier BVH construction).
  - `?nosim`: Disables `SimulationManager` worker (isolates wetness/mossiness updates).
  - `?nominimap`: Disables HUD minimap (isolates `BiomeManager.getBiomeAt` calls).

- **Physics Object Budget**: Avoid exceeding ~1000-2000 active/mounted rigid bodies in the scene. Rapier's performance (especially for `fixed` hulls/trimeshes) degrades significantly beyond this.
- **Per-Chunk caps**: Always implement `MAX_X_PER_CHUNK` caps for procedurally generated entities that have colliders (Trees, Rocks, etc.). Default for trees: 32.
- **Grid Resolution**: Keep procedural generation grids at reasonable resolutions (e.g. 4x4 or higher). A 2x2 grid is 4x as expensive as 4x4 and can easily overwhelm the worker and main thread.
- **Noise Sampling**: Minimize `noise3D` calls in high-frequency loops. Cache biome/climate lookups and use fast hashes for local jitter.

- **LOD System**: Implemented in `VoxelTerrain.tsx` and `ChunkMesh.tsx`. Chunks use a continuous, quantized LOD distance (chunk-boundary based) with thresholds controlling trees/vegetation. Level 0 is full quality; Level 1+ simplifies trees (opaque leaves) and reduces vegetation density.
- **Pristine Caching**: Procedurally generated chunks (density + pristine mesh) are cached in IndexedDB at `src/state/ChunkCache.ts`. Worker checks this cache before generating/meshing to bypass heavy Surface Nets computation on area revisits.
- **Shader Feature Culling**: `TriplanarShader.ts` skips expensive calculations (caustics, high-freq noise, macro-noise) for distant fragments (`distSq > 4096.0`) to save GPU slab cycles.
- Phase 4: GPU / Shader optimizations and material pooling.
- Phase 5: Verification (LOD, caching, performance) and documentation.
- Phase 6: Memory stability fixes (Lazy noise texture, worker buffer safety).
- Phase 7: Performance & Memory Refactor (Uniform throttling, instanced stumps).
---

## Verification Checklist (required)

- `npm run build`
- `npm run dev` (confirm server starts; stop it once ready)
- 'npm run test:unit' (confirm tests pass)

## Worklog (last 5 entries)

- 2026-01-04: **Fog System Investigation**.
  - **Goal**: Identify all variables and systems producing the current fog state.
  - **Findings**: Fog is a hybrid of native `THREE.Fog` (for objects/sky) and custom `TriplanarShader.ts` GLSL (for terrain). Key variables: `fogNear` (40), `fogFar` (220 * viewDistance), `atmosphereHaze` (0.25), `heightFogStrength` (0.35).
  - **Files**: `AtmosphereManager.tsx`, `TriplanarShader.ts`, `App.tsx`, `SharedUniforms.ts`.
  - **Issue**: Attaching `ItemType.FLORA` (Lumina flora) to a tool in the crafting menu did not render the model, making it appear invisible/disconnected.
  - **Fix**: 
    1. Extracted `FloraMesh` as a reusable component in `UniversalTool.tsx`.
    2. Added the missing `ItemType.FLORA` case to the attachment rendering loop in `CraftingInterface.tsx`.
  - **Files**: `UniversalTool.tsx`, `CraftingInterface.tsx`.

- 2026-01-04: **VoxelTerrain.tsx Refactor - Separation of Concerns**.
  - **Goal**: Reduce VoxelTerrain.tsx complexity by extracting interaction logic and raycast utilities.
  - **Changes**:
    1. Extracted `raycastUtils.ts` (348 lines) - Pure functions for ray intersection tests (`getMaterialColor`, `isTerrainCollider`, `rayHitsFlora/Torch/Lumina/GroundPickup`, `buildFloraHotspots`).
    2. Extracted `useTerrainInteraction.ts` hook (782 lines) - All dig/build/chop/smash handling, physics item interaction, particle effects, audio feedback, terrain modification triggers.
    3. VoxelTerrain.tsx reduced from 2701 → 1792 lines (34% reduction). Now focuses on chunk streaming, LOD updates, meshing orchestration.
  - **Architecture**: Clean separation between streaming (VoxelTerrain) and interaction (useTerrainInteraction hook). Hook consumes raycast utils for hit detection.
  - **Files**: `src/features/terrain/logic/raycastUtils.ts` (new), `src/features/terrain/hooks/useTerrainInteraction.ts` (new), `VoxelTerrain.tsx` (refactored).

- 2026-01-04: **Voxel-based Global Illumination System**.
  - **Goal**: Replace flat ambient lighting with dynamic, environment-aware indirect lighting that responds to sky, caves, and point lights.
  - **Implementation**:
    1. **Light Grid Generation** (`src/core/lighting/lightPropagation.ts`):
       - Low-res 3D grid (8×32×8 = 2048 cells per chunk, LIGHT_CELL_SIZE=4 voxels).
       - Sky light traces vertically, attenuates through solid voxels (SKY_LIGHT_ATTENUATION=0.7).
       - Point lights (torches, Lumina) seed grid with inverse-square falloff.
       - 6-iteration flood-fill propagation (LIGHT_FALLOFF=0.82).
       - Reinhard tone mapping to Uint8 RGBA output.
    2. **Worker Integration** (`terrain.worker.ts`):
       - `generateLightGrid()` called BEFORE `generateMesh()`.
       - Lumina flora extracted from `floraPositions` via `extractLuminaLights()`.
       - Sky light config derived from sun height via `getSkyLightConfig()`.
    3. **Mesher GI Baking** (`mesher.ts`):
       - Per-vertex light colors sampled from grid via trilinear interpolation.
       - New `aLightColor` attribute (vec3) added to mesh geometry.
    4. **Shader Integration** (`TriplanarShader.ts`):
       - `aLightColor` attribute → `vLightColor` varying.
       - `getGILight()` replaces flat ambient lookup.
       - `uGIEnabled` (0/1 toggle), `uGIIntensity` (default 1.2) for runtime control.
    5. **Ambient Reduction** (`AtmosphereManager.tsx`):
       - Surface ambient: 0.30 → 0.08 (73% reduction).
       - Cave ambient: 0.14 → 0.04 (71% reduction).
       - GI now provides all indirect/ambient lighting.
  - **Performance**: Zero runtime cost. Light is fully baked during mesh generation in worker.
  - **Files**: `lightPropagation.ts` (new), `constants.ts` (light grid constants), `terrain.worker.ts` (integration), `mesher.ts` (vertex baking), `TriplanarShader.ts` (shader), `AtmosphereManager.tsx` (ambient reduction), `ChunkMesh.tsx` (attribute binding).
  - **Debug**: `uGIEnabled` = 0 falls back to 0.35 flat ambient. `uGIIntensity` scales GI contribution.

- 2026-01-04: **ChunkDataManager Integration (6-phase)**.
  - **Goal**: Centralize chunk data ownership, implement LRU cache, and add dirty tracking for player modifications.
  - **Changes**:
    1. Created `ChunkDataManager` (`src/core/terrain/ChunkDataManager.ts`) as single source of truth for chunk data.
    2. LRU cache (maxSize=150) evicts clean chunks when over capacity. Dirty chunks protected from eviction.
    3. Dirty tracking for player modifications (digging, flora pickup, tree removal, rock smash).
    4. Event system (`chunk-ready`, `chunk-updated`, `chunk-remove`, `chunk-dirty`) for view layer synchronization.
    5. IndexedDB persistence via `WorldDB.saveChunkModificationsBulk()` (debounced 2s). Only modified voxels persisted.
    6. `VoxelTerrain.tsx` refactored to use `chunkDataManager.getChunk()` throughout (40+ call sites).
    7. `visibilitychange`/`beforeunload` handlers ensure dirty chunks saved before exit.
  - **Files**: `ChunkDataManager.ts` (new), `WorldDB.ts` (add bulk save/clear), `VoxelTerrain.tsx` (integration), `FrameProfiler.ts` (disable noisy logging).
  - **Debug**: `window.__chunkDataManager.getStats()` for cache metrics.

- 2026-01-03: **React Reconciliation Performance Fix**.
  - **Issue**: 60-90ms frame spikes labeled "unknown" in profiler caused by multiple `setChunkVersions` calls per frame triggering React reconciliation.
  - **Root Cause**: ~20 direct `setChunkVersions` calls scattered throughout `VoxelTerrain.tsx` (worker messages, LOD updates, chunk mounts, removals).
  - **Fix**: Implemented batched version update system:
    1. Three queues: `pendingVersionAdds`, `pendingVersionUpdates`, `pendingVersionRemovals` (refs, not state).
    2. Helper functions: `queueVersionAdd()`, `queueVersionIncrement()`, `queueVersionRemoval()`.
    3. Single `flushVersionUpdates()` call at end of `useFrame` processes all queued changes in one `setState`.
    4. Post-initial-load flushes wrapped in `startTransition()` for non-blocking updates.
  - **Critical Bug Fixed**: Spawn chunk not appearing - initial load chunks were using `queueVersionIncrement` (does nothing for non-existent keys) instead of `queueVersionAdd`.
  - **Files**: `VoxelTerrain.tsx` (keyword: `BATCHED VERSION UPDATES`), `FrameProfiler.ts` (spike detection), `HUD.tsx` (minimap optimization), `ChunkMesh.tsx` (collider deferral).
  - **Debug Flags Added**: `?nocolliders`, `?nosim`, `?nominimap`, `?profile` for performance isolation.

- 2025-12-24: **Fixed Water Z-Fighting and Chunk Seams**.
  - **Issue 1**: Water surface disappearing when viewed at certain angles due to depth buffer precision issues.
  - **Fix 1**: Enabled `logarithmicDepthBuffer: true` in Canvas WebGL config (`App.tsx`). Provides better depth precision across the entire depth range (near: 0.1 to far: 2000).
  - **Issue 2**: Water chunks not seamlessly blending, leaving visible gaps between chunks (caused by shore falloff geometry).
  - **Fix 2**: Reverted water mesh to simple chunk-spanning quad (4 vertices at chunk corners, 0 to `CHUNK_SIZE_XZ`). Shoreline transitions are handled entirely by the shore mask SDF in the `WaterMaterial` shader.
  - **Files**: `App.tsx` (log depth), `mesher.ts` (water mesh)

- 2025-12-24: **Fixed Water Disappearing at Certain Angles (Z-Fighting)**.
  - **Issue**: Water surface would disappear when camera rotated to shallow/grazing angles, even from the same position. The water mesh is geometrically thin and sits at nearly the same depth as the terrain, causing depth buffer precision issues.
  - **Root Cause**: When the camera views the water at shallow angles, depth values conflict (z-fighting) AND standard culling metrics may fail for flat planes relative to camera frustum.
  - **Fix**: 
    1. Forced `frustumCulled={false}` on Water mesh.
    2. Removed `polygonOffset` (unreliable at grazing angles).
    3. Applied explicit physical Y-offset of `+0.1` to the water mesh.
    4. Set `renderOrder={1}`.
- 2025-12-24: Fixed `Shader Error: uTime : undeclared identifier` in `TriplanarShader.ts`.
  - **Issue**: The vertex shader for the terrain material was trying to animate grass waves using `uTime`, but `uTime` was only declared in the fragment shader. 
  - **Fix**: Added `uniform float uTime;` to the `triplanarVertexShader` definition.

- 2025-12-24: Fixed `Uncaught ReferenceError: scene is not defined` in `VoxelTerrain.tsx`.
  - **Root Cause**: The `updateSharedUniforms` function was being called inside `useFrame` using a reference to `scene` that was failing to be resolved from the component scope in some environments (likely due to broken HMR or scope-mangling during transformation).
  - **Fix**: Replaced the closure-based `scene` and `camera` references inside the `useFrame` hook with explicit `state.scene` and `state.camera` lookups. Since `state` is the first argument to the frame loop callback, this bypasses potential destructuring or scope issues.

- 2025-12-24: **Fixed Game Freezes on Fire/Torch Actions**.
  - **Root Cause**: Interacting with fire or torches (creation, pickup, placement) caused a ~1s freeze due to unexpected shader recompilation and shadow map initialization.
  - **Fixes**:
    - **Scene Warmup**: Implemented `SceneWarmup.tsx` to pre-mount dummy lights (Spot, Point) and pre-compile Fire/Spark shaders during app load.
    - **Shadow Opt**: Disabled `castShadow` on the Fire `PointLight` (terrain shadows are sufficient from the sun).
    - **Logic Fix**: Updated `FirstPersonTools.tsx` to prevent `UniversalTool` from rendering the torch when `TorchTool` is active.

- 2025-12-24: Fixed TriplanarMaterial & WaterMaterial Uniform Errors.
    - Resolved `TypeError: Cannot set properties of undefined (setting 'value')` in `TriplanarMaterial.tsx` by explicitly mapping missing uniforms from `sharedUniforms`.
    - Optimized `TriplanarMaterial` updates by moving `lastUpdateFrame` to module-level, reducing per-frame uniform updates from $N_{chunks}$ to $1$.
    - Fixed `TypeError: Failed to execute 'uniform3fv' on 'WebGL2RenderingContext'` in `WaterMaterial.tsx` caused by incorrect uniform initialization in `shaderMaterial`.
    - Standardized `useFrame` callbacks to use `state.scene` and `state.camera` for more robust scoping.

- 2025-12-24: **PERFORMANCE INVESTIGATION** - 20-30 FPS on M1 Mac Studio with constant stuttering.
  - **Root Causes**: Trimesh BVH construction, 81+ active chunks, LOD thrashing, expensive post-processing (AO).
  - **Fixes Applied**:
    1. Reduced `RENDER_DISTANCE` from 4 to 3 (49 chunks instead of 81, **40% reduction**).
    2. Disabled AO by default (even on 'high' preset).
    3. **LOD System Overhaul**: Changed from continuous distance to discrete integer tiers (0-4), only triggering updates when chunks cross actual LOD thresholds.

- 2025-12-24: **Improved Terrain Texture/Normal Mapping**.
  - **Goal**: Apply "noise based ridges" (similar to Beach effect) to all terrains.
  - **Implementation**: Updated `TriplanarShader.ts` vertex shader with distinct normal perturbation logic for different material groups:
    - **Rock/Strata**: Sharp, stratified horizontal ridges (Channels 1, 2, 9, 15).
    - **Grass/Jungle**: Strong static directional ridges (removed wind animation for performance) (Channels 4, 13).
    - **Dirt/Clay**: High-contrast lumpy/grid bumps (Channels 3, 7, 11).
    - **Snow/Ice**: Large, smooth static drifts (Channels 6, 12).
    - **Sand/Red Sand**: Preserved existing wind ripples (Channels 5, 10).
- 2026-01-04: **Ambient Lighting Adjustment**.
  - **Goal**: Increase indirect lighting slightly to avoid harsh blacks in shadows while maintaining contrast.
  - **Changes**:
    - `AtmosphereManager.tsx`: Surface ambient `0.08` → `0.10`, Cave `0.04` → `0.05`.
    - `TriplanarMaterial.tsx`: `uGIIntensity` `1.2` → `1.35`.
  - **Result**: Softens deep shadows without washing out directional contrast.
- 2026-01-04: **Disabled Shader Fog**.
  - **Goal**: Disable the custom exponential shader fog and height fog system as it was found to negatively impact visual clarity (e.g., causing "blue beach" syndrome).
  - **Changes**:
    - `SharedUniforms.ts`: Set default `uShaderFogEnabled` to `0.0`.
    - `TriplanarMaterial.tsx`, `VoxelTerrain.tsx`, `ChunkMesh.tsx`: Set default `shaderFogEnabled` / `terrainShaderFogEnabled` props to `false`.
  - **Result**: Visual clarity improved; atmospheric blue tinting now depends solely on sky/ambient light and standard Three.js distance fog.
