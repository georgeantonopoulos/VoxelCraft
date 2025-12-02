## Agent Notes for `VoxelCraft`

ALWAYS INSPECT CHANGES MAKE SURE NO BUGS SLIP. 
If doing a visual inspection always wait 10 seconds and use the controls to take 4 separate screenshots and analyse what changed. Update this doc (AGENTS.md) with your findings. 

Do not force GLSL version - there's a mix of them here and its working fine as it is. 
Do not remove comments, add them if missing. 

Always verify and run npm run build and npm run dev to make sure the app is working as expected. 


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
- **Physics**: Chunks are `fixed` rigid bodies with `trimesh` colliders. Player is a `dynamic` capsule.
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
- **RootHollow**: Procedurally generated hollow stump component with organic root flares.
  - **Geometry**: Open-ended `CylinderGeometry` (topRadius: 1.0, bottomRadius: 1.3, height: 1.4) with high-density segments (64 radial, 24 height) for FBM detail.
  - **Surface Normal Alignment**: Calculates terrain surface normal via central differences on density field during generation. Uses `Quaternion.setFromUnitVectors` to align stump's local Y-axis perpendicular to terrain surface, eliminating "floating" artifacts on slopes.
  - **FBM Shader**: Fractal Brownian Motion (`fbm`) function in vertex shader iterates noise at increasing frequencies (3 octaves) to create intricate, gnarly bark ridges and organic root displacement.
  - **Root Flares**: Vertex shader uses `sin(angle * 5.0)` with FBM distortion to create 5-point star pattern root "toes" at the base with exponential falloff and high-frequency detail.
  - **Procedural Texturing**: Fragment shader uses multi-octave noise sampling for bark texture, `gl_FrontFacing` to differentiate outer bark vs inner hollow (darker rotting wood), and moss layer on upward-facing surfaces with slope-based coverage.
  - **Physics**: `CylinderCollider` with `fixed` RigidBody for performance-friendly collision blocking.
  - **Placement**: Generated by `TerrainService.generateChunk` in relatively flat valley areas (continental < 0.0, mountains < 1.5, maxHeightDiff < 3.5) with ~25% spawn rate. Surface normal calculated and passed as 6-tuple (x, y, z, nx, ny, nz) instead of 3-tuple position.
  - **Critical Fixes**: 
    - Quaternion alignment must be memoized (`useMemo`) to prevent re-calculation on every render.
    - Varying names must be unique (e.g., `vStumpWorldPos`, `vStumpNormal`) to avoid conflicts with base material's built-in varyings.
    - Roots embedded at `wy - 0.8` to extend underground.
    - Time uniform updated via ref in `useFrame` for animated root detail variation.

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
- **Solution (Phase 2 - Blend Weights)**:
  - **Tri-Material Data**: The mesher (`mesher.ts`) calculates the three most frequent materials among the 8 corner voxels of each cell (`materials`, `materials2`, `materials3`) and blend weights proportional to frequency.
  - **Interpolation**: The shader uses `flat` varyings for the material IDs (to prevent ID interpolation artifacts) but interpolates the `blendWeight` (vec3).
  - **Mixing**: The fragment shader samples material properties for all three IDs and mixes them using soft-max blended weights with noise distortion, creating smooth organic transitions between material types (e.g., Stone to Grass to Dirt).
  - **Safe Normalization**: `safeNormalize` is retained to prevent NaNs from degenerate normals.
- **Self-Intersection Artifacts (Dark Flickering Patches)**:
  - **Root Cause**: `DoubleSide` rendering on pinched geometry (sliver triangles from vertex clamping) causes Z-fighting between front and back faces, creating dark flickering squares.
  - **Solution**: 
    - **Front-Side Rendering**: Changed `TriplanarMaterial` to `side={THREE.FrontSide}` to eliminate backface Z-fighting artifacts.
    - **Soft Vertex Clamp**: Relaxed vertex clamp in `mesher.ts` from `0.0/1.0` to `0.001/0.999` to prevent zero-area sliver triangles while still closing holes. This preserves triangle winding direction for proper normal calculation.
    - **Shadow Bias**: Already configured (`shadow-bias={-0.001}`, `shadow-normalBias={0.08}`) to prevent shadow acne with front-side rendering.

### 7. Recent Findings
- 2025-01-XX: Fixed self-intersection artifacts (dark flickering patches) caused by `DoubleSide` rendering on pinched geometry. Changed `TriplanarMaterial` to `FrontSide` rendering and relaxed vertex clamp in mesher from `0.0/1.0` to `0.001/0.999` to prevent zero-area sliver triangles while maintaining hole closure. This eliminates Z-fighting between front/back faces and preserves proper triangle winding for normal calculation.
- 2025-11-24: Sunset color briefly flashed back to orange because `getSunColor` interpolated in the wrong direction when the sun dipped below the horizon (<0 normalized height). Added clamped interpolation that keeps fading the warm tones into night and remapped the sunrise band (0–0.2) to blend from sunset to day.
- 2025-11-24: Sun halo used a separate color ramp that could drift into cyan during midday. Added `getSunGlowColor` so the glow now derives from the actual sun color and only applies gentle warm/cool adjustments per phase.
- 2025-11-24: Fixed bouncing colors during sunset/sunrise. Previous logic in `getSkyGradient` and `getSunColor` had inconsistent ranges (some expecting 0.0 to be night, others sunset) causing visual jumps. Unified logic so: h < -0.15 is Night, -0.15 to 0.0 blends Night->Sunset, 0.0 to 0.3 blends Sunset->Day, >0.3 is Day.
- 2025-11-28: Replaced procedural `RootHollow` stump with `tree_stump.glb` via `useGLTF`. Model is box-fit and scaled to the previous 1.4u height target, re-centered so the base sits on y=0, set to front-side rendering with shadows to avoid Z-fighting, and collider dimensions derive from the scaled bounds. Asset loads through Vite’s `?url` import and is preloaded to avoid runtime fetch stalls; existing growth logic and terrain-normal alignment unchanged.
- 2025-11-28: Fractal tree now takes the stump’s radius to size its trunk: worker seeds with `baseRadius` so the first segment matches stump width, then radius decays faster than length to thin branches while trunk stays thick. Growth animation untouched; physics colliders still spawn only on thick branches.
- 2025-11-28: Added canopy point light that matches flora hue (`#E0F7FA`) at the tree’s top center; intensity ramps with growth (0→~0.9), subtle radius (distance 8, no shadows) to softly light surroundings as the tree appears.
- 2025-01-XX: Added `MoonFollower` component using simple "game physics" approach. Moon orbits exactly opposite to sun (angle + Math.PI) with same speed (0.025) to maintain perfect day/night synchronization. Moon is visible when above horizon and provides subtle cool blue-white light (intensity 0.2). Simple white sphere mesh for clean visibility.
- 2025-01-XX: Adjusted day/night cycle to make day longer (~70% of cycle) and night shorter (~30% of cycle). Implemented `calculateOrbitAngle` helper function that uses non-linear angle mapping: day portion (angles where sun is above horizon) is stretched to take up 70% of the cycle instead of 50%, while night portion moves faster. Applied to `SunFollower`, `MoonFollower`, and `AtmosphereController` to maintain synchronization.
- 2025-01-XX: Implemented `RootHollow` component - procedurally generated hollow stump with vertex-displaced root flares. Replaced sphere-based geometry with open-ended cylinder using `CustomShaderMaterial` with vertex/fragment shaders for organic root displacement and procedural bark/moss texturing. Fixed shader varying name conflicts (`vNormal`, `vWorldPos` renamed to `vStumpNormal`, `vStumpWorldPos`) and memoized rotation to prevent re-rotation on render. Roots spawn in flat valley areas via `TerrainService` with debug logging for placement tracking.
- 2025-01-XX: Upgraded `RootHollow` with surface normal alignment and FBM shader. Fixed "floating" artifact by calculating terrain surface normals via central differences on density field during generation. Stumps now align perpendicular to terrain surface using `Quaternion.setFromUnitVectors`, allowing proper placement on slopes. Added Fractal Brownian Motion (FBM) in vertex shader (3 octaves) for intricate, gnarly bark ridges and organic root detail. Increased geometry density to 64 radial and 24 height segments to support FBM displacement. Updated placement conditions to allow slopes up to 3.5 units height difference. Changed data structure from 3-tuple (position) to 6-tuple (position + normal) in `TerrainService` and `VoxelTerrain`.
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
