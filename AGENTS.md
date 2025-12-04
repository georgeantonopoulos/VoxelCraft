## Agent Notes for `VoxelCraft`

ALWAYS INSPECT CHANGES MAKE SURE NO BUGS SLIP. 
If doing a visual inspection always wait 10 seconds and use the controls to take 4 separate screenshots and analyse what changed. Update this doc (AGENTS.md) with your findings. 

Do not force GLSL version - there's a mix of them here and its working fine as it is. 
Do not remove comments, add them if missing. 

Always verify and run npm run build and npm run dev to make sure the app is working as expected. 


Do NOT REMOVE COMMENTS. ADD THEM IF NECESSARY. AND UPDATE THIS DOCUMENT (AGENTS.md) WITH YOUR FINDINGS. 

### 1. Project Overview
- **Tech Stack**: Vite + React + TypeScript + `three` / `@react-three/fiber`.
- **Physics**: `@react-three/rapier`.
- **Styling**: Tailwind CSS (via CDN in `index.html`).
- **Entry**: `index.tsx` -> `App.tsx`.

### 2. Core Architecture

#### File Structure
The project follows a domain-driven architecture to improve scalability and maintainability.

- `src/core/`: Engine-level utilities (Math, Graphics, Memory, Types).
- `src/features/`: Game modules grouped by domain.
  - `terrain/`: Voxel engine, meshing, chunk management.
  - `flora/`: Plants, trees, and growth logic.
  - `player/`: Player controller and input handling.
- `src/ui/`: User Interface components (HUD, StartupScreen).
- `src/state/`: Global state management (Zustand stores).
- `src/assets/`: Static assets (GLB models, images).
- `src/utils/`: General helper functions.

#### Key Concepts
- **Coordinates**:
  - **World Space**: Absolute 3D coordinates (Player, Raycasts).
  - **Chunk Space**: Grid coordinates `(cx, cz)`. One chunk = `32x32x32` units.
  - **Local Voxel Space**: `0..32` within a chunk (plus padding `PAD=2` for seamless edges).
- **Data Flow**:
  - `VoxelTerrain` manages the chunk lifecycle (load/unload based on `RENDER_DISTANCE`).
  - Generation: `VoxelTerrain` -> `terrain.worker` -> `TerrainService` -> `generateMesh` -> `VoxelTerrain`.
  - Modification: Interaction -> `modifyChunk` -> `MetadataDB`/`SimulationManager` -> `REMESH` event.

### 3. Subsystems

#### Terrain System
- **Generation**: `TerrainService.generateChunk` uses 3D Simplex noise (`src/core/math/noise.ts`) to create a density field.
  - **Density > ISO_LEVEL (0.5)** = Solid.
  - **Materials**: Determined by height, slope, and noise (Bedrock, Stone, Dirt, Grass, etc.).
- **Meshing**: `src/features/terrain/logic/mesher.ts` implements a Surface Nets-style algorithm (Dual Contouring variant) to generate smooth meshes from density data.
  - **Seam Fix**: Optimized loop logic explicitly handles boundary faces (X/Y/Z) with correct limits (`endX`, `endY`) to prevent disappearing textures at chunk edges.
- **Materials**: `TriplanarMaterial` uses custom shaders with sharp triplanar blending (pow 8) and projected noise sampling to avoid muddy transitions.
  - **Shader Stability**: Implements `safeNormalize` to prevent NaNs on degenerate geometry (e.g., sharp concave features from digging) which prevents flashing artifacts.

#### Simulation System
- **Metadata**: `MetadataDB` stores `wetness` and `mossiness` layers globally.
- **Loop**: `SimulationManager` runs a `simulation.worker` that updates metadata (e.g., water makes nearby stone wet -> wet stone grows moss).
- **Updates**: Worker sends `CHUNKS_UPDATED` -> `SimulationManager` -> `VoxelTerrain` (triggers visual update/remesh).

#### Interaction & Physics
- **Physics**: Chunks are `fixed` rigid bodies with `trimesh` colliders. Trees use `InstancedRigidBodies` (trunks/branches) for collision. Player is a `dynamic` capsule.
- **Controls**: `PointerLockControls` for view. `KeyboardControls` for input.
- **Player Movement**:
  - **Normal Mode**: Space jumps when grounded (raycast check).
  - **Flying Mode**: Double-tap Space to toggle flying mode.
    - In flying mode: Gravity disabled (`gravityScale = 0`), Space to fly up, Shift to fly down, hover when neither pressed.
    - Double-tap Space again to exit flying mode.
    - Double-tap detection uses 300ms window to prevent accidental activation.
- **Dig/Build**:
  - Raycast via Rapier (`world.castRay`) filters for `userData.type === 'terrain'`.
  - `TerrainService.modifyChunk` applies a radial density falloff to smooth/carve terrain.

#### Lighting System
- **Sun Follower**: `SunFollower` component manages both the directional light and visual sun mesh.
  - **Orbit**: Sun orbits slowly (cycle every ~8-10 minutes) following the player's position.
  - **Time-Based Colors**: Sun color transitions smoothly based on sun height:
    - **Night** (sun below horizon): Blue (`#4a5a7a`), darker intensity (0.3)
    - **Sunrise/Sunset** (sun near horizon): Orange/pink (`#ff8c5a`), moderate intensity
    - **Day** (sun high): White/yellow (`#fffcf0`), full intensity
  - **Smooth Transitions**: Uses `THREE.Color.lerpColors()` for smooth color interpolation between phases.
  - **Dual Updates**: Both directional light color and sun mesh material color update together for visual consistency.
  - **Sun Glow**: Sun features a billboard glow effect that:
    - Always faces the camera for optimal visibility
    - Increases in size (5.0x) and opacity (0.9) during sunset/sunrise for enhanced visibility
    - Uses warmer orange tones during sunset, golden tints during day
    - Creates a realistic atmospheric glow around the sun
- **Moon Follower**: `MoonFollower` component uses simple "game physics" approach.
  - **Counter-Weight System**: Moon orbits exactly opposite to the sun (angle + Math.PI), sharing the same speed (0.025) to maintain perfect synchronization.
  - **Visibility**: Moon is visible whenever it's above the horizon (Y > -50 threshold for smooth transitions).
  - **Moonlight**: Provides subtle cool blue-white lighting (`#b8d4f0`) with fixed intensity (0.2) when above horizon.
    - **No Shadows**: Moonlight doesn't cast shadows (performance optimization).
  - **Visual Moon**: Simple white sphere (20 unit radius) - clean and visible.
- **Atmosphere Controller**: `AtmosphereController` component manages gradient sky, fog, and hemisphere light colors.
  - **Gradient Sky**: Renders a `SkyDome` component that creates a realistic sky gradient:
    - **Night**: Deep dark blue at zenith (`#020210`), slightly lighter at horizon (`#101025`)
    - **Sunrise/Sunset**: Deep blue at zenith (`#2c3e50`), vibrant orange/pink at horizon (`#ff6b6b`)
    - **Day**: Rich sky blue at zenith (`#1e90ff`), pale blue at horizon (`#87CEEB`)
    - Gradient transitions smoothly based on sun position using shader-based interpolation
  - **Dynamic Fog**: Fog color matches the horizon (bottom) color of the sky gradient for seamless blending.
  - **Hemisphere Light**: Sky color matches zenith (top) color, ground color adjusts for time of day (darker at night, warmer during sunrise/sunset).
  - **Performance**: Uses refs to update SkyDome colors without triggering React re-renders every frame.

#### Flora & Environmental Objects
- **RootHollow**: Uses `tree_stump.glb` model.
  - **Geometry**: Loaded from GLB, scaled to ~1.4 height.
  - **Alignment**: Aligns to terrain normal (blended 70% with UP vector for gravitropism) to prevent floating while maintaining upright appearance.
  - **Physics**: `CylinderCollider` (fixed).
  - **Interaction**: Detects nearby `FLORA` entities (dropped items) to trigger `FractalTree` growth.
  - **Rendering**: Forces `FrontSide` rendering and enables shadows to avoid Z-fighting.

#### Startup & UI
- **Startup Flow**:
  - `StartupScreen` displays logo and waits for `VoxelTerrain` to load initial chunks (3x3 around spawn).
  - `CinematicCamera` orbits the spawn point while loading.
  - "Enter" button activates `Player` and `PointerLockControls`.
- **UI**:
  - `UI` component handles HUD (Crosshair, controls).
  - `StartupScreen` handles entry.

### 4. Developer Guidelines
- **Do Not Break**:
  - **Chunk Padding**: `TOTAL_SIZE = CHUNK_SIZE + PAD * 2`. Critical for meshing neighbors.
  - **UserData**: Keep `userData: { type: 'terrain' }` on chunk RigidBodies for interaction raycasting.
  - **Worker Messages**: Follow the `type` / `payload` pattern in workers.
- **Performance**:
  - **Mesher Optimization**: Loop bounds are strictly controlled to avoid checking unnecessary voxels while ensuring seams are closed.
  - Use `ref` for high-frequency updates (Player movement, Particles).
  - Avoid blocking the main thread; offload heavy math to workers.
- **Conventions**:
  - Add JSDoc to new functions.
  - Use `src/constants.ts` for magic numbers (Gravity, Speed, Chunk Size).
- **Particle System**:
  - **Critical Bug Fix**: Always initialize arrays of objects with individual instances (e.g., `Array.from({ length: n }, () => new Vector3())` instead of `Array(n).fill(new Vector3())`). Using `fill()` creates shared references causing all particles to share the same velocity/state.
  - **Timeout Management**: Use refs to track `setTimeout` IDs and clear them before setting new ones to prevent race conditions when rapid interactions occur.

### 5. Environment
- **Env Vars**: `vite.config.ts` maps `.env.local` vars (like `GEMINI_API_KEY`) to `process.env`.
- **Dev Server**: `npm run dev` on port 3000.

### 6. Visual Artifacts & Solutions
- **Triangle Artifacts**: Terrain previously used `flat` shading, causing hard triangle edges.
- **Solution (Fixed Channel Splatting)**:
  - **16 Fixed Channels**: The mesher (`mesher.ts`) now writes four `vec4` weight attributes (`matWeightsA`–`D`) covering 16 material channels (AIR, BEDROCK, STONE, DIRT, GRASS, SAND, SNOW, CLAY, WATER, MOSSY_STONE, RED_SAND, TERRACOTTA, ICE, JUNGLE_GRASS, GLOW_STONE, OBSIDIAN).
  - **Weight Only Interpolation**: Vertices carry only weights; material IDs are fixed per channel, so shared edges never interpolate IDs and cannot rainbow.
  - **Neighborhood Splatting**: Each vertex samples a small radius of solid voxels, accumulates inverse-square weights per channel (ignoring AIR/WATER), normalizes, and falls back to DIRT if empty.
  - **Shader Accumulation**: `TriplanarMaterial` sums weighted material responses per channel and normalizes the accumulated roughness/color; moss/wetness overlays still apply with safe-normalized normals to avoid NaNs.
- **Self-Intersection Artifacts (Dark Flickering Patches)**:
  - **Root Cause**: `DoubleSide` rendering on pinched geometry (sliver triangles from vertex clamping) causes Z-fighting between front and back faces, creating dark flickering squares.
  - **Solution**: 
    - **Front-Side Rendering**: Changed `TriplanarMaterial` to `side={THREE.FrontSide}` to eliminate backface Z-fighting artifacts.
    - **Soft Vertex Clamp**: Relaxed vertex clamp in `mesher.ts` from `0.0/1.0` to `0.001/0.999` to prevent zero-area sliver triangles while still closing holes. This preserves triangle winding direction for proper normal calculation.
    - **Shadow Bias**: Already configured (`shadow-bias={-0.001}`, `shadow-normalBias={0.08}`) to prevent shadow acne with front-side rendering.

### 7. Recent Findings

- 2025-12-03: DIG on Flora Tree leaves failed to grant the axe because only thick-branch colliders existed; canopy had no physics hit. Added a flora-tree-only sensor collider sized from the fractal bounding box so leaf/canopy clicks register while keeping other tree types untouched. Verified with `npm run build` and `npm run dev` (dev stopped after startup).
- 2025-12-03: Restored RootHollow FractalTree to commit `940eb3c` visuals (cyan-tipped magical variant). Re-applied worker instance matrices/branch depth attributes and bounding volumes so branches/leaves render correctly, and kept type-based styling for other tree types intact. Verified with `npm run build` and `npm run dev` (dev stopped after startup).
- 2025-12-03: Fixed flora placement discrepancy and interaction. Generated flora were not being rendered because they weren't synced to `WorldStore`. Updated `VoxelTerrain` to sync generated flora positions to `WorldStore` entities, enabling proper rendering and unified DIG interaction. Also adjusted flora Y-offset (-0.1) to fix floating issues. Verified with `npm run build` and visual check.
- 2025-12-03: Fixed severe performance regression caused by syncing thousands of generated flora to `WorldStore`. Root cause was double-offsetting: `LuminaLayer` rendered inside a chunk group (already offset) but received World Coordinates, pushing flora 32+ units away. Interaction raycast also double-added offsets. Fix: Reverted store sync (restoring performance), subtracted chunk offset in `LuminaLayer` for correct local rendering, and fixed raycast math in `VoxelTerrain`. Verified with `npm run build` and visual check.
- 2026-XX-XX: Fixed cavern flora mix-up. `floraPositions` now represent lumina flora (collectibles) placed in clustered shallow caverns (Y -3..0) with headroom checks; surface trees moved to `treePositions`. Chunks sync lumina flora into `WorldStore` so the minimap hotspots and in-world lumina bulbs align, and trees render only from `treePositions`. Verified with `npm run build` and `npm run dev` (dev auto-selected :3001 and was stopped after startup).
- 2026-XX-XX: Flora hotspots were previously tied to surface tree spawns, so the minimap showed targets without cavern flora present. `TerrainService.generateChunk` now places flora in shallow caverns (world Y -3..0) with clustered noise-based groups and headroom checks; hotspots follow these updated positions. Verified with `npm run build` and `npm run dev` (dev auto-stopped after port auto-select to :3001).
- 2026-XX-XX: Flora spawn points are generated in `TerrainService.generateChunk` (post-pass noise threshold per biome). `VoxelTerrain` now pushes those world-space hotspots into `WorldStore`, and the HUD minimap renders them as pulsating blue circles so flora hotspots are visible before pickup.
- 2025-12-02: Stabilized terrain normals on isolated peaks. Trilinear gradients now fall back to a clamped central-difference probe of the padded density grid when the primary normal is near-degenerate, with an Up fallback if both are tiny. This eliminates zero-length/erratic normals on thin ridges and peaks. Verified with `npm run build` and `npm run dev` (dev on 127.0.0.1:3000, auto-stopped after timeout).
- 2025-12-02: Replaced tri-material ID interpolation with fixed 16-channel splatting (`matWeightsA`–`D`) to eliminate rainbow seams. Mesher now accumulates inverse-square neighborhood weights per material channel (skipping AIR/WATER) and normalizes per vertex; `TriplanarMaterial` sums weighted responses per channel and keeps `safeNormalize` for stability. Verified with `npm run build` and `npm run dev` (dev started on :3000 and was stopped after startup).
- 2026-03-XX: Ambient vegetation rendered invisible because `InstanceMatrixSetter` never attached to an `InstancedMesh` parent, so instance matrices stayed zeroed. Added a tiny helper primitive as an anchor to reach the parent and populate matrices; grass now spawns correctly. Verified with `npm run build` and `npm run dev` (dev on 127.0.0.1:3000, auto-stopped after timeout).
- 2026-02-XX: Fixed Dexie upgrade crash from changing the `modifications` primary key. `WorldDB` now detects the "Not yet support for changing primary key" `UpgradeError`, deletes the stale IndexedDB, and reopens with the composite `[chunkId+voxelIndex]` schema before any queries run; both save/read helpers await the ready promise to stop worker spam. Note: this wipes old mod data but prevents endless DexieError2 logs. Verified with `npm run build` and `npm run dev` (dev launched on :3000 then stopped after startup).
- 2026-01-XX: Fixed chaotic material blending in `TriplanarMaterial`. The root cause was biomes changing too rapidly per voxel, causing adjacent voxels to have incompatible materials that the mesher tried to blend. Fixed by:
  - **Biome smoothing**: Sample biome at coarser scale (every 4 voxels) instead of per-voxel to create smoother biome transitions
  - **Reduced biome noise frequency**: Changed TEMP_SCALE and HUMID_SCALE from 0.002 to 0.001 to create larger, more stable biome regions
  - **Removed weight warping**: Completely removed noise-based weight distortion in shader to prevent weak materials from being amplified
  - **Increased blend thresholds**: Raised threshold for including mat2/mat3 from 0.001 to 0.1 (10%) to ensure only significant materials contribute
  - **Mesher filtering**: Added filtering in mesher to remove materials with less than 1% of total weight before assignment, preventing noise from creating material mixing artifacts
  - **Adjacency constraint**: Added constraint to only allow blending between materials that are adjacent in ID space (max 2 ID difference), preventing distant materials (e.g., STONE and GRASS) from blending directly
  - **Reduced blend radius**: Reduced BLEND_RADIUS from 3 to 2 to make spatial blending more conservative
  This prevents the "mess of materials" visual artifact by ensuring biomes change smoothly rather than per-voxel.
- 2025-12-02: Reverted the hard snap change in `TriplanarMaterial` and restored the smooth material blender. Material IDs now use `flat` varyings and vertex normals are guarded against zero-length values to stop rainbow flicker and lighting glitches. Verified with `npm run build` and `npm run dev` (dev booted on port 3003 after 3000-3002 were busy; run was stopped after startup).
- 2025-01-XX: Fixed self-intersection artifacts (dark flickering patches) caused by `DoubleSide` rendering on pinched geometry. Changed `TriplanarMaterial` to `FrontSide` rendering and relaxed vertex clamp in mesher from `0.0/1.0` to `0.001/0.999` to prevent zero-area sliver triangles while maintaining hole closure. This eliminates Z-fighting between front/back faces and preserves proper triangle winding for normal calculation.
- 2025-11-24: Sunset color briefly flashed back to orange because `getSunColor` interpolated in the wrong direction when the sun dipped below the horizon (<0 normalized height). Added clamped interpolation that keeps fading the warm tones into night and remapped the sunrise band (0–0.2) to blend from sunset to day.
- 2025-11-24: Sun halo used a separate color ramp that could drift into cyan during midday. Added `getSunGlowColor` so the glow now derives from the actual sun color and only applies gentle warm/cool adjustments per phase.
- 2025-11-24: Fixed bouncing colors during sunset/sunrise. Previous logic in `getSkyGradient` and `getSunColor` had inconsistent ranges (some expecting 0.0 to be night, others sunset) causing visual jumps. Unified logic so: h < -0.15 is Night, -0.15 to 0.0 blends Night->Sunset, 0.0 to 0.3 blends Sunset->Day, >0.3 is Day.
- 2025-11-28: Replaced procedural `RootHollow` stump with `tree_stump.glb` via `useGLTF`. Model is box-fit and scaled to the previous 1.4u height target, re-centered so the base sits on y=0, set to front-side rendering with shadows to avoid Z-fighting, and collider dimensions derive from the scaled bounds. Asset loads through Vite’s `?url` import and is preloaded to avoid runtime fetch stalls; existing growth logic and terrain-normal alignment unchanged.
- 2025-11-28: Fractal tree now takes the stump’s radius to size its trunk: worker seeds with `baseRadius` so the first segment matches stump width, then radius decays faster than length to thin branches while trunk stays thick. Growth animation untouched; physics colliders still spawn only on thick branches.
- 2025-11-28: Added canopy point light that matches flora hue (`#E0F7FA`) at the tree’s top center; intensity ramps with growth (0→~0.9), subtle radius (distance 8, no shadows) to softly light surroundings as the tree appears.
- 2025-01-XX: Added `MoonFollower` component using simple "game physics" approach. Moon orbits exactly opposite to sun (angle + Math.PI) with same speed (0.025) to maintain perfect day/night synchronization. Moon is visible when above horizon and provides subtle cool blue-white light (intensity 0.2). Simple white sphere mesh for clean visibility.
- 2025-01-XX: Adjusted day/night cycle to make day longer (~70% of cycle) and night shorter (~30% of cycle). Implemented `calculateOrbitAngle` helper function that uses non-linear angle mapping: day portion (angles where sun is above horizon) is stretched to take up 70% of the cycle instead of 50%, while night portion moves faster. Applied to `SunFollower`, `MoonFollower`, and `AtmosphereController` to maintain synchronization.

- 2026-01-XX: Added spatial hashing utilities (`src/utils/spatial.ts`) and `WorldStore` state container (`src/state/WorldStore.ts`) to establish the chunk-based entity index. `App.tsx` currently logs store initialization for verification; wiring to gameplay systems planned for follow-up phases.
- 2026-01-XX: Migrated flora placement and consumption to `WorldStore` (see `FloraPlacer`, `RootHollow`, `VoxelTerrain`). GameManager now only tracks inventory; flora queries use chunk-indexed lookups for O(1) nearby searches.
- 2026-01-XX: Stabilized `FloraPlacer` rendering subscription by memoizing the Map->array conversion of WorldStore entities to prevent `useSyncExternalStore` snapshot churn and infinite render loops.
- 2025-12-02: Improved `FractalTree` look and animation.
  - **Leaves**: Added `OctahedronGeometry` leaves at branch tips (depth 8) using a separate `InstancedMesh`. Leaves are generated in `fractal.worker.ts` with random rotation/scale and passed as `leafMatrices`.
  - **Animation**: Enhanced `CustomShaderMaterial` shaders for both branches and leaves.
    - **Branches**: Added "elastic out" easing for a bouncy growth effect and improved the organic wobble.
    - **Leaves**: Added a "pop" effect where leaves scale up rapidly at the end of the growth cycle (0.8-1.0 progress).
  - **Verification**: Verified visual changes by temporarily spawning a tree and observing the animation. Build verified with `npm run build`.
- 2025-12-02: Merged the `ancestral-roots-visuals` refactor into `main`. Domain-driven layout under `src/core`, `src/features`, `src/state`, and `src/ui` is now canonical; legacy root `components/`, `services/`, and `workers/` files were removed or relocated.
- 2025-12-02: `npm run dev` starts Vite but the sandbox blocks `uv_interface_addresses` when binding to `0.0.0.0:3000`, so the server exits early after cycling ports. Run with elevated network permissions or outside the sandbox when a live preview is required.
- 2025-12-04: Implemented performant tree collisions. `TreeGeometryFactory` now extracts collision data (position/rotation/scale) for main branches (depth < 3) during generation. `TreeLayer` uses `InstancedRigidBodies` to render these as physics bodies.
- 2025-12-04: Fixed `InstancedRigidBodies` crash by wrapping a dummy invisible `InstancedMesh` inside it and using the `colliders` prop (`hull` for branches, `cuboid` for cactus) to generate shapes. This ensures compatibility with Rapier while keeping the visual scene optimized.

### 8. Gameplay Mechanics (New)
- **Tree Placement**: Implemented Jittered Grid Sampling in `terrainService.ts` to prevent tree clumping. Trees are now placed using a 4x4 voxel grid with random offsets, ensuring better distribution.
- **Luma Axe**:
  - **Acquisition**: Player must place "Luminous Flora" (found in caverns) into a "Root Hollow" to grow a "Flora Tree". Interacting (DIG) with the grown Flora Tree grants the `luma_axe`.
  - **Usage**: The `luma_axe` is required to cut down trees.
  - **Cutting Logic**: Trees now require 5 hits to be felled. Each hit shows particles. Without the axe, trees cannot be cut.
  - **Visualization**: A `FirstPersonTools` component renders the axe in the player's hand when equipped.
- **Inventory**: `InventoryStore` now tracks `hasAxe` and `luminousFloraCount`.
