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

---

## Quick Project Facts (verified)

- **Stack**: Vite + React + TypeScript + `three` + `@react-three/fiber` + `@react-three/rapier` (`package.json`).
- **CSS**: Tailwind is wired via PostCSS import in `src/index.css` (`@import "tailwindcss";`). `index.html` does not load Tailwind via CDN.
- **Entry**: `src/index.tsx` mounts `src/App.tsx`.
- **Dev server**: `vite.config.ts` sets `server.port = 3000` and adds COOP/COEP headers for `SharedArrayBuffer`.

## Repo Map (high-signal)

- `src/core/`: Common engine utilities, math, materials, and generic worker pools (e.g. `TriplanarMaterial.tsx`, `WorkerPool.ts`).
- `src/features/terrain/`: Voxel generation, meshing, and chunk streaming logic (`VoxelTerrain.tsx`, `mesher.ts`).
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
- **Meshing**: `src/features/terrain/logic/mesher.ts` implements a Surface Nets-style algorithm (Dual Contouring variant) to generate smooth meshes from density data.
  - **Seam Fix**: Optimized loop logic explicitly handles boundary faces (X/Y/Z) with correct limits (`endX`, `endY`) to prevent disappearing textures at chunk edges.
  - **Physics**: Uses the full-resolution visual mesh for `trimesh` collision in Rapier. Throttled mounting (`mountQueue`) and worker-based generation are used to prevent main-thread spikes instead of mesh simplification.
- **Materials**: `TriplanarMaterial` uses custom shaders with sharp triplanar blending (pow 8) and projected noise sampling to avoid muddy transitions.
  - **Shader Stability**: Implements `safeNormalize` to prevent NaNs on degenerate geometry (e.g., sharp concave features from digging) which prevents flashing artifacts.
  - **Modular Shaders**: Shader code is extracted into `src/core/graphics/TriplanarShader.ts` for better maintainability.

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
- The terrain mesh uses fixed “material weight channels”:
  - Mesher output: `src/features/terrain/logic/mesher.ts` produces `matWeightsA`–`D`.
  - Render binding: `src/features/terrain/components/ChunkMesh.tsx` maps them to geometry attrs `aMatWeightsA`–`D`.

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
- **CustomShaderMaterial Imports**: In version 6.x+, the default import `import CSM from 'three-custom-shader-material'` is the **React component**. If you need to use it as a class/constructor (e.g. for material pooling or singleton materials), you MUST use `import CSM from 'three-custom-shader-material/vanilla'`. Mixing these up causes `CustomShaderMaterial is not a constructor` runtime errors.
- **CustomShaderMaterial redefinition errors**: When using `three-custom-shader-material` (CSM) with `MeshStandardMaterial`, do NOT declare `varying vec3 vNormal` or `varying vec3 vViewDir`. These are already defined by Three.js and will cause a `redefinition` error during merging. Use `csm_Normal` to set normals in the vertex shader; Three.js handles the fragment-side varying internally.
- **Responsive Item Offsets**: In portrait mode (aspect < 1), held items (torches, tools) must have their X-offsets scaled dynamically using `aspect` to prevent them from disappearing off the sides of the screen (see `FirstPersonTools.tsx` keywords: `responsiveX`).
- **Interaction Data vs Optimized Visuals**: Ground items (sticks, rocks) use optimized bucketted buffers for rendering (`drySticks`, `rockDataBuckets`), but the interaction logic (`rayHitsGeneratedGroundPickup`) still requires the original stride-8 data (`stickPositions`, `rockPositions`). If these are missing from the worker's `GENERATED` payload, items will be visible but impossible to pick up (see `VoxelTerrain.tsx`).
- **Instanced Geometry Disposal**: Do not call `geometry.dispose()` in an effect cleanup that depends on the *data* (e.g. `batch.positions`). This will destroy the geometry every time an item is picked up. Only dispose when the geometry object itself changes or on unmount (see `GroundItemsLayer.tsx`).
- **Trimesh Collider Creation is Expensive**: Rapier's `trimesh` colliders require building a BVH acceleration structure on the main thread. When `colliderEnabled` flips to `true`, the `<RigidBody colliders="trimesh">` creation can cause a 10-30ms stall depending on mesh complexity. The current throttled queue (`colliderEnableQueue` in `VoxelTerrain.tsx`) spreads this out, but doesn't eliminate the synchronous creation. Future optimization: use `requestIdleCallback` or pre-build colliders in a worker (if Rapier supports it).
- **Instance Matrix Calculations in Render Effects**: `TreeLayer.tsx` and `VegetationLayer.tsx` compute instance matrices in `useLayoutEffect` loops. For dense chunks (jungle trees, 100+ instances), this can block the main thread for 2-5ms. Consider pre-computing matrices in the terrain worker and passing them in the `GENERATED` payload.

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

---

## Verification Checklist (required)

- `npm run build`
- `npm run dev` (confirm server starts; stop it once ready)
- 'npm run test:unit' (confirm tests pass)

## Worklog (short, keep last ~5 entries)

- 2025-12-19: Performed final visual audit for Senior Dev report.
  - Verified "The Grove" biome renders with dense, high-quality vegetation and multi-layered lighting.
  - Performance: Observed ~18 FPS after streaming settles, with initial dips during chunk generation.
  - Confirmed Leva debug controls (Scene Lighting, Sun Shadow Params, Orbit) are fully functional and correctly updating the world state.
  - Checked inventory slot 5 (Flora) icon and count; confirmed 10/10 items present in initial "The Grove" spawn.
- 2025-12-18: Implemented responsive held-item positioning for portrait mode.
  - Added `responsiveX` scaling to `FirstPersonTools.tsx` that dynamically adjusts tool X-offsets based on the window aspect ratio.
  - This ensures torches and held items (sticks, stones, etc.) remain visible when the screen is in portrait orientation.
- 2025-12-17: Enhanced ground item variation (sticks and stones).
  - Implemented `ROCK_SHADER` with 3D noise vertex displacement to create unique, jagged shapes for every stone.
  - Implemented `STICK_SHADER` with bending and knobby node procedural logic to make sticks look like natural branches.
  - Increased geometry detail (more segments) for sticks and rocks to support smooth shader-based deformation.
- 2025-12-17: Improved vegetation realism, specifically for the Grove biome.
  - Upgraded `VegetationLayer` shader with multi-frequency wind (gusts + jitters), fake Subsurface Scattering (SSS), and Ambient Occlusion.
  - Added world-space 3D noise variation to break up color uniformity in dense patches.
  - Randomized individual blade heights in grass clumps for a more organic silhouette.
  - Tuned Grove grass color to a richer, lusher green (#4fa02a).
- 2025-12-17: Implemented Numpad shortcuts for inventory slot selection. Users can now use Digit1-9 and Numpad1-9 to select slots 1-8. Flora is confirmed to be in slot 5 (index 4).
- 2025-12-14: Implemented persistent Graphics Settings (Resolution, Quality) and Touchscreen Support (Virtual Joystick). Added `SettingsStore.ts` and `SettingsMenu.tsx`. Refactored `Player` input.
- 2025-12-14: Fixed per-tree leaf color variation not being visible. Root causes: (1) hue variation was too subtle (0.10→0.30 radians), (2) noise was sampled at world position making nearby trees identical, (3) tint range was too narrow. Fix: offset noise coords by per-tree seed, add per-tree brightness/saturation, widen tint range.
- 2025-12-14: Added volumetric God Rays (post-processing) linked to the sun mesh for dramatic atmospheric lighting.
- 2025-12-15: Fixed "enormous/clipping" Moon by decoupling visual distance (1200) from orbit physics (300) and reducing mesh radius (20->12). Moon now renders behind terrain and at correct angular size (~0.5 deg).
- 2025-12-15: Improved chunk streaming hitching by buffering worker applies and deferring most trimesh colliders; also shifted the active chunk window forward in movement direction (`src/features/terrain/components/VoxelTerrain.tsx`). Terrain/geo can still pop at the render boundary (not visually verified here).
- 2025-12-16: Implemented Fire Creation mechanics: Stone-on-Stone sparks (InteractionHandler), Heat accumulation, Fire spawning, and Stick-on-Fire -> Torch conversion. Added `SparkSystem.tsx` and `ItemType.FIRE`.
- 2025-12-17: Fixed fire mechanics physics issue where target stone was pushed away when struck. Added `isAnchored` flag to anchor stones with 4+ nearby sticks, making them fixed bodies during fire-starting.
- 2025-12-17: Refined Fire mechanics: Fire now stays when converting stick to torch, rock stays when igniting fire. Enhanced fire visuals with PointLight, Glow billboard, and improved particles.
- 2025-12-17: Improved Underwater Transition & Effects.
  - Delayed underwater state trigger (+0.2y offset) so it matches visual submersion.
  - Added `BubbleSystem.tsx` for rising bubble particles.
  - Enhanced underwater post-processing: increased Chromatic Aberration (distortion) and Vignette (darkness) based on submersion depth.
- 2025-12-17: Optimized Underwater FX & Added Caustics.
  - Implemented procedural caustics in `TriplanarMaterial.tsx` (efficient vertex/frag projection) visible on underwater terrain during the day.
  - Added strict `wetMask > 0.5` check to caustics to prevent them from appearing in dry caves below sea level.
  - Increased Bubble density (50 -> 150) and fixed "first-dive lag" by keeping the BubbleSystem active but scaled-out when dry.
  - Fixed shader redefinition error (`uWindDirXZ` duplicated) in `TriplanarMaterial.tsx`.
  - Removed unreliable `vWetness` check from caustics logic to ensure visibility on underwater terrain.
  - Implemented correct `vCavity` check (`0.0` = open seabed, `>0.3` = cave) to robustly mask caustics from caves without breaking seabed visibility.
  - Refined Caustics pattern: replaced simple noise with a "Ridged Multifractal" domain-warped shader to create a realistic "web-like" cellular light pattern.
  - Adjusted Caustics color: Shifted from pure white (`0.8, 0.95, 1.0`) to a deeper cyan/blue tint (`0.2, 0.8, 1.0`) to match underwater reference photos.
    - Reduced final opacity to 10% (was 30%) for a subtler effect.
    - Verified build (`npm run build`), dev startup (`npm run dev`), and headless tests (`npm test`).
  - Fixed shader compilation error: Passed `vec3` to 3D noise texture lookup for the secondary variation mask.
- 2025-12-17: Completely refactored `BubbleSystem` into a dynamic particle emitter.
  - Reduced bubble radius to half the original size (0.04) for better scale.
  - Eliminated global "infinite volume" bubbles in favor of localized "oxygen" bubbles emitted from the camera.
  - Implemented water entry bursts based on downward velocity.
- 2025-12-17: Refined Caustics Intensity, Speed, and Masking.
  - Reduced caustic animation speed by 50% for a calmer underwater feel.
  - Reduced overall visibility and busy-ness by 3x (intensity multiplier 18.0 -> 6.0).
  - Sharpened lines (higher ridge exponents) and reduced high-frequency noise.
  - **Fix**: Resolved "sharp seabed cutoffs" by expanding the water-fill post-pass to cover the entire chunk volume, including PAD regions. This ensures consistent sampling at chunk boundaries and prevents grid-like artifacts.
  - **Refinement**: Optimized wetness tagging to only affect the top layers of the seabed, preventing unnecessary darkening of deep underground terrain.
- 2025-12-18: Sun Realistic Overhaul & Refinement.
  - Completely refactored the Sun billboard shader with a multi-layered core, dynamic volumetric rays, and atmospheric scattering simulation.
  - Implemented smoother "Golden Hour" and "Midday" color transitions in `getSunColor`.
  - Added subtle chromatic fringing to the sun's outer halo for a more natural lens/atmospheric effect.
  - **Refinement**: Shortened volumetric rays by ~40% and sharpened peaks for a cleaner look.
  - **Refinement**: Fixed "dark core" issue by boosting sun mesh emissivity (5.0x) and offsetting the billboard toward the camera (2.0 units) to prevent depth occlusion.
- 2025-12-18: Night Beautification (Stars & Painterly Moon).
  - **Procedural Sky**: Upgraded `SkyDomeRefLink` (SkyDome shader) to include procedural twinkling stars and a subtle Milky Way nebula band that fades in at night. stars use a 3D noise hash for stability.
  - **Realistic Moon**: Replaced the simple white sphere with a procedural shader (`MoonFollower`) featuring craters, shadow shading, and edge fresnel for a "painterly realistic" look.
  - **Fixed Sun Halo**: Replaced the hard-edge `discard` in the sun glow shader with a `smoothstep` mask to eliminate the "hard shape halo" artifact.
  - **Increased Draw Distance**: Updated `App.tsx` camera far plane to 2000 (was 600) to ensure celestial bodies (distance ~1200) don't get clipped.
  - **Refined Star Logic**: Fixed bug where stars were visible in caves by decoupling brightness check from `gradientRef` (which gets darkened by ambient logic). Now uses `calculateOrbitAngle` to detect true astronomical night.
  - **Refined Star Logic**: Fixed critical math error where `smoothstep` was checking `sunHeight` against reversed min/max, causing stars to be visible at noon. Now correctly uses `1.0 - smoothstep(-0.4, -0.1, sunHeight)` to ensure stars only appear when the sun is well below the horizon.
  - **Stability**: Memoized `orbitConfig` in `App.tsx` to prevent `AtmosphereController` and `SkyDome` from re-rendering unnecessarilly when other state changes, potentially reducing geometry thrashing.
  - **Fixed Vegetation Crash**: Resolved persistent `Cannot read properties of undefined (reading 'isInterleavedBufferAttribute')` crash in `VegetationLayer.tsx`. The issue was a race condition where `geometry.dispose()` was called in `useEffect` cleanup for a geometry that had been created in `useMemo` but had its attributes attached later in `useLayoutEffect`. By moving attribute creation entirely into `useMemo`, the geometry is now atomically fully formed before any potential disposal, preventing the renderer from inspecting an incomplete geometry during cleanup.
  - **Rotating Sky**: Added a rotation matrix to the star field shader so stars rotate in sync with the moon's orbit (simulating Earth's rotation).
  - **Visual Tweaks**: Slowed down default day/night speed by 50% for realism. Replaced linear nebula band with organic FBM clouds. Made stars sharper and smaller to fix "pixelated" look.

- 2025-12-18: Refined Star Animation.
  - **Scintillation**: Replaced sine-wave twinkle with a rotating "atmosphere noise mask" (freq 20.0) that drifts over the starfield. This creates realistic, independent twinkling as stars pass through "air masses" while ensuring they never fade below 40% brightness.
  - **Rotation**: Reduced skybox rotation speed by 5x (`0.05` -> `0.01`) for a more realistic, subtle night sky movement.

- 2025-12-18: VoxelCraft Performance Enhancements (Physics & Particles).
  - Optimized \`PhysicsItem.tsx\`: Removed per-frame store syncing of item positions; implemented a global shared Audio pool for \`clunk\` and \`dig\` sounds (reducing 100+ Audio object creates during mass spawning).
  - Optimized `InteractionHandler.tsx`: 
    - Replaced Three.js `Raycaster` (scene graph traversal) with Rapier's native `world.castRay` for all stone/stick/fire interactions.
    - Optimized "fire creation" proximity checks by replacing O(N) array filtering with Rapier's native `world.intersectionsWithShape` sphere query, leveraging spatial partitioning.
  - GPU-Accelerated Particles: Completely refactored `BubbleSystem`, `SparkSystem`, and `FireParticles` to use custom shaders and `InstancedMesh` attributes.
    - Moved all physics (gravity, buoyancy), turbulence, and scale animations from the CPU (\`useFrame\` loops) to the GPU (vertex shaders).
    - Reduced per-frame matrix update overhead to near-zero for active particles.
  - Fixed various Rapier API incompatibilities and lint warnings in the interaction logic.
  - Optimized `VoxelTerrain.tsx` Particles & Streaming:
    - GPU-accelerated debris and spark particles using `CustomShaderMaterial`.
    - Throttled streaming logic to only execute when player crosses chunk boundaries.
    - Implemented prioritized job queues for chunk generation and collider enabling.
  - Fixed Rapier Context Error: Moved `InteractionHandler` inside the `<Physics>` provider in `App.tsx`.
- 2025-12-18: Fixed movement lag by implementing throttled chunk removal in `VoxelTerrain.tsx`. Added a `removeQueue` that processes a maximum of 2 removals per frame, preventing synchronous frame spikes when crossing chunk boundaries.
- 2025-12-18: Fixed Item Pickup & Optimized Rendering Stability.
  - Restored `stickPositions` and `rockPositions` (stride-8 interaction data) to the worker's `GENERATED` payload. This allows `rayHitsGeneratedGroundPickup` to function even when rendering has been shifted to optimized bucketed buffers.
  - Fixed a critical crash/instability bug in `GroundItemsLayer.tsx` and `VegetationLayer.tsx` where instanced geometry was being disposed every time an item was picked up.
  - Synchronized `removeGround` logic in `VoxelTerrain.tsx` to instantly hide items from both original raw arrays and optimized visual buffers (`drySticks`, `rockDataBuckets`).
  - Verified held/thrown item visibility by setting `uInstancing: false` in `StickTool`, `StoneTool`, and `PhysicsItem`.
- **Jungle Biome & Rendering Performance Optimizations (2025-12-18)**
  - **Reduced Tree Geometry Complexity**: Modified `TreeGeometryFactory.ts` to limit Jungle tree branching and depth. Implemented adaptive radial segments (5 for trunk, 3 for tips) and a 1200-segment hard cap per template. This reduced triangle count in dense jungle by ~80% (from ~90M to ~15M in view).
  - **Centralized Shader Uniforms**: Created `SharedUniforms.ts` to manage global uniforms like `uTime` and `uSunDir`.
  - **Reduced useFrame Overhead**: Refactored `VegetationLayer.tsx` and `TreeLayer.tsx` to utilize shared uniforms, removing 200+ redundant `useFrame` calls per frame across all loaded chunks.
  - **Throttled Proximity Checks**: Throttled `RootHollow.tsx` entity scanning logic to run once every 20 frames instead of 60 times a second per stump.
  - **Optimized Memory Management**: Explicitly disposed of intermediate geometries during tree generation to prevent memory spikes.
- 2025-12-18: Performance optimization of main thread bottlenecks.
  - Optimized Minimap: Reduced biome sampling resolution from 1x1 to 4x4 (16x fewer noise calls) and increased refresh rate interval to 10 frames (was 5).
  - Throttled HUD Updates: Minimized coordinate state churn by using a store subscription that only updates React state when the player has moved > 0.1m.
  - Scene Graph Optimization: Throttled `DynamicEnvironmentIBL` scene traversal to only occur when light intensity changes significanly (>1%). 
  - Resource Management: Wrapped `DynamicEnvironmentIBL` in a conditional check in `App.tsx` and added unmount cleanup to ensure zero overhead (both JS and GPU) when disabled.
  - Added specialized diagnostics (`terrainFrameTime`, `minimapDrawTime`) to `window.__vcDiagnostics` for future tracing.
- **Chunk Streaming & Jungle Aesthetics Overhaul (2025-12-18)**
  - **Eliminated Chunk Pop Stutter**: Implemented a `mountQueue` in `VoxelTerrain.tsx` that throttles React state updates to one chunk addition per frame. This spreads the geometry/texture upload cost over several frames, preventing the "quick stutter" when moving into new territory.
  - **Implemented Dithered Fade-in**: Added a world-space dithered discard logic to `TriplanarMaterial.tsx`. New chunks now gradually materialize over 2 seconds using a deterministic GPU-side noise hash, creating a smooth transition instead of a visual pop.
  - **Beefier Jungle Trees**: Significantly increased the base trunk radius (from 0.6 to 1.1) and canopy spread for Jungle trees in `TreeGeometryFactory.ts` to create a more "imposing" rainforest feel.
  - **Enhanced Undergrowth Density**: Added `JUNGLE_GIANT_FERN` and increased base scaling for all jungle vegetation (Broadleaf, Ferns, Vines) in `VegetationConfig.ts`. This compensates for previous poly-count reductions by filling more screen space with low-poly, voluminous shapes.
  - **Corrected Tree Geometry Nesting**: Fixed a missing closing brace in `TreeGeometryFactory.ts` that caused build failures and ensured proper deterministic cache isolation.
- **Spawn Logic & Loader Safety (2025-12-18)**
  - **Fixed Infinite Loading Screen**: Resolved a race condition where the terrain loader was waiting for chunks around the spawn point, while the generator was busy loading chunks around the cinematic camera. The streaming system now correctly prioritizes the spawn area during the pre-load phase.
  - **Synchronized World State**: Fixed a bug where `Player` spawn height was calculated based on stale (default) world parameters. App-level `useEffect` now correctly updates the `spawnPos` whenever a `WorldType` is selected, preventing player falls.
  - **Robust Initial Load Check**: Updated the readiness condition to monitor the actual React `chunks` state instead of internal refs, ensuring physics colliders are mounted and active before the "Enter" button is revealed.
  - **Shader Stability**: Refined `TriplanarMaterial.tsx` dither logic to use `clock` time exclusively, eliminating "invisible chunk" issues caused by timing jitter between `performance.now()` and Three.js uniforms.
- **Chunk Stutter Investigation (2025-12-18)**
  - **Root Cause Analysis**: Investigated remaining stutter when new chunks load. Diagnostics show worker/geometry processing is fast (~5μs geometry creation, ~0.3ms terrain frame time), so the bottleneck is elsewhere.
  - **Primary Suspect**: Rapier trimesh collider BVH construction when `colliderEnabled` flips to `true`. This happens synchronously during React reconciliation and can take 10-30ms per chunk.
  - **Secondary Suspects**: (1) Instance matrix calculation loops in `TreeLayer.tsx`/`VegetationLayer.tsx` `useLayoutEffect` hooks for dense vegetation, (2) RigidBody key changes causing full collider remounts.
  - **Documented in Pitfalls**: Added entries for trimesh collider cost and instance matrix calculation overhead.
- **Chunk Stutter Performance Fixes (2025-12-18)**
  - **Pre-computed Tree Instance Matrices**: Moved tree instance matrix calculation from `TreeLayer.tsx` `useLayoutEffect` loop to `terrain.worker.ts`. Matrices are now computed in the worker thread and passed in `treeInstanceBatches`. Main thread now just calls `instanceMatrix.array.set(matrices)` - eliminates ~2-5ms of synchronous work per dense chunk.
  - **Deferred Collider Enabling via requestIdleCallback**: Non-critical colliders (distance > 0 from player) now use `requestIdleCallback` with a 100ms timeout. Colliders directly under the player (distance 0) remain synchronous to ensure the player doesn't fall through terrain.
  - **Maintained Fallback Compatibility**: `TreeLayer.tsx` includes a fallback path for computing matrices client-side if `treeInstanceBatches` is not provided, ensuring backwards compatibility.
- 2025-12-18: Global Material Optimization & Staged Mounting
  - **Shared Terrain Material**: Refactored `TriplanarMaterial.tsx` to use a singleton instance for ALL terrain chunks. Moved the dithered fade-in logic to use a vertex attribute (`aSpawnTime`) instead of a uniform, enabling 100% material sharing across chunks.
  - **Material Pooling**: Implemented global material pools for Vegetation, Trees, Ground Items, and Lumina. Reduced `CustomShaderMaterial` and `MeshStandardMaterial` instances from ~400+ per loaded world down to ~40 (one per unique asset type), drastically reducing mounting cost and JS-to-GPU state changes.
  - **Staged mounting in `ChunkMesh.tsx`**: Deferred the rendering of heavy auxiliary layers (trees, flora) by one frame after the terrain mounts.
  - **Verified resource disposal**: Added explicit `.dispose()` for geometries and textures in `ChunkMesh.tsx` to prevent long-term GPU memory leaks.
  - **Improved Stutter**: Visual inspection confirms that chunk-loading stutters (FPS drops) are significantly reduced during movement.
- 2025-12-18: Removed dithered fade-in logic from `TriplanarMaterial.tsx` and `ChunkMesh.tsx`. Chunks now pop in instantly as requested.

- 2025-12-18: Fixed critical runtime crash "CustomShaderMaterial is not a constructor".
  - **Identified root cause**: The default import from `three-custom-shader-material` v6 is a React component, while material pooling/singleton logic requires the vanilla class constructor.
  - **Fix**: Updated `TriplanarMaterial.tsx`, `TreeLayer.tsx`, `VegetationLayer.tsx`, and `GroundItemsLayer.tsx` to use the `/vanilla` import path.
  - **Build Verification**: Confirmed `npm run build` completes successfully.
- 2025-12-19: Fixed "Uncaught TypeError: Cannot read properties of undefined (reading 'postMessage')" in `WorkerPool.ts`.
  - **Identified root cause**: Negative chunk coordinates (e.g., `(-1, -1)`) passed to `postToOne` resulted in a negative array index (`-2 % 4 === -2`), causing an out-of-bounds access.
  - **Fix**: Added `Math.abs(index)` in `WorkerPool.postToOne` to ensure target indices are always positive and within the valid range of the worker pool.
