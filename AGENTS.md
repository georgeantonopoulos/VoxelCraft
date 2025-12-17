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

- `src/core/`: Engine-ish utilities and materials (e.g. `src/core/graphics/TriplanarMaterial.tsx`).
- `src/features/terrain/`: Chunk streaming, meshing, workers (e.g. `src/features/terrain/components/VoxelTerrain.tsx`).
- `src/features/flora/`: RootHollow / FractalTree / LumaSwarm (e.g. `src/features/flora/components/RootHollow.tsx`).
- `src/features/creatures/`: FogDeer and shader-based creatures (e.g. `src/features/creatures/FogDeer.tsx`).
- `src/state/`: Zustand stores and debug toggles (e.g. `src/state/InventoryStore.ts`).
- `src/ui/`: HUD and debug screens (e.g. `src/ui/MapDebug.tsx`).

#### Terrain System
- **Generation**: `TerrainService.generateChunk` uses 3D Simplex noise (`src/core/math/noise.ts`) to create a density field.
  - **Density > ISO_LEVEL (0.5)** = Solid.
  - **Materials**: Determined by height, slope, and noise (Bedrock, Stone, Dirt, Grass, etc.).
  - **Caverns**: Stateless "Noodle" Algorithm using domain-warped 3D ridged noise (`abs(noise) < threshold`) in `TerrainService.ts`. Configured per-biome via `BiomeManager.ts`.
- **Meshing**: `src/features/terrain/logic/mesher.ts` implements a Surface Nets-style algorithm (Dual Contouring variant) to generate smooth meshes from density data.
  - **Seam Fix**: Optimized loop logic explicitly handles boundary faces (X/Y/Z) with correct limits (`endX`, `endY`) to prevent disappearing textures at chunk edges.
- **Materials**: `TriplanarMaterial` uses custom shaders with sharp triplanar blending (pow 8) and projected noise sampling to avoid muddy transitions.
  - **Shader Stability**: Implements `safeNormalize` to prevent NaNs on degenerate geometry (e.g., sharp concave features from digging) which prevents flashing artifacts.

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

- Terrain generation/remesh runs via `src/features/terrain/workers/terrain.worker.ts`, spawned in `src/features/terrain/components/VoxelTerrain.tsx`.
- Worker message convention is `{ type, payload }` (see `terrain.worker.ts`, `simulation.worker.ts`).
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
- **Main-thread chunk arrival spikes**: Avoid expensive `useMemo` computation when chunks stream in; prefer precomputing in workers (shoreline mask note in `src/features/terrain/components/ChunkMesh.tsx`).
- **Terrain streaming “loaded” state can stall**: If chunk updates are wrapped in `startTransition`, UI state may lag; gate initial-load readiness off `chunksRef.current` in `src/features/terrain/components/VoxelTerrain.tsx` (keyword: `initialLoadTriggered`).
- **Terrain backface Z-fighting**: Terrain uses `side={THREE.FrontSide}` in `src/core/graphics/TriplanarMaterial.tsx` (validate artifacts before changing).
- **Celestial orbit desync**: Use shared helpers in `src/core/graphics/celestial.ts` (`calculateOrbitAngle`, `getOrbitOffset`) for Sun/Moon/Sky/IBL; do not duplicate orbit math inside components (previously caused mismatched sky/fog vs lighting).

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
- 2025-12-17: Fixed Caustics Animation Looping and Color Fidelity.
  - Resolved the 20s animation "jump" by refactoring all time-based frequencies to integer ratios.
  - Achieved "White Core" caustics by boosting additive overlap between dispersive R,G,B channels.
  - Sharpened caustic lines (higher ridge exponent) and removed muddy tints to match reference imagery.
  - Fine-tuned scale-based dispersion and depth falloff for a more realistic underwater atmosphere.
