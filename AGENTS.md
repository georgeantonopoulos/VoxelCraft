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
  - **Caverns**: Stateless "Noodle" Algorithm using domain-warped 3D ridged noise (`abs(noise) < threshold`) in `TerrainService.ts`. Configured per-biome via `BiomeManager.ts`.
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

- 2025-12-14: Fixed LumaSwarm particle animation not appearing when flora is placed in RootHollow.
  - **Root Cause 1**: The `elapsed` time was stored in React state (`useState`) but updated inside `useFrame`. Because React state updates are asynchronous, the shader uniform `uProgress` was always reading the stale value (0), so particles never animated from their random start positions to form the shape.
  - **Root Cause 2 (Critical)**: The setTimeout in `RootHollow` was being cleared prematurely due to React Strict Mode causing double-mounts in development. Each time the component re-rendered, the old timer was cleared and a new one started, but because of the nested setTimeout for dissipation, the status was changing from CHARGING → GROWING almost immediately instead of waiting the full 10 seconds.
  - **Fix 1**: Changed `elapsed` from state to a ref (`elapsedRef`) for synchronous updates in `useFrame`.
  - **Fix 2**: Moved timer cleanup logic into refs (`growTimerRef`, `dissipateTimerRef`) and added proper cleanup in the useEffect return. Now timers are explicitly cleared before creating new ones, preventing race conditions.
  - **Additional Fixes**: 
    - Added Suspense boundary around LumaSwarm in RootHollow with a bright magenta fallback sphere to debug texture loading issues
    - Added texture preloading with `useLoader.preload(THREE.TextureLoader, lumaShapeUrl)` to avoid suspension during gameplay
    - Added comprehensive debug console logging to track component mounting, texture loading, particle count, state transitions, and timer lifecycle
  - **Debugging**: Console logs now show:
    - `[RootHollow] Flora detected and stationary, triggering CHARGING`
    - `[RootHollow] Starting 10 second particle formation timer`
    - `[LumaSwarm] Component mounted, dissipating: false`
    - `[LumaSwarm] Processing texture, size: 2656 x 1600` (confirms texture loaded)
    - `[LumaSwarm] Particle count: 1868` (confirms particles generated)
    - `[LumaSwarm] Rendering with 1868 particles` (confirms rendering)
    - `[RootHollow] Timer complete, transitioning to GROWING` (after 10 seconds)
  - **Verification**: Ran `npm run build` (success). Visual inspection required in-game: place flora in a RootHollow and confirm particles swirl from a random cloud into the cyan shape over 10 seconds, then dissipate when tree growth starts.

- 2025-12-14: Follow-up — LumaSwarm not visible due to debug leftovers in `LumaSwarm.tsx`.
  - **Root Cause 1**: The shader material was effectively disabled (the `CustomShaderMaterial` block was wrapped in a comment and the instanced mesh used a simple `meshStandardMaterial`), so no formation animation could run.
  - **Root Cause 2 (Critical)**: `debugSphere` was referenced but not defined, which breaks compilation and prevents the effect from rendering at all.
  - **Root Cause 3**: The vertex shader was setting `csm_Position = pos`, which collapses each particle sphere into a single point; it now offsets with `csm_Position = position + pos`.
  - **Fix**: Restored `CustomShaderMaterial`, defined `debugSphere`, gated debug logs behind constants, and made dissipation direction safe when `pos` is near-zero.
  - **Verification**: Ran `npm run build` (success) and started `npm run dev` (server ready on `http://127.0.0.1:3000/`, stopped by CLI timeout). Visual inspection still required: wait 10 seconds then take 4 screenshots while placing flora in a RootHollow and confirm the swirl/formation is clearly visible.

- 2025-12-14: LumaSwarm spread phase now fills “tree space” before forming the PNG silhouette.
  - **Issue**: The random start positions were confined near the core (small luma ball area), so the swarm never occupied the volume of a fully-grown flora tree during the initial “charging” phase.
  - **Fix**: Added an explicit shader staging step in `LumaSwarm.tsx`:
    - **Phase 1 (Emit/Spread)**: Particles originate at the core and expand upward into a tall volume (`EMIT_HEIGHT`) with wide horizontal spread (`EMIT_RADIUS`) and a subtle swirl.
    - **Phase 2 (Form PNG)**: Particles converge from the spread volume into the existing PNG silhouette as `uProgress` approaches 1.
  - **Verification**: Ran `npm run build` (success) and started `npm run dev` (server ready on `http://127.0.0.1:3000/`, stopped by CLI timeout). Visual inspection required: wait 10 seconds then take 4 screenshots during RootHollow charging to confirm the upward spread is visible before the silhouette forms.

- 2025-12-14: Follow-up — fixed LumaSwarm shader compile error after adding spread phase.
  - **Root Cause**: GLSL `vec3(...)` constructor was given a `vec2` plus two floats (too many args), which prevented the vertex shader from compiling and made the swarm invisible.
  - **Fix**: Build `spreadPos`/`spreadEndPos` via `vec3(0.0)` then assign `.xz` and `.y` explicitly.
  - **Verification**: Ran `npm run build` (success) and started `npm run dev` (server ready on `http://127.0.0.1:3000/`, stopped by CLI timeout). Visual inspection required: confirm no shader compile errors and particles render again.

- 2025-12-14: LumaSwarm tuning — smaller particles, higher/longer spread, more chaos before converging.
  - **Issue**: Particles were visually too large and converged too quickly/cleanly, with minimal upward travel.
  - **Fix**: Tuned `LumaSwarm.tsx`:
    - Reduced `PARTICLE_SIZE` to `0.015` (1/10th).
    - Increased spread height to `EMIT_HEIGHT = 80.0` and extended the spread window (`EMIT_PHASE = 0.55`).
    - Added time-varying per-particle flutter during spread and residual jitter during the convergence phase (fades out as the silhouette “locks in”).
    - Only billboard the swarm to the camera once convergence begins (keeps the initial spread truly “upwards”).
  - **Verification**: Ran `npm run build` (success) and started `npm run dev` (server ready on `http://127.0.0.1:3000/`, stopped by CLI timeout). Visual inspection required: wait 10 seconds then take 4 screenshots during RootHollow charging to confirm the spread fills the tree volume, looks chaotic, then converges to the PNG.

- 2025-12-14: LumaSwarm tuning — faster initial velocity + stronger turbulence/spiral motion.
  - **Issue**: The initial spread felt too slow and too “orderly” (not enough per-particle velocity variance, turbulence, or spiraling).
  - **Fix**: Updated the spread-phase shader in `LumaSwarm.tsx`:
    - Switched to a faster ease-out (`spreadEase`) so particles accelerate upward/outward sooner.
    - Added per-particle spiral motion with randomized `spinSpeed` and time-based rotation (`rot2(angle) * dir2`).
    - Increased turbulence by combining multiple hash-noise sources (`flutterA`/`flutterB`) and raising `EMIT_JITTER` to `4.0`.
    - Added 3D thickness during spread (Z motion), while still converging to the PNG plane during formation.
  - **Verification**: Ran `npm run build` (success) and started `npm run dev` (server ready on `http://127.0.0.1:3000/`, stopped by CLI timeout). Visual inspection required: place flora in RootHollow and confirm particles rocket upward with visible swirl/turbulence before converging.

- 2025-12-14: LumaSwarm scale fix — prevent instance scaling from shrinking the whole swarm volume.
  - **Issue**: Particles appeared “clamped” close to the core and the PNG silhouette collapsed back into the luma ball area. Root cause was that the instanced mesh `instanceMatrix` scaling (used to size each particle) was also scaling the shader-driven positional offsets, shrinking the entire swarm’s spread/target space.
  - **Fix**: `LumaSwarm.tsx` now keeps instance matrices identity and sets particle size via the sphere geometry radius (`sphereGeometry args={[PARTICLE_SIZE, ...]}`), so shader offsets remain in true world units.
  - **Additional**: Scaled the PNG target positions to an estimated full RootHollow flora-tree volume (`~9.1` units tall, `~6.0` wide, based on `fractal.worker.ts` type=0 parameters) and anchored the silhouette Y at the base (0..height).
  - **Verification**: Ran `npm run build` (success) and started `npm run dev` (server ready on `http://127.0.0.1:3000/`, stopped by CLI timeout). Visual inspection required: confirm spread and silhouette occupy the full tree-sized space and do not collapse back into the core.

- 2025-12-13: Fixed `refreshFogUniforms` crash from `FogDeer` shader material.
  - **Root Cause**: Three.js will call `refreshFogUniforms()` whenever `material.fog === true`; if a `ShaderMaterial` lacks `fogColor/fogNear/fogFar` uniforms, it can crash with `Cannot read properties of undefined (reading 'value')`.
  - **Fix**: `src/features/creatures/FogDeer.tsx` now clones `THREE.UniformsLib.fog` explicitly into the shader uniforms and defensively ensures `fogColor/fogNear/fogFar` exist before the first program compile.
  - **Verification**: Ran `npm run build` (success) and `npm run dev -- --host 127.0.0.1 --port 3000` (server ready on `http://127.0.0.1:3000/`, stopped after ~20s by CLI timeout). Visual inspection required: confirm the console error is gone and fog deer silhouettes still render in the distance.

- 2025-12-13: Added `?vcDeerNear` debug mode to spawn FogDeer close to the player at game start for easy visual verification.
  - **Debug**: `http://127.0.0.1:3000/?vcDeerNear` spawns deer in a close annulus (~7–14 units) immediately after the first `player-moved` signal, instead of in the mid/far fog band. (Typo alias supported: `?vcDeerNeer`.)
  - **Debug**: `http://127.0.0.1:3000/?vcDeerStatic` forces a single "inspection" deer ~6 units in front of the camera so you can see the silhouette immediately.
  - **Fix**: Deer were visually “sinking” into the terrain because the instanced plane was positioned by its center. `FogDeer` now stores `py` as the sampled surface height (“feet Y”) and renders at `feetY + DEER_HEIGHT/2` so the bottom edge sits on the terrain.
  - **Verification**: Ran `npm run build` (success) and `npm run dev -- --host 127.0.0.1 --port 3000` (server ready on `http://127.0.0.1:3000/`, stopped after ~20s by CLI timeout). Visual inspection required: confirm the deer silhouettes are visible near spawn and the fog-uniform console error remains gone.

- 2025-12-13: Fixed firefly Y-axis instability and deer visibility issues.
  - **Firefly Y-Jumping**: `AmbientLife.tsx` `refreshForAnchor` was using `playerRef.current.y` to compute `baseY`, causing fireflies to rapidly move vertically when the player moved. Fixed by making fireflies strictly terrain-relative with a stable height offset based on their phase seed.
  - **Firefly Scale**: Reduced `BASE_RADIUS` from 0.07 to 0.035 for smaller, subtler appearance.
  - **Firefly Distribution**: Removed cave boost logic that was spawning them "everywhere". Now only spawn in biomes with positive `biomeFireflyFactor` (GROVE, JUNGLE, BEACH, PLAINS, MOUNTAINS).
  - **Deer Visibility**: Deer were spawning too far (65-92% of fog distance) and were too small. Fixed by bringing spawn range closer (40-70%), increasing count from 3 to 5, increasing size from 2.2x3.0 to 3.0x4.0 units, and slightly brightening the silhouette color.
  - **Verification**: Ran `npm run build` (success). Visual inspection required: walk around THE_GROVE biome, confirm fireflies hover stably above terrain without jumping, and deer silhouettes are visible in the mid-distance fog band.

- 2025-12-13: Changed flora pickup + placement hotkeys, and added world torch placement.
  - **Pickup**: Flora is no longer harvested via DIG (which could grab multiple nearby). New `Q` hotkey performs a single-target ray pickup (placed `FLORA` entities + generated lumina flora), increments flora count, and plays a fly-to-player pickup effect. Generated lumina removal now “hides” a single instance (keeps array length stable) and `LuminaLayer` uses deterministic per-instance transforms so other bulbs don’t reshuffle on pickup.
  - **Placement**: `E` now places the currently selected inventory item. If the torch slot is selected, a world-placed torch is spawned and oriented to face away from the hit surface normal; if the flora slot is selected, one flora is consumed and placed as before.
  - **Fix**: Terrain placement raycasts now reliably detect chunk terrain meshes because `ChunkMesh` tags the actual terrain render mesh with `userData.type = 'terrain'` (not just the physics `RigidBody`).
  - **Fix**: `E` placement no longer requires pointer-lock (it only ignores text inputs). Placing a torch now switches selection back to slot 1 so the torch visibly “disconnects” from the player’s hand after being placed.
  - **Debug**: Added `?debug` placement tracing: `FloraPlacer` listens for `E` in capture phase (so it still fires if other systems stop propagation) and emits `vc-placement-debug` events; HUD shows a short-lived `place:` line with the latest status (key received / terrain targets / intersects / hit).
  - **Debug**: Placement tracing can also be enabled without URL params by setting `localStorage.vcDebugPlacement = "1"` or `window.__vcDebugPlacement = true` (useful if query params aren’t being used while testing).
  - **Inventory Rules**: Player starts with `1` torch; torches are now consumed on placement and can be picked back up with `Q`. Torch/flora slots only appear when their counts are >0, and mouse-wheel scrolling skips empty slots so a depleted torch won’t show up again.
  - **UI**: Inventory bar now shows a flora icon in slot 3 with a stack count; HUD controls text updated (E place selected, Q pick up flora).
  - **Verification**: Ran `npm run build` (success) and `npm run dev -- --host 127.0.0.1 --port 3000` (server ready on `http://127.0.0.1:3000/`, stopped after ~12s by CLI timeout). Visual inspection required: wait 10 seconds, then take 4 screenshots while (1) placing the starting torch with `E` (torch disappears from hotbar/scroll when count hits 0, placed light remains), (2) picking it back up with `Q` (torch returns to hotbar, flies to player), (3) confirming flora slot is hidden until you pick up flora, (4) confirming scroll wheel skips empty slots.

- 2025-12-13: Held flora visuals + RootHollow-grown tree collision fix.
  - **Held Flora**: When the flora slot is selected, a lightweight `FloraTool` (textured quad using the inventory icon) now shows in the left hand using the exact same pose/animation as the held torch (swapped inside `FirstPersonTools`).
  - **Collision**: Fixed `FractalTree` collider placement by keeping branch/leaf colliders in local space (avoids double-applying the RootHollow parent transform). This restores solid collision for RootHollow-grown flora trees while keeping the sensor canopy collider for axe unlock logic.
  - **Verification**: Ran `npm run build` (success) and `npm run dev -- --host 127.0.0.1 --port 3000` (server ready on `http://127.0.0.1:3000/`, stopped after ~12s by CLI timeout). Visual inspection required: confirm (1) selecting flora shows it in-hand at the torch position, and (2) you can collide with the grown flora tree trunk/branches after it finishes growing.

- 2025-12-13: Fixed inventory UI + scroll selection not working. Root cause: inventory wheel handling lived inside `FirstPersonTools`, which can be suspended (GLTF load) and therefore never attach the `wheel` listener; also slot selection didn’t drive `currentTool`, so scrolling couldn’t equip the axe for tree cutting. Fixes: added `InventoryInput` (DOM-side) to handle mouse wheel + 1–5 hotkeys while pointer-locked; updated `InventoryStore` to sync `currentTool` from slot selection; tuned default slots so Torch is in slot 2 while the game starts on slot 1 (empty/none). Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (auto-selected :3001). Visual inspection not performed here: confirm the bar renders bottom-left and scrolling/1–5 changes selection and toggles the torch tool visibility.

- 2025-12-13: Fixed fog affecting sky elements (sun/moon). The moon mesh and SkyDome shader material were missing `fog={false}`, causing Three.js scene fog to blend over them and hide them from view. Added `fog={false}` to the moon's `meshBasicMaterial` and the SkyDome's `shaderMaterial`. The sun and its glow already had `fog={false}` set correctly. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully. Visual inspection required: confirm the sun and moon are now visible in the sky without fog affecting them.

- 2025-12-13: Follow-up streaming stutter fix. After restoring the simpler world generation pipeline, a tiny stutter remained when new chunks arrived. Root causes: (1) `ChunkMesh` computed a shoreline SDF mask on the main thread using a double-BFS flood-fill (O(n²) per chunk) inside `useMemo`, blocking React render; (2) all chunk generation requests were sent to the worker at once, causing batches of "GENERATED" messages to arrive simultaneously, each triggering geometry/collider work. Fixes: (a) moved shoreline SDF computation into `mesher.ts` (runs in worker), added `waterShoreMask` to `MeshData`/`ChunkState`, and `ChunkMesh` now just wraps the pre-computed mask in a `DataTexture`; (b) throttled chunk generation to 1 request per frame (with nearest-to-player priority) so worker responses arrive spread out. Verified `npm run build` succeeds. Validate in-game that stutter is reduced.

- 2025-12-13: Performance regression investigation (streaming "lag" after 8d1ef30). Found a likely stutter source: `VoxelTerrain` tracked `playerChunk` in React state and passed it into every `ChunkMesh` to toggle collider creation near the player. Each time the camera crossed a chunk boundary this triggered a full re-render of all chunk meshes, which can look like persistent hitching. Restored the simpler `8d1ef30`-style world generation pipeline by switching back to the single `terrain.worker.ts` in `VoxelTerrain` and removing the `playerChunk` / `playerCx` / `playerCz` collider-gating props. Chunks now don't re-render on chunk-boundary transitions; physics colliders are always present again (as before). Verified `npm run build` succeeds; `npm run dev` cannot bind in the sandbox (`EPERM`), so runtime perf should be validated locally.

- 2025-12-12: Removed per-chunk opacity fading (was causing noticeable lag/hitches). `src/features/terrain/components/ChunkMesh.tsx` no longer drives a per-frame `opacityRef` or passes fade props; `src/core/graphics/TriplanarMaterial.tsx`, `src/features/terrain/components/VegetationLayer.tsx`, `src/features/terrain/components/TreeLayer.tsx`, `src/features/terrain/components/LuminaLayer.tsx`, `src/features/terrain/materials/WaterMaterial.tsx`, and `src/features/flora/components/RootHollow.tsx` no longer toggle transparency/opacity for chunk fade. Instead, we rely on fog + a shorter effective view distance: `src/App.tsx` reduces default fog far (120→90) and camera far (400→220) to keep chunk generation inside fog. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~25s by CLI timeout). Visual inspection required: wait 10s then take 4 screenshots while walking toward the fog boundary to confirm (1) no stutter spikes during chunk loads, (2) terrain/veg/trees/lumina/root hollows no longer fade (hard pop should be hidden by fog), (3) fog distance feels right (no “visible wall”), (4) no new sorting artifacts from transparency removal.

- 2025-12-12: Fog-coupled fade to hide pop-in. `src/features/terrain/components/ChunkMesh.tsx` now computes an additional distance-based fade from the active Three fog (near/far) and multiplies it with the chunk’s time fade; this combined opacity is applied to terrain, water, vegetation, trees, and lumina so far content blends into the sky instead of popping. `src/features/terrain/components/VoxelTerrain.tsx` records `spawnedAt` on chunk creation and applies the same fade math to `RootHollow` instances; `src/features/flora/components/RootHollow.tsx` now supports an `opacity` prop and propagates it to GLB materials. Updated `src/features/terrain/components/VegetationLayer.tsx`, `src/features/terrain/components/TreeLayer.tsx`, and `src/features/terrain/components/LuminaLayer.tsx` to accept `opacity` and render transparently when fading. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~20s by CLI timeout). Visual inspection required: wait 10s then take 4 screenshots while walking toward render-distance boundary to confirm terrain/trees/veg/lumina/root hollows fade into fog smoothly with no obvious pop.

- 2025-12-12: Tailwind production fix + shader compile fixes + IBL tuning. Removed `cdn.tailwindcss.com` and switched to a local Tailwind v4 PostCSS pipeline (`postcss.config.cjs` uses `@tailwindcss/postcss`, added `tailwind.config.cjs`, added `src/index.css` importing `tailwindcss`, imported from `src/index.tsx`, and removed the CDN script from `index.html`). Fixed GLSL shader compile errors caused by reserved identifiers in `src/core/graphics/TriplanarMaterial.tsx` (`flat`→`flatness`, `patch`→`patchiness`). Tuned dynamic sky IBL to prevent overexposure by applying a conservative, time-of-day-aware global `envMapIntensity` multiplier in `src/core/graphics/DynamicEnvironmentIBL.tsx` (also forces low intensity underground via `RoomEnvironment`) and wiring `TriplanarMaterial` to respect `scene.userData.vcEnvIntensity` instead of hard-coding a high value. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~20s by CLI timeout). Visual inspection required: wait 10 seconds, then take 4 screenshots: (1) intro/world-select UI (Tailwind styles restored), (2) midday surface (no overexposed washout; specular feels present but controlled), (3) cave interior (no “bright sky” reflections deep underground), (4) sunrise/sunset sweep (IBL response changes smoothly; check for shimmer/regressions).

- 2025-12-12: Particle responsiveness + look pass: `src/features/terrain/components/VoxelTerrain.tsx` particles now spawn on/just above the surface (not at the dig brush center which could be inside terrain), so bursts should reliably be visible when digging. Added particle “modes”: debris (dig/build/vegetation/tree hits) and spark (failed digs like bedrock/clunk). Improved motion with outward ejection direction (toward camera), drag, gravity tuning, and fade via scale; disabled frustum culling for the particle instanced mesh to avoid rare cull cases. Also removed per-burst `Vector3` allocations to reduce GC hitches that can drop bursts. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~12s by CLI timeout). Visual inspection required: wait 10 seconds, then take 4 screenshots: (1) repeated rapid digs on a beach slope (particles should always show and read as sandy), (2) dig stone in a cave wall (debris visible + less “inside surface”), (3) clunk/bedrock hit (spark burst should be brighter and shorter), (4) chop vegetation/tree trunk (debris should spray outward, not vanish).
- 2025-12-12: Interaction feel pass: digging/building now feels more “connected” to the world. Changes: `src/features/terrain/components/VoxelTerrain.tsx` samples the hit voxel material so DIG impact particles reflect sand/stone/etc (not always dirt), BUILD defaults to “smart” material (if still on the default STONE and no recent hotkey selection it builds what you’re aiming at), and successful/failed impacts emit a `window` event (`tool-impact`) that drives UI/tool feedback. `src/features/interaction/components/FirstPersonTools.tsx` listens to `tool-impact` to sync pickaxe swing + recoil to *actual* terrain hits (and clunks), not just mouse input. `src/ui/HUD.tsx` flashes the crosshair on impacts and tints red on failures; `index.html` adds a crosshair hit style + CSS variable. Also fixed the particle shared-`Vector3` init footgun in `VoxelTerrain.tsx` (per particle-system guideline). Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection required: wait 10 seconds, then take 4 screenshots while (1) digging sand on beaches, (2) digging stone in caves, (3) building without pressing 1–4 (should place the aimed material, not always stone), and (4) clunking bedrock/tree-root block (crosshair should flash red and pickaxe should recoil).
- 2025-12-12: Beach follow-up fix: Terrain generation was still using `BiomeManager.getBiomeFromClimate(...)` directly, so the new `BEACH` intercept in `getBiomeAt(...)` never affected terrain materials (hence no sand at shorelines). Added `BiomeManager.getBiomeFromMetrics(...)` and updated `src/features/terrain/logic/terrainService.ts` to use it while preserving existing Y-dither for temp/humid and column-constant continent/erosion for coherent coasts. Also increased beach sand cap thickness (6..8 voxels) so neighborhood-splatted material weights still read as sand on smooth meshes. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~12s via scripted SIGINT). Visual inspection still required: wait 10s and take 4 screenshots along multiple shorelines to confirm sand is now clearly visible and does not paint far inland.
- 2025-12-12: Added a new shoreline biome `BEACH` driven by physical climate metrics (continentalness + erosion) so coasts can render as sand without disturbing existing temperature/humidity biomes. Changes: `src/features/terrain/logic/BiomeManager.ts` adds `BEACH` classification (`continent` in `(-0.05..0.18)`, `erosion01 < 0.45`, and not frozen), maps surface material to `SAND`, and adds a cave settings entry; `src/features/terrain/logic/VegetationConfig.ts` makes beaches mostly empty with very sparse dune grass/shrub and allows sparse `PALM` trees; `src/features/terrain/logic/terrainService.ts` tree spawner now honors `getTreeForBiome(...) === null` (skip) and uses a higher `treeThreshold` for beaches; `src/features/terrain/workers/terrain.worker.ts` reduces beach ambient vegetation density to avoid expensive surface scans. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~12s via scripted SIGINT). Visual inspection (10s wait + 4 screenshots) still required in-game to confirm beach placement looks correct at shorelines (sand band, no unwanted palms inland, no vegetation spam).
- 2025-12-12: Fixed new chunk-edge *gap/crack* introduced by the mesher’s max-boundary inward clamp. `src/features/terrain/logic/mesher.ts` now allows the MAX border to land on the exact chunk boundary again (`maxBoundaryInset = 0.0`) while still clamping vertices to the chunk’s legal range. This removes the visible seam opening between adjacent chunks (the prior inset caused both chunks to clamp inward, creating a crack). Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection (10s wait + 4 screenshots) still required in-game to confirm: (1) crack is gone, and (2) any prior Z-fighting shimmer from overlap does not return; if shimmer returns, toggle `?debug` → Terrain Polygon Offset to confirm overlap vs shading.
- 2025-12-12: Attempted a more fundamental “perfect seam” fix for cases where you can see *behind* the mesh along chunk borders (true holes). Root cause is typically seam *ownership*: the MIN border is skipped (loop starts at `PAD`), but the MAX border also wasn’t emitting certain quads, so neither chunk generated triangles on the shared plane. `src/features/terrain/logic/mesher.ts` quad generation now emits quads on the MAX X/Z borders (using PAD neighbor samples) so exactly one chunk owns the seam plane (no overlap, no hole). Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection (10s wait + 4 screenshots) required to confirm the seam is watertight in motion.
- 2025-12-12: Investigated persistent “see into caverns” cracks that indicate *real missing geometry* rather than shading. Found a likely root cause in `src/features/terrain/logic/terrainService.ts`: generation applied a large “GEN HYSTERESIS” band around `ISO_LEVEL` using `SNAP_EPSILON` (default `0.1`), which can shift the SDF near the surface and lead to chunk-border discontinuities (true holes) even when world-space noise is continuous. Replaced it with a tiny deterministic nudge (`ISO_NUDGE = 0.0001`) keyed from `(wx,wy,wz)` so both sides of a chunk border make the exact same tie-break decision. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection (10s wait + 4 screenshots) still required to confirm crack closure in-game.
- 2025-12-12: Follow-up on persistent *true holes* along chunk borders (seeing into caverns). The prior “no-overlap” fix clamped Surface-Nets vertex positions into `[0..CHUNK_SIZE]`, but Surface Nets can legitimately place border-adjacent vertices slightly outside the chunk due to edge-intersection averaging. Hard clamping can therefore *cut the surface* at the border and create missing geometry. `src/features/terrain/logic/mesher.ts` now uses snap-only near borders (no clamping) to keep the surface continuous; seam closure should be handled by index emission/ownership and overlap mitigation can be probed via `?debug` polygon offset. Also restored `SNAP_EPSILON` import in `src/features/terrain/logic/terrainService.ts` because `modifyChunk(...)` still uses it for edit-time snapping. Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection (10s wait + 4 screenshots) required to confirm hole closure vs returning seam Z-fighting.
- 2025-12-12: Overlap/Z-fighting returned after removing border clamping (expected if both chunks emit faces on the same seam plane). Implemented a strict “seam ownership” rule in `src/features/terrain/logic/mesher.ts`: quad emission now iterates a half-open interior range (`x/z/y` in `[PAD .. PAD+CHUNK_SIZE)`) while still sampling neighbor PAD via `x+1`/`z+1`. This makes exactly one chunk generate the border faces, eliminating coplanar duplicate triangles (Z-fighting) while keeping the surface continuous (no holes from vertex clamping). Verified with `npm run build`; `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection (10s wait + 4 screenshots) required in-game to confirm the seam is both watertight and shimmer-free in motion.

- 2025-12-12: Implemented a real fix for confirmed chunk overlap. `mesher.ts` now clamps generated vertex positions to the chunk’s interior bounds (still sampling neighbor density via PAD), preventing geometry from leaking into adjacent chunk space. The max border is biased inward slightly (`maxBoundaryInset`) to avoid coplanar triangles/Z-fighting on the shared plane. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Please re-check with `?debug` → Terrain Chunk Tint to confirm overlap strips are gone.
- 2025-12-12: Added `?debug` terrain visualization tools to diagnose seam lines that look like snow/grass blending but aren’t affected by prior toggles. New controls: "Terrain Chunk Tint" (solid per-chunk color to expose overlap/Z-fighting), "Terrain Wireframe", and "Terrain Weights View" (Snow/Grass/Snow-Grass/Dominant) to visualize `matWeights` discontinuities directly in `TriplanarMaterial`. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Use these views to determine if the line is weight discontinuity vs double-surface overlap.
- 2025-12-12: Wired Leva `Snap Epsilon (Hysteresis)` to the actual mesher seam snapping. `mesher.ts` previously used a hardcoded `0.02`, so the Leva control had no effect; it now reads `SNAP_EPSILON` from `src/constants.ts` (set via `setSnapEpsilon`). Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game while sweeping epsilon to see if the hard seam/flicker responds.
- 2025-12-12: Improved Leva readability in `?debug`. Leva now defaults wider with slightly larger base text, and `DebugControls` exposes `Leva Width` + `Leva Scale` sliders; scaling is applied via `#leva__root` CSS transform. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI).
- 2025-12-12: Added `?debug` Z-fighting probes to test if the persistent hard-edge/flicker is caused by overlapping surfaces. New toggles: "Bedrock Plane" (hide/show the giant `BedrockPlane`) and "Terrain Polygon Offset" with factor/units (push terrain depth slightly). If polygon offset removes the artifact, it strongly indicates Z-fighting (often from overlapping chunk surfaces or terrain intersecting another mesh). Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game while toggling these.
- 2025-12-12: Added `?debug` terrain material isolation controls to chase a hard-edge/flicker that disappears in `?normals` but isn’t affected by shadows/post/fog/fade/triplanar scale. New toggles: Terrain Wetness, Terrain Moss, and Terrain Roughness Min (clamps roughness to reduce specular shimmer). These help determine whether the artifact is driven by wetness darkening/roughness changes or moss overlay thresholding in `TriplanarMaterial`. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game while toggling these.
- 2025-12-12: Added `?debug` toggle "Terrain Fade (Chunk)" to isolate seam-like hard edges caused by the chunk fade-in path (terrain mesh opacity ramps 0→1 using transparency + depthWrite toggling). If disabling this removes the hard edge/flicker, the artifact is from transparency sorting/depth interactions rather than triplanar/shadows/post/fog. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game while toggling this.
- 2025-12-12: Fixed debug crash that prevented toggling post-processing. `App.tsx` had `<primitive object={null} />` when post-processing was disabled, which triggers `R3F: Primitives without 'object' are invalid!` and cascades into PointerLock failures + WebGL context loss. Removed the null primitive so post-processing can be toggled safely in `?debug`. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game after this fix.
- 2025-12-12: Extended `?debug` render probes to chase hard-edge/flicker reports that weren’t affected by triplanar detail or shadows. Added live toggles for Post Processing, N8AO on/off + intensity, and terrain fog path isolation (Shader Fog vs Three Fog) so the edge can be attributed to AO/post effects vs fog stacking/banding. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game while toggling these to pinpoint the culprit.
- 2025-12-12: Added `?debug` Leva render probes to isolate cave flicker causes. New "Shadows Enabled" toggle (wires to `<Canvas shadows={...}>`) and "Triplanar Detail" slider (0..1) that reduces high-frequency triplanar noise in `TriplanarMaterial` via `uTriplanarDetail`. Use these to quickly test whether shimmer is shadow-map jitter vs shader noise. Verified with `npm run build`; `npm run dev` starts on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection (10s wait + 4 screenshots) should be done in-game while toggling these controls to confirm the root cause.
- 2025-12-12: Fixed two likely contributors to chunk-edge “blending” flicker. (1) `terrain.worker` REMESH now forwards `wetness/mossiness` into `generateMesh(...)` so remeshed chunks don’t silently lose overlay weights (previously looked like texture discontinuities, especially in caves). (2) `mesher.ts` boundary snapping now insets the max border by a tiny epsilon to reduce coplanar overlap between adjacent chunk meshes (mitigates seam Z-fighting shimmer). Verified with `npm run build`; `npm run dev` starts successfully on `http://127.0.0.1:3000/` (terminated after startup in CLI). Visual inspection with 10s wait + 4 screenshots still needed in-game to confirm seam shimmer reduction in motion.
- 2025-12-11: Added an always-on left-hand torch for caves. Implemented procedural torch mesh, warm point light, and lightweight ember particles (`src/features/interaction/components/TorchTool.tsx`, wired in `src/features/interaction/components/FirstPersonTools.tsx`). Sun/moon/ambient/fog now blend to a cave palette underground; caves are intentionally darker and torch provides local visibility. Visual inspection (4 screenshots/10s wait) not performed in sandbox—please verify in-game and tune torch position/intensity if needed.
- 2025-12-11: Refined torch visuals/behavior. Torch handle length increased to match pickaxe height, point light replaced with a forward-facing spotlight for better cave visibility, and torch now slides in from below 1s after cave entry using `EnvironmentStore` timestamps. Visual inspection (4 screenshots/10s wait) not performed here—please confirm pose/brightness in-game.
- 2025-12-11: Boosted cave readability. Increased underground ambient floor slightly and strengthened/narrowed torch spotlight with farther forward target so beam illuminates ahead. Please re-check in-game for final tuning.
- 2025-12-11: Fixed torch spotlight aim. Spotlight target now updates each frame using torch world forward with slight downward bias, and cone widened to cover most of player FOV. Intensity bumped slightly to compensate. Please verify beam direction/coverage in-game.
- 2025-12-11: Added Leva debug controls for torch spotlight. With `?debug`, a "Torch Spotlight" panel appears to live-tune intensity, distance, angle, penumbra, color, target distance, down bias, and flicker amount. Defaults match current cave settings.
- 2025-12-11: Split debug flags. `?debug` now only enables Leva/UI debug; terrain normals view moved to `?normals` so lighting can be tuned in debug without normal-material override.
- 2025-12-11: Increased underground fog far/near to improve torch visibility range while keeping caves moody without light.
- 2025-12-11: Reduced underground fog aggressiveness (later near, much farther far) to prevent a visible fog wall from truncating torch lighting range.
- 2025-12-11: Corrected torch orientation. TorchTool now applies a base PI yaw so the flame faces forward; FirstPersonTools yaw for torch was reset near zero to avoid double-flip that aimed the beam backward.
- 2025-12-11: Added Leva debug controls for torch pose. With `?debug`, a "Torch Pose" panel lets you live-adjust torch target position, rotation (degrees), scale, and hidden Y offset for slide-in timing, without affecting non-debug gameplay.
- 2025-12-11: Fixed runtime crash in `FirstPersonTools.tsx` by importing `useMemo` (needed for debug flag + torch pose controls).
- 2025-12-11: Updated torch default pose to match latest tuning screenshot (pos/rot/scale), and widened spotlight debug angle cap to 89deg with higher distance/intensity ranges. Also fixed an accidental debug default intensity value.
- 2025-12-11: Set torch pose and spotlight defaults to finalized Leva screenshot values (Torch Pose pos/rot/scale and Torch Spotlight color/intensity/decay/angle/penumbra/target/flicker). Non-debug gameplay now uses these defaults.
- 2025-12-11: Made underground lighting transitions depth-based and added exposure adaptation. Underground blend now ramps smoothly with depth (instead of snapping), sky/fog remain sun-driven so looking out stays bright, and postprocessing tone-mapping exposure increases underground to create natural over-exposed outdoors from inside caves.
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
- 2025-12-05: Implemented Stateless 3D Noise Caverns ("Noodle Algorithm").
  - **Biome-Specific**: Added `BiomeCaveSettings` in `BiomeManager.ts` to control scale, threshold, and frequency per biome (Archetypes: Grasslands, Desert, Tundra, Lumina).
  - **Generation**: Replaced old random cave logic in `TerrainService.ts` with a domain-warped `abs(noise) < threshold` density check.
  - **Deterministic Fade**: Implemented a height-based gradient (Y=30 to Y=10) to smoothly fade caves near the surface, preventing chunk popping and hard edges.
  - **Architecture**: Logic resides in `TerrainService.ts` (helper `getCavernDensity`) for clean separation, called during the generation loop. Verified via console logs showing successful generation of chunks with Lumina flora placement.
- 2025-12-05: Improved RootHollow Generation.
  - **Biome Restriction**: RootHollows now only spawn in `THE_GROVE`.
  - **Constraints**: Added checks for surface proximity (preventing cave spawns) and terrain flatness (using `overhang/cliffNoise` < 1.5).
  - **Visuals**: Increased stump scale to 1.3 for better gameplay visibility.
  - **Verification**: Pending manual biome check.

### 8. Gameplay Mechanics (New)
- **Tree Placement**: Implemented Jittered Grid Sampling in `terrainService.ts` to prevent tree clumping. Trees are now placed using a 4x4 voxel grid with random offsets, ensuring better distribution.
- **Luma Axe**:
  - **Acquisition**: Player must place "Luminous Flora" (found in caverns) into a "Root Hollow" to grow a "Flora Tree". Interacting (DIG) with the grown Flora Tree grants the `luma_axe`.
  - **Usage**: The `luma_axe` is required to cut down trees.
  - **Cutting Logic**: Trees now require 5 hits to be felled. Each hit shows particles. Without the axe, trees cannot be cut.
  - **Visualization**: A `FirstPersonTools` component renders the axe in the player's hand when equipped.
- **Inventory**: `InventoryStore` now tracks `hasAxe` and `luminousFloraCount`.

- 2025-12-05: Critical Fix for First Person Tool Rendering.
  - **Jitter Fix**: To eliminate jitter, tools must be parented to the Camera (not synced via useFrame, which causes 1-frame lag).
  - **Graph Visibility**: In R3F, the default Camera is not strictly part of the Scene graph. Parenting a tool to the Camera hides it unless the Camera is explicitly added to the Scene.
  - **Solution**: Execute `scene.add(camera)` in the tool's useEffect (and remove on cleanup) to ensure children are rendered.
  - **Lighting**: Avoid `material-depthTest={false}` or `renderOrder` hacks for FPS tools. By placing them in the Scene graph (via camera), they receive proper world lighting and shadows. Added a local PointLight to the tool for fill.

- 2025-12-05: Implemented Sound System with low-latency `AudioPool`.
  - **Problem**: Direct `new Audio()` instantiation on click caused noticeable latency and dropped sounds due to garbage collection and disk I/O.
  - **Solution**: Implemented `AudioPool` utility in `VoxelTerrain.tsx` that pre-loads N instances of each sound (Dig_1-3, Clunk) on mount and recycles them round-robin.
  - **Features**:
    - **Randomization**: 'DIG' action picks a random sound from the set and applies pitch variation (0.95 - 1.05) to reduce fatigue.
    - **Contextual**: Plays "Clunk" sound when interacting with indestructible blocks (Bedrock) or trees without an axe.
    - **Assets**: Integrated user-provided `Dig_*.wav` and procedurally generated `clunk.wav`.

- 2025-12-05: Enhanced Pickaxe Animation.
  - **Visuals**: Replaced simple rotation with a multi-phase "Strike Arc" animation.
  - **Motion**: Axe now moves forward and back significantly (Z-axis) while chopping, mimicking a real swing reach.
  - **Polish**: Added wrist roll (Z-rotation) and vertical dip (Y-translation) to create a natural, organic movement.
  - **Timing**: Slowed down animation speed (15 -> 10) to make the weight and arc trajectory clearly visible.

- 2025-12-05: Refined Cave Stone Moss Material.
  - **Issue**: Users reported the moss overlay in caves looked "splotchy" with hard edges, disrupting the visual transition.
  - **Fix**: Softened the `smoothstep` transition in `TriplanarMaterial.tsx` fragment shader. Widened the mix band from +/-0.1 to +/-0.4 to create a smoother, more organic gradient between stone and moss, eliminating sharp patches.
- 2025-12-05: Fixed Snow/Grass Transition Flickering Line.
  - **Root Cause**: Discrete biome switching in `BiomeManager` created a mathematically perfect line at `temp = -0.5`, causing shader Z-fighting/blending issues.
  - **Fix**: Implemented "Biome Dithering" in `terrainService.ts`. Applied 3D noise jitter to the biome lookup coordinates (`bx`, `bz`), breaking the straight line into an organic jagged transition that effectively visualizes the seam properly.
  - **Addendum**: Attempted to use the same dithering for Obsidian/Bedrock, but it created ugly checkerboard artifacts on high-contrast materials, so it was reverted for those specific layers.
- 2025-12-05: Aesthetic & Performance Tuning.
  - **Vegetation Shadows**: Disabled `castShadow` on `VegetationLayer` instanced meshes. They still `receiveShadow`, but disabling casting reduces shadow map clutter and improves performance.
  - **Favicon**: Added a custom crystal shard favicon and linked it in `index.html`.
  - **UI**: Confirmed `StartupScreen` dependency on Tailwind CSS CDN; restored it to fix layout regression.
- 2025-12-05: Updated Vegetation Grass Material.
  - **Goal**: Make grass brighter, more saturated, and more reflective.
  - **Implementation**: Added `roughness` property to `VEGETATION_ASSETS` in `VegetationConfig.ts`.
  - **Tuning**: Adjusted grass colors (Low, Tall, Grove) to be more vibrant (saturated green) and brighter. Lowered roughness for grass from default 0.8 to 0.3-0.5 for a "shiny/healthy" look.
  - **Shader**: Updated `VegetationLayer.tsx` to utilize the per-asset roughness value.
- 2025-12-05: Improved Biome Dithering (Value-Based).
  - **Issue**: Coordinate-based dithering failed to fix straight-line seams in biomes with flat climate gradients (e.g. extending Tundra/Plains boundaries) because the 15-unit jitter wasn't enough to cross the threshold.
  - **Fix**: Switched to **Value-Based Dithering** in `terrainService.ts`. Explicitly adds noise (+/- 0.05) to the `temp` and `humid` values before biome classification. Refactored `BiomeManager` to expose precise control methods (`getBiomeFromClimate`).
  - **Result**: Guarantees organic, fuzzy transitions at all biome edges regardless of gradient slope.
- 2025-12-05: Implemented "Physically Accurate" Biome Noise & Debug Map.
  - **Core Algorithm**: Upgraded `BiomeManager` to include 'Continentalness' (Ocean vs Land depth) and 'Erosion' (Flat vs Mountainous shape) noise layers alongside Temperature/Humidity.
  - **Height Shaping**: `getTerrainParametersFromMetrics` now modulates `baseHeight` based on continental depth (creating actual sea basins) and `amplitude` based on erosion (flattening plains, boosting mountains).
  - **Performance**: Refactored `TerrainService.ts` loop to iterate Z->X->Y, hoisting the expensive Biome/Climate calculation out of the vertical loop for column-based caching.
  - **Optimization**: Significant per-voxel CPU reduction (4 noise calls per column instead of per voxel).
  - **Tooling**: Added `MapDebug` component reachable via `?mode=map` to visualize the biome layout top-down on a 2D canvas 2D. Verified with `npm run build`.
- 2025-12-05: Integrated Latitude-Based Temperature Gradient.
  - **Issue**: Random noise temperature distribution placed cold biomes arbitrarily, lacking a realistic north/south feel. Also, centering "Equator" (Hot) at Spawn (0,0) caused biome confusion (players spawning in Savanna instead of Grove).
  - **Fix**: Modified `BiomeManager.getClimate` to use a **South-to-North** gradient.
  - **Logic**: `BaseTemp = -z * LATITUDE_SCALE`.
    - **Z < 0 (South)**: Positive Temp (Hot -> Desert/Jungle).
    - **Z = 0 (Spawn)**: Zero Temp (Temperate -> Grove/Plains).
    - **Z > 0 (North)**: Negative Temp (Cold -> Snow/Ice).
  - **Result**: Spawn is now reliably Temperate (The Grove), with physical progression to Hot (South) and Cold (North). Verified with `npm run build`.
- 2025-12-05: Improved Lumina Flora Spawning in Deep Caves.
  - **Issue**: Lumina Flora were too rare or missing because spawn logic included restrictive biome checks and a separate noise filter that didn't align with Obsidian generation.
  - **Fix**: Removed biome restrictions (deep caves exist everywhere) and the secondary cluster-noise check. Now spawns flora solely based on the presence of Obsidian/Glowstone floor.
  - **Refinement**: Relaxed the "headroom" check for cluster members (only needs 1 block air above) while keeping strict center-finding logic. Optimized scanning to target the `matBelow` directly.
  - **Result**: Flora now reliably populate Obsidian/Glowstone caverns, providing the necessary resources for the Luma Axe quest. Verified with `npm run build`.
- 2025-12-05: Fixed Lumina Depths Leaking to Surface.
  - **Issue**: Deep ocean basins or low-lying valleys (low World Y) triggered the "Lumina Depths" obsidian generation logic, causing obsidian and alien flora to appear on the surface in broad daylight.
  - **Fix**: Added a `depthFromSurface` check (`(surfaceHeight + overhang) - wy > 15.0`) to the Lumina logic.
  - **Result**: Obsidian/Glowstone now only generates if the voxel is both deep in the world (Y < -20) AND buried at least 15 blocks below the terrain surface. Surface valleys remain grassy/sandy. Verified with `npm run build`.

- 2025-12-11: Improved Jungle biome undergrowth variety and look.
  - **Change**: Added `JUNGLE_BROADLEAF`, `JUNGLE_FLOWER`, and `JUNGLE_VINE` vegetation types with distinct colors/scales, and updated jungle selection bands so ground cover mixes carpet grass, ferns, broadleaf clumps, vertical vines, and rare flowers.
  - **Rendering**: Added a broadleaf geometry variant and mapped new type IDs in `VegetationLayer`.
  - **Verification**: Ran `npm run build` (success) and `npm run dev` (server ready on `127.0.0.1:3000`, stopped after startup). No in-engine screenshot pass here due to Codex CLI limitations; please do a quick jungle fly-through and compare density/color/silhouette variation.

- 2025-12-11: Added deterministic jungle tree canopy + template variation.
  - **Change**: `TreeGeometryFactory` now supports cached per-variant templates; jungle trees select one of 4 stable variants based on position seed. Variants adjust trunk height, recursion depth, canopy spread, and trunk-straightness so the jungle mixes emergent giants with shorter canopy fillers.
  - **Canopy**: Added extra leaf clumps along upper branches (not only tips) to create a denser, continuous leaf ceiling.
  - **Verification**: Ran `npm run build` (success) and `npm run dev` (server ready on `127.0.0.1:3000`, stopped after startup). Please visually check in a jungle: leaf volume should connect between trees; height/shape should vary noticeably.

- 2025-12-12: Implemented V1 water end-to-end (render + gameplay probes) without enabling full fluid sim.
  - **Plumbing Fix**: Worker payload now uses `meshWaterPositions/meshWaterIndices/meshWaterNormals` so `ChunkMesh` can render water via `WaterMaterial`.
  - **Geometry**: `mesher.ts` now generates a greedy-meshed sea-level water surface at `WATER_LEVEL` by reading liquid voxels (WATER/ICE) under the sea plane.
  - **Generation**: `terrainService.ts` sea-level fill is now a post-pass that only fills columns vertically open to the sky at sea level, preventing sealed caves from being pre-flooded.
  - **Gameplay**: Added `TerrainRuntime` runtime voxel query service (wired into `VoxelTerrain` chunk load/unload). `Player` now supports swim/drag/buoyancy in water, and `AtmosphereController` applies underwater fog/palette based on camera voxel water queries.
  - **Interaction**: BUILD with WATER now paints liquid into air-space (`paintLiquid`) instead of trying to “build” solid density.
  - **Verification**: Ran `npm run build` (success); `npm run dev` starts successfully (auto-selected `http://localhost:3001/` because `:3000` was in use; stopped after ~20s by CLI timeout). Visual inspection still required in-game: wait 10s then take 4 screenshots (shoreline seam across chunks, ocean surface across multiple chunks, underwater fog/palette, and player-placed water near an edit) and confirm: no chunk-edge cracks on the water surface and no unexpected cave flooding.

- 2025-12-12: Improved water shoreline visuals and fixed underwater tree spawns.
  - **Water Surface**: Water mesh is now a chunk-wide sea-level plane (no per-tile jagged geometry). A per-chunk shoreline mask (signed-distance field) is computed in `ChunkMesh` and sampled in `WaterMaterial` to smoothly fade/discard pixels at the shoreline, eliminating the square/stair-step edge.
  - **Trees**: Surface tree placement now skips any candidate whose interpolated ground height is at/under the waterline (`wy <= WATER_LEVEL + 0.25`), preventing trees from spawning inside oceans/lakes.
  - **Verification**: Ran `npm run build` (success); `npm run dev` starts successfully (auto-selected `http://localhost:3001/` because `:3000` was in use; stopped after ~20s by CLI timeout). Visual inspection still required: wait 10s then take 4 screenshots focused on shoreline smoothness (especially across chunk seams) and confirm trees never appear in shallow water.

- 2025-12-12: Tuned water surface appearance (color/alpha/texture).
  - **Fix**: Removed manual gamma correction from `WaterMaterial` (was washing the surface toward white); Three.js handles output color space.
  - **Look**: Adjusted base water colors and alpha to be slightly transparent, added a subtle static noise-based albedo modulation, and added gentle shoreline foam brightening (still respects the shoreline mask fade).
  - **Verification**: Ran `npm run build` (success); `npm run dev` starts successfully (auto-selected `http://localhost:3001/` because `:3000` was in use; stopped after ~20s by CLI timeout). Visual inspection required: wait 10s then take 4 screenshots comparing (1) offshore water color (no longer white), (2) shoreline foam band, (3) transparency/underwater transition at waterline, (4) nighttime/moody lighting on water without washout.

- 2025-12-12: Chunk fade perf + “stuck half-fade/dither” fix.
  - **Issue**: The fade path used alpha-dither/alpha-hash and per-frame React state updates; chunks could get stuck partially faded (never reaching full opacity) and streaming new terrain caused noticeable hitches.
  - **Fix**: Switched chunk fade to a ref/uniform-driven approach so opacity updates don’t trigger React re-renders. `ChunkMesh` now computes fade from `chunk.spawnedAt` and shares an `opacityRef` with terrain (`TriplanarMaterial`), water (`WaterMaterial`), vegetation, trees, and lumina so all geo fades consistently. Removed dither/alpha-hash fades and restored smooth alpha fades with render-state toggles only when crossing opaque/transparent boundaries. Also removed forced `glslVersion` in `WaterMaterial` (repo has mixed shader versions).
  - **Streaming**: `VoxelTerrain` chunk generation queue now prioritizes nearest-to-player jobs (cheap selection; avoids full sorts) so nearby chunks don’t linger in a half-loaded look.
  - **Verification**: Ran `npm run build` (success); `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection required: wait 10s then take 4 screenshots: (1) sprint forward until new terrain streams (smooth fade; no stipple), (2) stand next to a freshly loaded chunk (it reaches full opacity quickly), (3) trees/vegetation/lumina fade-in at distance (no noisy dither), (4) shoreline water fade-in (no popping).

- 2025-12-12: Fixed water becoming invisible after shader pipeline changes.
  - **Issue**: `WaterMaterial` used GLSL3-only `in/out` varyings and an explicit fragment output; when `glslVersion` forcing was removed, the shader could fail to compile and the whole water surface vanished. Separately, if `shoreMask` was null the shader would sample 0 and discard everything.
  - **Fix**: Converted the shader to the engine’s default-compatible style (`varying` + `gl_FragColor`) and added a 1x1 fallback shoreline mask texture so water remains visible even if a chunk doesn’t provide a computed mask.
  - **Verification**: Ran `npm run build` (success); `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection required: wait 10s then take 4 screenshots: (1) shoreline with visible water band, (2) ocean across multiple chunks, (3) water near a freshly streamed chunk (no disappearance), (4) underwater view (fog/palette still applies).

- 2025-12-12: Fixed RootHollow stumps staying semi-transparent.
  - **Issue**: RootHollow fade was driven by a per-frame computed `opacity` prop in `VoxelTerrain`, but chunk fade no longer triggers React re-renders (moved to refs/uniforms). That meant stump opacity could remain at its initial <1.0 value and look permanently transparent.
  - **Fix**: `RootHollow` now supports `spawnedAt` + `fadeEnabled` and updates its material opacity in `useFrame`, matching the chunk fade behavior without relying on React re-renders.
  - **Verification**: Ran `npm run build` (success); `npm run dev -- --host 127.0.0.1 --port 3000` starts successfully (stopped after ~15s by CLI timeout). Visual inspection required: wait 10s then take 4 screenshots: (1) approach a newly streamed chunk with stumps (they fade to fully opaque), (2) stand next to stumps after fade completes (no lingering transparency), (3) compare stump vs nearby terrain opacity (they should match), (4) check stump shadows/lighting after fade (no popping).

- 2025-12-14: Fireflies now persist across chunk streaming and form tighter swarms.
  - **Root Cause**: `AmbientLife` fireflies used an anchor-wrapped procedural field; as you walked across snapped anchor cells they would repick heights/biome gating and feel like they were “regenerating” in place.
  - **Fix**: Firefly mote positions are now generated during chunk generation (`TerrainService.generateChunk`) as small swarms biased near trees and in local low points, then streamed via the terrain worker into `VoxelTerrain`. `AmbientLife` renders only the nearby chunk-provided motes via a lightweight registry (`src/features/environment/fireflyRegistry.ts`) and animates blink/drift in a tiny shader to avoid per-frame CPU instance updates.
  - **Verification**: Ran `npm run build` (success) and `npm run dev -- --host 127.0.0.1 --port 3000` (server ready, stopped by CLI timeout). Visual inspection required in-game: wait 10 seconds, then take 4 screenshots while (1) standing still in a grove pocket (motes stay stable), (2) walking across a chunk boundary (no “regenerate” pop), (3) approaching a tree cluster (swarm bias reads clearly), (4) moving through a shallow dip/valley (low-point swarms appear).
