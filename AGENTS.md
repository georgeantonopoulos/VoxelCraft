## Agent Notes for `VoxelCraft`

ALWAYS INSPECT CHANGES MAKE SURE NO BUGS SLIP. 
If doing a visual inspection always wait 10 seconds and use the controls to take 4 separate screenshots and analyse what changed. Update this doc (AGENTS.md) with your findings. 

Do not force GLSL version - there's a mix of them here and its working fine as it is. 

### 1. Project Overview
- **Tech Stack**: Vite + React + TypeScript + `three` / `@react-three/fiber`.
- **Physics**: `@react-three/rapier`.
- **Styling**: Tailwind CSS (via CDN in `index.html`).
- **Entry**: `index.tsx` -> `App.tsx`.

### 2. Core Architecture

#### File Structure
- `components/`: React components (Terrain, Player, UI, StartupScreen).
- `services/`: Singletons for logic (Terrain generation, Simulation, Metadata).
- `workers/`: Web Workers for heavy computation (Terrain generation, Simulation loop).
- `utils/`: Math helpers, Noise functions, Meshing algorithms.

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
- **Generation**: `TerrainService.generateChunk` uses 3D Simplex noise (`utils/noise.ts`) to create a density field.
  - **Density > ISO_LEVEL (0.5)** = Solid.
  - **Materials**: Determined by height, slope, and noise (Bedrock, Stone, Dirt, Grass, etc.).
- **Meshing**: `utils/mesher.ts` implements a Surface Nets-style algorithm (Dual Contouring variant) to generate smooth meshes from density data.
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
- **Atmosphere Controller**: `AtmosphereController` component manages fog, background, and hemisphere light colors.
  - **Dynamic Sky Colors**: Sky/fog colors transition smoothly based on sun position:
    - **Night** (sun below horizon): Dark blue/purple (`#2a2a4a`)
    - **Sunrise/Sunset** (sun near horizon): Warm orange/pink (`#ffb380`)
    - **Day** (sun high): Light blue (`#87CEEB`)
  - **Synchronized Updates**: Background color, fog color, and hemisphere light sky color all update together to maintain visual consistency.
  - **Ground Colors**: Hemisphere light ground color also adjusts for time of day (darker at night, warmer during sunrise/sunset).

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
  - Use `constants.ts` for magic numbers (Gravity, Speed, Chunk Size).
- **Particle System**:
  - **Critical Bug Fix**: Always initialize arrays of objects with individual instances (e.g., `Array.from({ length: n }, () => new Vector3())` instead of `Array(n).fill(new Vector3())`). Using `fill()` creates shared references causing all particles to share the same velocity/state.
  - **Timeout Management**: Use refs to track `setTimeout` IDs and clear them before setting new ones to prevent race conditions when rapid interactions occur.

### 5. Environment
- **Env Vars**: `vite.config.ts` maps `.env.local` vars (like `GEMINI_API_KEY`) to `process.env`.
- **Dev Server**: `npm run dev` on port 3000.

### 6. Visual Artifacts & Solutions
- **Triangle Artifacts**: Terrain previously used `flat` shading, causing hard triangle edges.
- **Solution (Phase 2 - Blend Weights)**:
  - **Dual Material Data**: The mesher (`mesher.ts`) now calculates the two most frequent materials in a voxel cell (`materials` and `materials2`) and a blend weight.
  - **Interpolation**: The shader uses `flat` varyings for the material IDs (to prevent ID interpolation artifacts) but interpolates the `blendWeight`.
  - **Mixing**: The fragment shader samples material properties for both IDs and mixes them using the interpolated weight, creating smooth transitions between distinct material types (e.g., Stone to Grass).
  - **Safe Normalization**: `safeNormalize` is retained to prevent NaNs from degenerate normals.
