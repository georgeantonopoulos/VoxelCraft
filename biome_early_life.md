# Biome Early Life (Implementation Handoff)

Goal: add subtle “life” + “mystery” to VoxelCraft using **procedural rendering** and **instancing**, with **zero new art assets** (no GLBs/textures). Keep it biome-aware and cheap enough to always run.

Preference notes (from George):
- Keep the **bugs/fireflies** idea.
- Skip “watchers”; instead prefer a **procedural creature** (deer-like) you notice **far away in the fog** and that **runs away** when you approach.

Repo constraints (from `AGENTS.md`):
- Do **not** force GLSL versions.
- Do **not** remove comments.
- After implementation: run `npm run build` and `npm run dev`, then do the 10s wait + 4 screenshot visual check and record findings in `AGENTS.md`.

---

## What to build (v1)

Split by domain (matches repo structure and keeps “creature logic” isolated):
- Environment:
  - `src/features/environment/AmbientLife.tsx` (composition + fireflies)
- Creatures:
  - `src/features/creatures/FogDeer.tsx` (the deer system/component)

It should render (initially) two systems:
1. **FirefliesField**: lightweight blinking motes in forests + cave entrances (life).
2. **FogDeer**: distant deer silhouettes that flee when approached (mystery, but not “horror”).

Integrate by adding `<AmbientLife />` in `src/App.tsx` inside the existing `<Physics>`/`<Suspense>` tree (so it can use `useRapier()` if needed). `AmbientLife` should import and render `<FogDeer />` from `src/features/creatures/FogDeer.tsx`.

---

## Data sources you already have (use these)

Player position / heading:
- `window` event `player-moved` from `src/features/player/Player.tsx` (used by `src/ui/HUD.tsx`).
  - Good for ambient systems because it avoids tight coupling to the Player component.

Fog distances:
- `scene.fog` exists in `src/App.tsx` (`<fog attach="fog" args={[..., fogNear, fogFar]} />`).
  - Use `useThree()` to access `scene.fog` and keep “FogDeer” inside the fog band.

Biome classification (cheap, deterministic):
- `BiomeManager.getBiomeAt(x, z)` in `src/features/terrain/logic/BiomeManager.ts`.

Approx ground height (no chunk dependency):
- `TerrainService.getHeightAt(wx, wz)` in `src/features/terrain/logic/terrainService.ts`.
  - Good enough for far silhouettes; you can refine with a physics ray if needed.

Underground / underwater state:
- `useEnvironmentStore` in `src/state/EnvironmentStore.ts` exposes `undergroundBlend` and `underwaterBlend`.
  - Use to suppress deer underground/underwater; boost fireflies underground.

---

## FirefliesField (implementation notes)

### Visual target
- Small, warm-green/yellow pulses that drift.
- Reads as “air density” near trees and in caves without looking like UI particles.

### Rendering approach (pick one)

Option A (simplest, very likely “good enough”):
- `InstancedMesh` of tiny `sphereGeometry` or `icosahedronGeometry` with `meshBasicMaterial` and `AdditiveBlending`.
- Animate “blink” by instance scale in CPU (cheap at ~100–250 instances).

Option B (more correct for glow; avoids per-instance CPU scale churn):
- Custom `shaderMaterial` with a per-instance attribute `aPhase`.
- In fragment, use `vUv` (plane) or face normal (sphere) to shape glow.

Important: the suggested snippet you were given uses `gl_PointCoord` inside a mesh fragment shader. `gl_PointCoord` only works for `Points`, not `Mesh`. If you want a circular glow, use a billboarded `planeGeometry` with UVs (and compute radial falloff from `vUv`).

### Spawn logic
- Don’t spawn globally; spawn in a player-local “window” and wrap positions to feel infinite.
- Stable wrap trick: anchor to a snapped camera cell to avoid jitter:
  - `anchor = floor(playerPos.xz / cellSize) * cellSize`
  - Each instance has `baseOffset` in `[-range/2, range/2]`
  - Final world = `anchor + baseOffset + drift(time, phase)`

### Biome gating (first pass)
- Enable in: `THE_GROVE`, `JUNGLE`, maybe `BEACH` at dusk.
- Reduce in: `DESERT`, `RED_DESERT`, `SNOW`, `ICE_SPIKES`.
- Boost underground when `undergroundBlend > 0.5` (cave motes).

---

## FogDeer (procedural “creature in the fog”)

### Design constraints (make it feel right)
- The deer should be **visible only at distance**, ideally *inside fog*.
- It should **never approach the player**. On “scare”, it runs away and either:
  - stays near the fog band, or
  - fades out and respawns elsewhere.
- Keep count low (e.g., 1–5). The goal is “glimpses”, not herds.

### Animation quality (this needs real time investment)
- A static billboard that “slides” away will read fake quickly; plan time to make the motion believable.
- Expect an iteration pass focused purely on animation:
  - Add gait cycle timing, head bob, and subtle idle motion even at distance.
  - If you move beyond silhouettes / into even simple rigs, invest in **inverse kinematics** (at least feet-to-ground IK) so hooves plant correctly on uneven voxel terrain.
  - Keep IK optional/LOD’d: full IK only when closer (still inside fog), simplified animation when far.

### Rendering approach (two viable options)

Option A (recommended first): silhouette sprites
- Use `planeGeometry` (billboarded to camera) with a procedural fragment shader that draws a deer-ish silhouette from a few ellipses/SDF blobs.
- Benefits: looks like a recognizable shape at distance, very low geometry cost, easy to fade.
- Notes:
  - Use `fog={true}` (default) so it integrates with scene fog.
  - No GLSL version directives.

Option B (fastest to implement): ultra-low-poly geometry
- Build a “deer” from primitives (boxes/capsules) in a `group`.
- Keep material very dark and rough so it reads as a silhouette.
- Draw call count is fine at 1–3 deer; if it works, optimize later to instancing.

### Placement rule (keeps it in the fog)
- Let `fogFar = (scene.fog as THREE.Fog).far`.
- Maintain deer radius in `[fogFar * 0.65, fogFar * 0.92]` around player in XZ.
- When a deer leaves that annulus (because it ran), fade it out and respawn.

### Scare / flee behavior
- Trigger if:
  - `distance(player, deer) < scareRadius` (e.g., 28–35), OR
  - player is sprinting toward it (optional later), OR
  - the player’s view ray is roughly aligned with it for > N ms (optional “noticed you” feel).
- Flee direction: `(deerPos - playerPos).normalize()` with small lateral noise so it doesn’t look robotic.
- Movement:
  - Keep kinematics simple; deer can “ghost” over terrain at distance.
  - Update at ~15–30 Hz (not necessarily every frame) to save work.

### Grounding
For y placement you have three levels of fidelity:
1. `TerrainService.getHeightAt(wx, wz)` (fast, deterministic, good for fog distance).
2. If you need more accuracy: `useRapier().world.castRay(...)` downward against terrain colliders.
3. Avoid per-frame raycasts; do it only on spawn/respawn.

### Biome gating (first pass)
- Spawn in: `PLAINS`, `THE_GROVE`, `JUNGLE` (rare), maybe `MOUNTAINS` (very rare silhouettes).
- Don’t spawn in: `DESERT`, `RED_DESERT`, `SNOW`, `ICE_SPIKES`.
- Don’t spawn if:
  - `undergroundBlend > 0.2`
  - `underwaterBlend > 0.1`

---

## Architecture + performance notes (important)

- Avoid React state updates inside `useFrame()` for per-instance simulation (they cause rerenders and GC churn).
  - Use `useRef()` arrays for creature state (pos/vel/phase/opacity).
  - For instancing, update instance matrices and set `instancedMesh.instanceMatrix.needsUpdate = true`.
- Keep allocations out of the frame loop:
  - Reuse `THREE.Vector3` temps, or store raw numbers in typed arrays.
- If using shaders:
  - Guard against NaNs (e.g., safe normalize patterns).
  - Don’t introduce GLSL version pragmas.

---

## Suggested implementation steps (for the next agent)

1. Create `src/features/creatures/FogDeer.tsx` (start with the simplest rendering + flee behavior; keep state in refs, no per-frame React setState).
2. Create `src/features/environment/AmbientLife.tsx` with `FirefliesField` and import/render `<FogDeer />`.
2. Add `<AmbientLife />` into `src/App.tsx` under `<Physics>` so `useRapier()` is available if you choose to raycast on spawn.
3. Add a minimal “debug toggle” (optional):
   - `?debug` could show deer spawn points or a counter in HUD via a `window` event, similar to the placement tracer pattern.
4. Verify:
   - `npm run build`
   - `npm run dev -- --host 127.0.0.1 --port 3000`
   - Visual inspection per `AGENTS.md`: wait 10 seconds, take 4 screenshots:
     1) grove at dusk/dawn: fireflies visible but subtle
     2) cave entrance: motes visible, not noisy
     3) open plains: deer silhouette appears in fog band
     4) approach deer: it flees + fades/respawns without popping near camera
   - Record results in `AGENTS.md` under “Recent Findings”.
