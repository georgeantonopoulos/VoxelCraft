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

## Interaction: Hard Invariants (verified)

- Terrain targeting relies on `userData.type === 'terrain'`:
  - `src/features/terrain/components/ChunkMesh.tsx` tags both the physics `RigidBody` and the render mesh.
  - Consumers include `src/features/terrain/components/VoxelTerrain.tsx` and `src/features/flora/components/FloraPlacer.tsx`.

---

## Known Pitfalls (keep this list small)

- **Shared references from `Array(n).fill(obj)`**: Use `Array.from({ length: n }, () => new Obj())` for per-particle/per-instance objects (common particle bug class).
- **React StrictMode timer bugs**: Effects can mount/unmount twice in dev; store timeout IDs in refs and clear them before setting new ones (see `src/features/flora/components/RootHollow.tsx`).
- **InstancedMesh scaling can “shrink your shader space”**: If instance matrices scale, shader-driven offsets may also scale; size particles via geometry radius when offsets must stay in world units (see `src/features/flora/components/LumaSwarm.tsx`).
- **Three.js fog uniform crash**: If a `ShaderMaterial` has `fog=true` but lacks `fogColor/fogNear/fogFar`, Three may throw during `refreshFogUniforms()` (see `src/features/creatures/FogDeer.tsx`).
- **Main-thread chunk arrival spikes**: Avoid expensive `useMemo` computation when chunks stream in; prefer precomputing in workers (shoreline mask note in `src/features/terrain/components/ChunkMesh.tsx`).
- **Terrain backface Z-fighting**: Terrain uses `side={THREE.FrontSide}` in `src/core/graphics/TriplanarMaterial.tsx` (validate artifacts before changing).

---

## Debug Switches (verified)

- `?debug`: enables debug UI paths (Leva/HUD/placement debug) (`src/App.tsx`, `src/ui/HUD.tsx`, `src/state/InventoryStore.ts`).
- `?mode=map`: shows the biome/map debug view (`src/App.tsx` -> `src/ui/MapDebug.tsx`).
- `?normals`: swaps terrain material to normal material for geometry inspection (`src/features/terrain/components/ChunkMesh.tsx`).
- `?vcDeerNear`, `?vcDeerStatic`: FogDeer spawn helpers (`src/features/creatures/FogDeer.tsx`).
- Placement tracing can also be enabled via `localStorage.vcDebugPlacement = "1"` or `window.__vcDebugPlacement = true` (`src/features/flora/components/FloraPlacer.tsx`).

---

## Verification Checklist (required)

- `npm run build`
- `npm run dev` (confirm server starts; stop it once ready)

## Worklog (short, keep last ~5 entries)

- 2025-12-14: Refined Sun Shader heavily per user request: Rays are now 1/3rd the size, more transparent (1/2 opacity), and tightly masked to the sun disk. This creates a subtle "atmospheric halo" rather than dominant beams.
- 2025-12-14: Created robust volumetric Sun Glare ("God Rays Lite") using a massive shader-animated billboard. This replaces the post-processing GodRays which failed depth occlusion.
- 2025-12-14: Increased camera `far` plane to 600m and relaxed default fog (10-90 -> 20-160) to fix Sun/Moon clipping and improve visibility.
- 2025-12-14: Removed ALL animated/pulsing texture effects from tree leaves per user request. Replaced with static color variation (noise lookup) and static emissive glow. Wind sway is retained in vertex shaders.
- 2025-12-14: Removed procedural noise texture from all tree leaves (FractalTree, FallingTree, TreeLayer) per user request to fix "moving/weird" look. Reverted to clean gradient and simple emissive pulse.
- 2025-12-14: Removed procedural wind sway from `FractalTree.tsx` bark to fix disjointed segments. Stabilized leaf pulse animation in `TreeLayer.tsx`.
- 2025-12-14: Updated `TreeLayer.tsx` and `TreeGeometryFactory.ts` to apply procedural bark/leaf shaders to massive terrain trees (previously only applied to hero instances).
