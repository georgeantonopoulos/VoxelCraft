# Water Implementation Plan (VoxelCraft)

This document proposes a concrete, staged implementation for **rendered, interactive water** that fits the current VoxelCraft architecture (SDF terrain + Surface Nets meshing + R3F + Rapier).

It is written to be reviewed/approved **before any code changes**.

---

## 0) Current Repo State (What’s Already Here)

### Generation & Data
- `MaterialType.WATER` exists (`src/types.ts`) and `WATER_LEVEL` exists (`src/constants.ts`).
- `TerrainService.generateChunk(...)` already writes **WATER** (and **ICE** for frozen oceans) into the `material` array for air cells below `WATER_LEVEL` (`src/features/terrain/logic/terrainService.ts`).
- `MeshData` already has `waterPositions/waterIndices/waterNormals` (`src/types.ts`), implying a dedicated water mesh path was intended.

### Rendering (Mostly Wired)
- `ChunkMesh` already renders a water mesh with `WaterMaterial` if `chunk.meshWaterPositions/...` are present (`src/features/terrain/components/ChunkMesh.tsx` + `src/features/terrain/materials/WaterMaterial.tsx`).
- `WaterMaterial` is already a custom shader (fresnel + animated noise normals) with fog integration.

### What’s Missing / Broken
- `generateMesh(...)` currently returns **empty** water arrays (“Return empty arrays for water…”) (`src/features/terrain/logic/mesher.ts`).
- **Naming mismatch bug** prevents water data from ever reaching `ChunkMesh`:
  - `terrain.worker.ts` posts `waterPositions/waterIndices/waterNormals`,
  - but `ChunkState` expects `meshWaterPositions/meshWaterIndices/meshWaterNormals`,
  - and `VoxelTerrain.tsx` reads `meshWaterPositions...` in the REMESH path (`src/features/terrain/workers/terrain.worker.ts`, `src/features/terrain/components/VoxelTerrain.tsx`, `src/types.ts`).
- Player “build water” currently uses the **solid terrain** edit path (`TerrainService.modifyChunk(...)`), which only assigns `brushMaterial` when density crosses into **solid**. Water is a liquid in **air**, so this is conceptually wrong (`src/features/terrain/logic/terrainService.ts`, `src/features/terrain/components/VoxelTerrain.tsx`).

### Simulation (Optional, Exists but Disabled)
- `simulation.worker.ts` contains a basic water-spread sim, but the loop is deliberately disabled for perf and to avoid remesh flashing (`src/features/flora/workers/simulation.worker.ts`).

---

## 1) Goals & Non-Goals

### Goals (V1)
1. Water is **visible** (oceans/lakes + player-placed water).
2. Water is a **separate mesh** from terrain (no terrain-triplanar hacks).
3. Water supports basic **player interaction**:
   - swimming movement / drag,
   - buoyancy (float/hover near surface),
   - underwater visual treatment (fog/color shift).
4. Water remains **stable at chunk seams** (no cracks and no coplanar Z-fighting).

### Non-goals (V1)
- Full, high-frequency, Minecraft-like fluid simulation across large regions (we can stage this later).
- Real refraction/caustics via depth textures (optional future upgrade).

---

## 2) Design Decisions

### 2.1 Representation
- Keep water stored in the existing per-voxel `material` grid:
  - a cell is considered “liquid” if `density <= ISO_LEVEL` and `material ∈ {WATER, ICE(surface-only)}`.
- **Do not** treat water as “solid density”. Water should live in “air space” (density below ISO).

### 2.2 Rendering Geometry (V1: Surface-First)
We will generate a dedicated **water surface mesh** per chunk:
- Primary: top surface quads at the water level where water meets air.
- Optional (V1.5): side faces on shoreline edges (waterfalls/cliffs) if desired.

Rationale:
- Generating full “water volume” faces against all underwater terrain would be extremely expensive (it would effectively render the entire seabed as transparent geometry).
- Underwater feeling will be achieved via **underwater fog/color** (camera-based), not by rendering the entire water volume interior.

### 2.3 Terrain Generation Water Placement (Fix)
Current generation floods *all air* below `WATER_LEVEL`, which also fills sealed caves.

Proposed V1 placement:
- Fill water only where there is “open surface exposure” in the column:
  - For each `(x,z)` column, compute the **highest solid surface height** (already derivable from the density function used to build terrain).
  - If `surfaceHeight < WATER_LEVEL` and biome is not `SKY_ISLANDS`, fill air between `surfaceHeight..WATER_LEVEL` as WATER (or ICE in cold biomes).
- This creates oceans/lakes in low-lying regions while leaving most underground caves dry unless they open to the surface.

Future upgrade (V2): optional connectivity flood-fill so only basins connected to “ocean boundary” fill, enabling realistic “sealed cave stays dry until breached”.

---

## 3) Implementation Steps (Concrete, File-by-File)

### Step A — Fix the Water Mesh Data Plumbing (No new algorithms yet)
**Why:** even after generating water geometry, it must actually reach `ChunkMesh`.

1) Normalize naming to `meshWaterPositions/meshWaterIndices/meshWaterNormals` in worker payloads:
- `src/features/terrain/workers/terrain.worker.ts`
  - Change response keys from `waterPositions/waterIndices/waterNormals` to `meshWaterPositions/meshWaterIndices/meshWaterNormals` for both `GENERATED` and `REMESHED`.
  - Ensure transfer list uses the same arrays.

2) Ensure `VoxelTerrain` stores water arrays on initial chunk load:
- `src/features/terrain/components/VoxelTerrain.tsx`
  - In the `GENERATED` path, map `payload.meshWater*` into the created `ChunkState`.
  - In the `REMESHED` path, keep the existing `meshWater*` update logic (once worker sends correctly named fields).

Acceptance criteria:
- With a temporary stubbed `meshWaterPositions` (e.g., a single quad), `ChunkMesh` renders it using `WaterMaterial`.

---

### Step B — Generate Water Surface Mesh in the Mesher
**Goal:** produce per-chunk `waterPositions/waterIndices/waterNormals` (then delivered as `meshWater*` via Step A).

Where:
- Primary implementation inside `src/features/terrain/logic/mesher.ts` (or extracted helper `waterMesher.ts` if we want separation).

Algorithm (V1 surface-only):
1) Identify “water surface cells”:
   - A voxel cell `(x,y,z)` is “liquid” if:
     - `density[x,y,z] <= ISO_LEVEL` AND
     - `material[x,y,z] === WATER` (and also allow `ICE` if `density <= ISO_LEVEL` for frozen oceans).
   - A cell contributes a **top surface** if the cell above is not liquid.

2) Convert liquid surface cells into quads:
   - For each `(x,z)` in the chunk interior `[PAD .. PAD+CHUNK_SIZE_XZ)`:
     - Find the highest `y` such that cell is liquid and cell above is not liquid.
     - Emit a quad at **water surface height**.
       - For oceans: prefer a constant plane at `y = WATER_LEVEL` (world Y).
       - For lakes (future): use per-column surface derived from fill height.

3) Reduce geometry with 2D greedy meshing:
   - On the water surface “mask” grid (32×32), merge adjacent tiles into rectangles.
   - Emit 2 triangles per rectangle.
   - Normals: default `(0,1,0)` (can compute per-vertex later if we add waves/displacement).

4) Chunk seam correctness:
   - Use the same “interior half-open” convention as terrain:
     - generate surface tiles only for columns inside the chunk’s owned range,
     - rely on chunk-local x/z edges to meet neighbor chunk edges exactly.

Outputs:
- `waterPositions: Float32Array` (vec3 per vertex)
- `waterIndices: Uint32Array`
- `waterNormals: Float32Array` (vec3 per vertex, initially up)

Notes:
- We will keep terrain meshing (Surface Nets) untouched.
- We will **not** force GLSL versions globally; only the existing `WaterMaterial` uses GLSL3 because it’s written with GLSL3 I/O.

Acceptance criteria:
- Ocean/lake surfaces render as a coherent sheet across chunk boundaries.
- No obvious cracks between chunks at the waterline.

---

### Step C — Fix Terrain Generation Water Placement (So Water Appears Where It Should)
Where:
- `src/features/terrain/logic/terrainService.ts`

Change:
- Replace the current “all air below sea level becomes WATER” rule with “fill water above the local terrain surface up to `WATER_LEVEL`”.

Concrete approach:
1) For each `(x,z)` column:
   - Compute `surfaceHeight` once (it’s already computed in the existing standard-terrain branch).
2) During the y loop:
   - If `wy` is above the terrain surface and below `WATER_LEVEL`:
     - set `material[idx] = WATER` (or `ICE` in cold biomes),
     - set `wetness[idx] = 255` for water.
   - Else leave as AIR (if density is air) as usual.

Acceptance criteria:
- Underground caves below sea level are not automatically filled unless their column’s surface is below sea level.

---

### Step D — Player Interaction: Buoyancy + Swimming + Underwater Visuals

#### D1) Water Queries (fast, no physics colliders)
Add a runtime query utility so the player can ask: “am I in water at (x,y,z)?”

Where:
- New module: `src/features/terrain/logic/TerrainRuntime.ts` (singleton pattern similar to `metadataDB`/`simulationManager`).

Responsibilities:
- VoxelTerrain registers/unregisters active chunk `density/material` arrays (by key).
- Expose:
  - `getMaterialAtWorld(x,y,z): MaterialType | null`
  - `isLiquidAtWorld(x,y,z): boolean` (checks `density <= ISO_LEVEL` and `material==WATER` or `ICE(surface)`).
  - Optional: `getLiquidSurfaceYAtWorld(x,z): number | null` (scan upward within a bounded band to find surface).

Where it is updated:
- `src/features/terrain/components/VoxelTerrain.tsx`:
  - on `GENERATED`: register chunk arrays,
  - on unload: unregister,
  - on edit/remesh: re-register (or reuse references since arrays are mutated in-place).

#### D2) Swimming/Buoyancy in Player Controller
Where:
- `src/features/player/Player.tsx`

Behavior:
- Determine submersion by sampling a few points along the capsule:
  - feet, waist, head.
- If submerged:
  - reduce horizontal speed (`PLAYER_SPEED * 0.5` or similar),
  - apply vertical control:
    - `Space` swims up, `Shift` swims down,
    - otherwise buoyancy tends toward a neutral float near the surface.
  - optionally dampen velocity (simulate drag).

Implementation detail:
- Player currently overwrites velocity each frame via `setLinvel`.
  - We’ll keep that structure, but modify the chosen `yVelocity` and horizontal magnitude based on `inWater` / `submersion`.
  - We will not introduce Rapier forces unless needed.

#### D3) Underwater Visual Treatment
Where:
- `src/state/EnvironmentStore.ts` + `src/App.tsx` (Atmosphere/fog controller area)

Add:
- `underwaterBlend` (0..1) and `isUnderwater` boolean, updated from the Player (or from `TerrainRuntime` + camera position).

Effects:
- Increase fog density / shift fog color toward blue-green when underwater.
- Optionally reduce sun intensity and bloom underwater.

Acceptance criteria:
- Entering water gives immediate movement + visual feedback (swim feel).
- Underwater has distinct fog/color.

---

### Step E (Optional, Later) — Dynamic Water Flow
Where:
- `src/features/flora/workers/simulation.worker.ts` + `SimulationManager`

Plan:
- Re-enable water simulation only after rendering + interaction is stable.
- Optimize by:
  - simulating only within `SIMULATION_DISTANCE`,
  - rate-limit remesh (batch updates and remesh at most N chunks per second),
  - sending only dirty-chunk keys and reusing existing `REMESH` pipeline.

Data upgrade (if needed):
- Add a `waterLevel` metadata layer (`Uint8Array`) for 0..8 fill levels (Minecraft-style), instead of binary water.
- This would require updating:
  - `ChunkMetadata` generation,
  - worker transfer,
  - persistence (if we want saved water), ideally via metadata DB rather than `WorldDB` mods.

---

## 4) Debugging & Visual Verification Checklist

Recommended debug additions (optional):
- `?debug` panel:
  - “Water Surface Wireframe”
  - “Water Opacity”
  - “Underwater Fog Strength”

Manual visual inspection procedure (per AGENTS.md):
1) Start `npm run dev`, wait 10 seconds after world appears.
2) Take 4 screenshots:
   - (1) shoreline chunk seam at waterline,
   - (2) view across multiple chunks of ocean surface,
   - (3) underwater view (fog + movement),
   - (4) player-placed water near terrain edits.

---

## 5) Performance Considerations
- Water meshing must be **O(CHUNK_SIZE²)** for surfaces (32×32) and avoid full 3D scans when possible.
- Greedy meshing reduces vertices dramatically on large oceans.
- Avoid generating seabed-facing water faces (surface-only approach).
- Keep water mesh separate from physics (no colliders).

---

## 6) Milestones / Delivery Order

1) Fix payload naming + wiring (Step A)
2) Water surface meshing + render (Step B)
3) Terrain generation placement fix (Step C)
4) Player swim/buoyancy + underwater visuals (Step D)
5) Optional water flow simulation (Step E)

---

## 7) Open Questions (Need Your Decisions Before Implementation)

1) **Scope:** Do you want V1 to be “ocean/lake surface only” (recommended), or full volumetric water faces?
  A: Ocean/lake surfaces - prefer lakes, if ocean make them smaller in size so they can be travelled through. 
2) **Caves:** Should sealed caves below sea level stay dry (recommended), or should they flood as today?
  A: Sealed caves should stay dry, but there should be tunnels in the sea leading to dry caves.
3) **Ice:** Should frozen oceans use:
   - A distinct `IceSurfaceMaterial`, or
   - The same `WaterMaterial` with different parameters (no waves, higher opacity)?
   A: IceSurfaceMaterial
4) **Player:** Should underwater movement switch to a dedicated “swim mode” (like flying) or just modify normal movement?
A: Dedicated mode will be easier to edit. 
5) **Persistence:** Do we need water edits to persist across reloads (requires actually saving modifications; currently `saveModification(...)` is not called anywhere)?
  A: not for now. 

