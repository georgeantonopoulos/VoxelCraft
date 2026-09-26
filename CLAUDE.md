# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run test:unit    # Run Vitest tests
npm run preview      # Preview production build
```

## General Instructions

- **Exploration**: Use `ls -R`, `grep`, and `cat` to fully understand the existing architecture and patterns before proposing changes.
- **Incremental Development**: Break complex tasks into small, logical steps. Verify each step by running tests or builds.
- **Verification**: Always run `npm run test:unit` and `npm run build` after modifications. If changes affect the UI, suggest a manual smoke test via `npm run dev`.
- **Clarification**: If an instruction is ambiguous or contradicts the existing architecture, stop and ask for clarification rather than making assumptions.
- **Code Standards**: Adhere to the "Senior Software Architect" persona. Use strict TypeScript (avoid `any`), maintain existing documentation, and follow the project's established modular patterns.
- **Safety**: Do not modify `.env` files or core infrastructure configs unless explicitly directed.



## Architecture Overview

VoxelCraft is a voxel terrain engine using React Three Fiber, Three.js, and Rapier physics. Heavy computation runs in web workers to maintain 60 FPS.

### Terrain Pipeline

```
Player moves → Calculate visible chunks (RENDER_DISTANCE=3)
    → ChunkDataManager checks memory cache (LRU, maxSize=150)
    → If miss: Check IndexedDB for player modifications (WorldDB)
    → If miss: Worker generates chunk via 3D Simplex noise
    → Apply persisted modifications if they exist
    → Generate voxel light grid (8×32×8 cells, sky + point lights)
    → Surface Nets meshing produces smooth geometry with baked GI
    → Trimesh colliders created (throttled via colliderEnableQueue)
    → ChunkMesh mounted with TriplanarMaterial
    → Player modifications tracked as dirty in ChunkDataManager
    → Dirty chunks persisted to IndexedDB (debounced 2s)
```

### Key Directories

- `src/core/` - Shared engine: materials, shaders, worker pools, math utilities, lighting
  - `items/ItemGeometry.ts` - Single source of truth for all item visuals, geometry, colors
- `src/features/terrain/` - Chunk generation, meshing, streaming
  - `components/VoxelTerrain.tsx` - Chunk streaming and rendering orchestration
  - `hooks/useTerrainInteraction.ts` - Dig, build, chop, smash interaction logic
  - `logic/mesher.ts`, `raycastUtils.ts` - Meshing and raycast utilities
- `src/features/flora/` - Trees, vegetation, particle systems
- `src/features/player/` - Movement, input, camera
- `src/features/interaction/` - Tools, digging, building, inventory
- `src/features/environment/` - Atmosphere, post-processing, lighting
- `src/state/` - Zustand stores (Settings, Inventory, World, Entity tracking)
- `src/tests/` - Vitest unit tests (mesher, terrain, stores)

### Worker Architecture

Workers handle expensive operations via `WorkerPool` (src/core/workers/WorkerPool.ts):
- `terrain.worker.ts` - Chunk generation, light grid, meshing
- `simulation.worker.ts` - Flora updates
- `fractal.worker.ts` - Tree geometry generation

Message format: `{ type: string, payload: {...} }`. Use transferables for Float32Arrays.

### Lighting System

**Voxel-based Global Illumination** (src/core/lighting/lightPropagation.ts):
- Low-res 3D light grid (8×32×8 cells, LIGHT_CELL_SIZE=4 voxels per cell)
- Sky light traces down from above, attenuates through solid voxels
- Point lights (torches, Lumina) seed grid with colored light
- 6-iteration flood-fill propagation spreads light through space
- Per-vertex light colors baked into mesh (aLightColor attribute)
- Zero runtime cost - light is fully baked during meshing

Ambient light reduced to minimal levels (surface: 0.08, cave: 0.04). GI provides all indirect lighting.

### Audio System

**AudioManager** (src/core/audio/AudioManager.ts) - Centralized audio playback system:
- **Singleton pattern**: One global instance initialized on app mount
- **Pool-based**: Each sound has multiple HTMLAudioElement instances for overlapping playback
- **Event-driven**: Listens to `vc-audio-*` custom events (play, stop, ambient-enter, ambient-exit)
- **Category-based volume**: SFX_IMPACT, SFX_DIG, SFX_CHOP, SFX_INTERACT, AMBIENT, UI, MUSIC

**Procedural ambience** (src/core/audio/ambience/ProceduralAmbience.ts), owned by AudioManager as `audioManager.ambience`:
- Leaf rustle is positional: up to 4 HRTF emitters attach to the nearest real trees (`chunk.treePositions`, crown height, per-type strength, cacti silent), each gusting on its own, over a faint bed scaled by nearby tree density. AmbienceDirector moves the Web Audio listener to the camera every frame (`setListener`) and re-picks trees every 0.5 s (`setLeafSources`). Stats: `__audioManager.ambience.getStats().leafEmitters`.
- Web Audio synthesis, no samples: wind (rumble + whistle, gusts), leaf rustle, river/sea water, bird species phrases (day, dawn chorus), crickets and owls (night), cicadas (heat), cave drone + drips through a generated reverb, underwater low-pass.
- Starts on the first pointerdown/keydown (autoplay policy). Driven by `AmbienceDirector` (features/environment/components) every 0.5 s from biome, climate, water proximity (getHeightAt rings), exposure, sun height, EnvironmentStore.
- Audition: `__audioManager.ambience.debugLockScene({...})`, `debugCapture(seconds)` (PCM for WAV export); `getStats()`.
- Footsteps: Player dispatches `vc-audio-footstep` { surface: grass|dirt|sand|stone|snow|water, loudness } once per stride (1.9 m, 1.1 m crouched) from the material under the feet; `ambience.footstep()` synthesises a filtered noise burst (+ low thump / grains per surface) through the underwater muffle.
- Music (`ambience/GroveMusic.ts`): sparse generative score, mostly silence. Glass-bell phrases every 15-45 s (D major pentatonic by day, minor + flat six at night/underground), a slow pad at dawn/dusk/caves, long dark reverb. Motifs via `window.dispatchEvent(new CustomEvent('vc-music-cue', { detail: { kind } }))` (quest-start/-complete, rank-up, discovery from HUD toasts; hollow-restored from GroveDirector). Own volume (Settings → Music); `debugCapture` includes it.

**Sound Registry** (src/core/audio/soundRegistry.ts):
- Single source of truth for all sound definitions
- Each sound: id, URL, category, baseVolume, pitchVariation, poolSize
- Helpers: `getRandomDigSound()`, `isSoundRegistered()`

**Usage pattern**:
```typescript
// Dispatch event from anywhere in the codebase
window.dispatchEvent(new CustomEvent('vc-audio-play', {
  detail: { soundId: 'rock_hit', options: { pitch: 1.2, volume: 0.8 } }
}));
```

**Integration points**:
- `App.tsx`: `audioManager.initialize(SOUND_REGISTRY)` on mount
- `useTerrainInteraction.ts`: Dig/build/chop sounds
- `PhysicsItem.tsx`: Stone impact sounds

### State Management

11 Zustand stores handle different concerns:
- `SettingsStore` - Graphics quality, input mode
- `InventoryStore` - Player inventory (9 slots)
- `WorldStore` - Active entities (flora, torches, items)
- `EntityHistoryStore` - Health/damage tracking
- `ChunkCache` / `WorldDB` - IndexedDB persistence

**ChunkDataManager** (src/core/terrain/ChunkDataManager.ts):
- Single source of truth for all chunk data
- LRU cache (maxSize=150) with dirty chunk protection
- Event system (chunk-ready, chunk-updated, chunk-remove, chunk-dirty)
- Dirty tracking for player-modified chunks (digging, flora pickup, tree removal)
- Debounced persistence to WorldDB (2s delay)

### Material System

TriplanarMaterial uses custom shaders with:
- Sharp triplanar blending (power 8) across 16 materials
- Material weight channels (matWeightsA-D, 4 materials each)
- Per-vertex GI light (aLightColor attribute) from voxel light grid
- Shared uniforms updated once per frame in VoxelTerrain.tsx

### Item System

**ItemGeometry.ts** (src/core/items/ItemGeometry.ts) is the single source of truth for all item visuals:
- Unified color palette matching terrain materials for world coherence
- Geometry factories: createStickGeometry(), createStoneGeometry(), createShardGeometry(), createLargeRockGeometry(), createLashingGeometry()
- Material variant system (obsidian, basalt, sandstone, clay stones; flint, volcanic shards)
- Geometry caching for performance (geometries created once and reused)
- Used by: UniversalTool (held/crafting), GroundItemsLayer (terrain clutter), PhysicsItem (thrown), ItemThumbnail (inventory)

Stones are procedural (`buildRockGeometry`: welded icosphere, fBm displacement, a few fracture-plane cuts, flattened underside; several shape variants, plus per-instance proportions in ROCK_SHADER). Shards are knapped flakes (`createShardGeometry`: thick central ridge, thin edges, flat facet scars; tip +Y, blade in XY for the crafting slots). Ground sticks use `createGroundStickGeometry` (tapered, bent, with a broken side twig); held sticks stay straight for attachments. Stone and flint are dielectrics: metalness 0 (metal reflected an empty environment and rendered black). In the item shaders the non-instanced branch must write `csm_Position` with the same transform as `csm_Normal`. Lashing geometry uses helix curves for realistic tool bindings. Hotbar icons are SVG line glyphs (`src/ui/grove/ItemGlyph.tsx`), not 3D thumbnails. Lumina flora (world LuminaLayer, placed/thrown LuminaFlora, held FloraMesh) is one plant shape from `createLuminaPlantGeometry` (dark arching stems, drooping glowing pods, base leaves), glow colour #62e6d8; never plain glowing spheres.

### Item Shader System

**GroundItemShaders.ts** (src/core/graphics/GroundItemShaders.ts) is the single source of truth for all item shaders:

| Shader | Purpose | Key Effects |
|--------|---------|-------------|
| `STICK_SHADER` | Wood/bark materials | Wood grain, bark ridges, knots, weathering, micro fibers |
| `ROCK_SHADER` | Stone materials | Mineral crystals, mica shimmer, veins, iron staining, moss |
| `SHARD_SHADER` | Obsidian/flint shards | Conchoidal fractures, iridescence, flow banding, edge highlights |
| `FLORA_SHADER` | Bioluminescent flora | Cell structure, pulsing veins, subsurface scattering, breathing animation |
| `TORCH_SHADER` | Torch handle wood | Wood grain with charring gradient toward flame end |

Each shader has both `vertex` and `fragment` properties. **When modifying item visuals, update the shader in GroundItemShaders.ts** - all consumers will inherit the change.

**Consumers of GroundItemShaders** (update ALL when changing shaders):
- `UniversalTool.tsx` - Held items, crafting preview (StickMesh, StoneMesh, ShardMesh, FloraMesh, Torch)
- `GroundItemsLayer.tsx` - Terrain clutter (instanced rendering with `uInstancing: true`)
- `PhysicsItem.tsx` - Thrown items (uses UniversalTool internally)
- `LuminaFlora.tsx` - World flora (has its own pooled material, may need sync with FLORA_SHADER)

**Uniform requirements by shader**:
- All shaders: `uSeed`, `uNoiseTexture`, `uColor`
- STICK: `uInstancing`, `uHeight`
- ROCK/SHARD: `uInstancing`, `uDisplacementStrength`
- FLORA: `uTime` (animated)
- Instanced rendering adds: `aInstancePos`, `aInstanceNormal`, `aSeed` attributes

### Grove Progression (Keeper's Path)

Gameplay layer that gives the world a goal: restore dormant Root Hollows.
- `src/features/grove/questLine.ts` - **Pure** rules: quest chain (+ endless "Renewal" tiers), ranks, essence, `computeVitality`, `strideMultiplier`. Unit tested in `src/tests/grove.test.ts`.
- `src/state/GroveStore.ts` - Progression state, persisted to localStorage per world seed (`vc-grove-v1-<seed>`). Debug: `window.__groveStore.getState()`.
- `src/features/grove/groveEvents.ts` - `vc-grove-event` bus (`hollow-awakened`, `hollow-restored`, `tree-felled`, `torch-placed`). Emit from gameplay code; never import GroveStore into terrain/flora logic.
- `src/features/grove/GroveDirector.tsx` - Headless: inventory deltas → stats, biome discovery, nights endured, Lumina Sense compass (loaded-chunk hollows, else long-range Sacred Grove centre scan). Slow timers only.
- `src/ui/GroveHUD.tsx` - Quest tracker, rank/essence/vitality, compass strip, toasts, H-toggle controls.
- RootHollow reads `restoredHollows` on mount, so restored hollows stay grown across chunk reloads.

### UI Design Language (2026-09)

Direction: calm, immersive, slightly eerie; nothing on screen that isn't needed right now.
- Tokens and components live in `src/index.css` (`@theme` colours night/bark/moss/lichen/parchment/lumina/ember/spore; `grove-panel`, `grove-button`, `grove-button-quiet`, `grove-choice`, `grove-key`, `grove-eyebrow`, `grove-text-shadow`). Fonts: Cormorant Garamond (display) + Alegreya Sans (body), loaded in `index.html`. No slate/emerald Tailwind defaults, no emoji icons, no dark boxes behind floating text (text shadow only).
- Shared ornaments: `src/ui/grove/GroveOrnaments.tsx` (VineRule, RealmGlyph, FireflyField, GroveLogo). GroveLogo blends the key art with `mix-blend-mode: screen` on the `<img>` itself: a mask or animated opacity on a wrapper isolates it and the blend stops working.
- Quiet HUD: `HudPresenceStore` + `HudPresenceDirector`. Quest tracker, vitality, controls fade out after calm spells; compass rests at 50%, hotbar at 28%. Woken by progress, pickups, item switches, Tab (hold), pause. Touch mode holds it awake.
- `PauseVeil`: shown whenever the pointer is unlocked in mouse mode ("Click to begin" / "Paused").
- Title screen offers Continue for the last world (`src/state/lastWorld.ts`; progress is per seed).
- Surface stones are placed as composed groups (tide-line stones, a boulder with stones at its foot), not an even scatter.
- Sun path is tilted (`ORBIT_TILT` in celestial.ts, noon ~56°) and the sky fill is ~1/6 of the sun, so light always has a direction. Fog: clear to ~30 m, soft distance (exp2 density 2.2/range).
- Haze budget: bloom threshold 0.95 (only sun/Lumina/fire bloom; 0.4 bloomed the whole sky into a veil), sun shafts sample only sky near the sun, small sun disc without starburst, soft cloud layer in the sky dome.
- Underground: fog colour blends to near-black; terrain fog is scaled by baked GI so cave mouths read dark from outside. Keeper's glow (`uPlayerGlow` emissive in TriplanarShader + pooled `KeeperLight` for objects) lights a few metres around the player in caves and faintly at deep night.
- Wet ground roughness bottoms out at ~0.45 and caustics fade in with depth (ground just under sea level is usually dry). Water sheet drops interior pools shallower than 0.5 m (`dropShallowPools`).
- Dormant Root Hollows sit in drained DIRT over stone (no blade grass: `generateMaterialMaskTexture` skips grove columns). Wildlife is rare by design (one small flock, a lone deer or pair).

### Post-Processing Pipeline

`CinematicComposer.tsx`: SunShafts → N8AO → Bloom + GroveGrade (merged) → [underwater CA] → SMAA, `multisampling={0}`.
- `effects/GroveEffects.ts`: `GroveGradeEffect` (exposure, AgX, vitality grade, restore pulse, underwater, vignette, grain) and `SunShaftsEffect` (depth + convolution). Uniforms are written in `useFrame`, **never via props** (prop changes recreate effects and recompile shaders).
- SunShafts must stay before N8AO (otherwise GL feedback loop).
- `AdaptiveResolution.tsx`: dynamic DPR (50/58 FPS hysteresis, min 0.55× of user resolution). Debug: `window.__vcDynamicResolution`.
- Presets low/medium/high/ultra in `SettingsStore` (`godRays`, `antialias`, `dynamicResolution`, `aoQuality`).

### Engineering Guard Rails (added 2026-09)

- **Golden terrain test** (`src/tests/terrainGolden.test.ts`): fingerprints voxel signs, materials, placements and meshes. Performance refactors must keep it green. Intentional generator changes: bump `GEN_VERSION` (src/constants.ts) and re-record with `UPDATE_GOLDEN=1 npx vitest run src/tests/terrainGolden.test.ts`.
- **Generation invariants** (`src/tests/generationInvariants.test.ts`): no NaN placements, sticks near trees, flora owned by one chunk, cave rocks exist, world types behave.
- **Benchmark**: `npm run bench` (src/bench/terrainPipeline.bench.ts) - per-chunk generate/light/mesh timings. Not part of test:unit.
- **World-scoped persistence**: IndexedDB chunk ids are `<seed>:<worldType>:g<GEN_VERSION>|cx,cz` (`src/state/worldKey.ts`). Main thread sets it in VoxelTerrain, workers on CONFIGURE.
- **ChunkDataManager.addChunk returns the canonical chunk** (merged for dirty chunks). Render/register that, never raw worker output. Merges keep only PLAYER_OWNED_FIELDS from the existing chunk.
- **Point lights**: use `<PooledPointLight>` (src/core/graphics/PointLightPool.tsx) for world lights, never raw `<pointLight>` in the main scene; the pool keeps the real light count constant so lit shaders never recompile. Separate canvases (thumbnails, crafting) may use `<pointLight>`.
- **Terrain shape** (`src/features/terrain/logic/terrainShape.ts`): single source of the column surface height (rolling fBm, eroded ridged mountains, arid terraces, river valleys cut below sea level so the water post-pass fills them). `generateChunk` and `getHeightAt` both call `columnInfo()`; never duplicate the formula. Overhang noise fades out 5 m above the surface (`overhangFade`) so no floating rock. Steep columns (slope > ~0.85) expose the biome's underground rock. Tests: `terrainShape.test.ts` (bounds, tears, relief, rivers, parameter continuity).
- **Terrain PBR textures** (`src/core/graphics/pbr/`): layers synthesised in workers, cached in IndexedDB by `PBR_SYNTH_VERSION` (bump when synthesis output changes). Preview/tune with a contact sheet rather than in-game. Debug: `window.__terrainView(n)` (5 GI light, 6 albedo, 7 normal; null restores).
- **Trees** (`src/features/flora/trees/`): `treeGrowth.ts` grows species skeletons (gravitropism, curvature noise, whorls for pines, buttress roots) into tapered bark tubes with parallel-transport frames, plus alpha-tested leaf cards with crown-shaped normals. `leafAtlas.ts` draws the leaf textures on a canvas at load. `TreeGeometryFactory` caches per (type, variant, LOD) and keeps the old interface (aBranchDepth/Axis/Origin, aLeafRand). Leaf cards need `customDepthMaterial` (TreeLayer) for cut-out shadows. Keep colliders to <= ~5 per tree (trunk pieces + thickest limbs). Both LODs grow the same skeleton and the same leaf cards (low only drops twig tubes and ring sides), and far crowns fade by each tree's own distance in the leaf shader, never by chunk LOD tier (tier steps made whole chunks of trees change shape and lose leaves at once; `treeGrowth.test.ts`). Bark noise is mapped in real distances (arc length around, length along the branch), never the raw angle (twigs smeared). Leaf atlas paints every leaf inside the canvas with a margin (`fitLeaf`/`inside`), or cards show straight cuts. Bark colours live in TreeLayer and FallingTree: keep them in step.
- **Creature meshes** (`wildlifeMeshes.ts`): deer and rootling bodies are lofted tubes (`loft`: parametric Catmull-Rom sampling, parallel-transport frames, outward winding). Rotate parts before translating them (rotating after swung necks/leaves around the world origin), and three's `smoothstep(x, min, max)` needs min < max. Preview a creature in isolation rather than chasing one in-world (deer flee).
- **Wildlife** (`src/features/creatures/wildlife/`): `wildlifeSim.ts` is pure behaviour (bird flocks: boids, landing/feeding/take-off; deer herds: graze/walk/alert/flee, avoid water; fish schools: cruise/dart/leap; rootling guide: wait/lead/arrive/burrow). `WildlifeManager.tsx` spawns groups 35-80 m out by habitat, scales populations with world vitality, and renders one InstancedMesh per species; `wildlifeMeshes.ts` builds the meshes and animates rig parts in the vertex shader (per-instance `aAnim`). Terrain queries go through a cached 1 m height grid. Rootlings lead to the Lumina compass target and grant the `creaturesGuided` stat. Debug: `window.__wildlife.summary()`. Tests: `wildlife.test.ts`.
- **Terrain colliders**: heightfield where no air sits under solid ground, otherwise the rendered mesh itself is the trimesh (a coarser collider sat up to 1 m off the surface; `colliderMatchesSurface.test.ts`). ChunkMesh gets `colliderEnabled` as a primitive prop and its memo comparison (`chunkMeshPropsEqual`) must include it: ignoring it left late-enabled chunks with no physics body (players fell through). Debug: `__vcDebug.terrainBodies()`, `rayDown(x,y,z)`, `collidersNear(x,y,z,r)`.
- **Terrain material blend** (TriplanarShader): anything that differs per layer must be weighted by the blend (never keyed to "c0" alone). c0/c1 swap where two layers are equal, and a c0-only term drew hard, triangle-aligned lines there (jitter sign, anti-tiling far sample).
- **Placement randomness**: use `hash01` (uniform, seeded) from `@core/math/noise`; map coherent Perlin through `noiseToUniform` before comparing to probability thresholds (raw Perlin sigma is ~0.25).
- **Worker pool**: `postBulk` for generation, `postPriority` for remeshes; workers must always reply (ERROR on failure).
- **Worker construction**: always write `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` inline at the call site (`WorkerPool` takes a factory). Vite only bundles that exact form; anything else works in `npm run dev` but ships raw TypeScript in production builds, so no terrain at all. Enforced by `src/tests/workerBundling.test.ts`. Smoke-test `npm run build` output (e.g. `npx vite preview`), not just the dev server.
- **Constant light count**: never mount/unmount or toggle `visible` on lights during play; dim them to intensity 0 instead (TorchTool, FirstPersonTools). Any change in the number of visible lights recompiles every lit shader. `SceneWarmup` precompiles the scene once with `gl.compileAsync` after load.
- **CustomShaderMaterial (React) uniforms**: pass a memoized/module-level object, never an inline `uniforms={{...}}`. The wrapper disposes and rebuilds the material whenever the uniforms object identity changes, so a literal recompiles it on every re-render.
- **Shared materials**: never write per-object uniform values in `onBeforeRender` on a material shared by several meshes. three.js skips material uniform uploads between consecutive draws of the same material. Pool materials per value instead (e.g. TreeLayer leaf LOD alpha).
- **Impact effects** (`src/features/interaction/components/ImpactFX.tsx`): `emitImpact({ position, direction, kind: stone|earth|sand|wood|leaf|snow, color, strength })` throws chips that land and rest, plus dust for earth/sand. Event-driven, GPU-animated; stamp times with the render clock (a page-time stamp put every burst in the future: debris never showed). useTerrainInteraction's `emitParticle` routes here (set `fx`), never through React state. Knapping: `knapShards` in useTerrainInteraction. Strike rays must skip untagged bodies (the player's capsule) and use `STRIKE_REACH`.
- **Instanced orientation bases must be right-handed** (`bitangent = cross(tangent, up)` for `mat3(tangent, up, bitangent)`). A mirrored basis turns meshes inside-out; ground items are DoubleSide, so they still drew, lit from inside, and read as dark holes in the grass.
- **CSM `main()` is inlined** into three's main: never `return;` early in a CSM shader (the vertex path then never writes gl_Position, the fragment path never writes the colour). Use if/else. Enforced by `src/tests/csmShaderRules.test.ts`.
- **CSM `csm_AO`** is the occlusion *amount* (`indirectDiffuse *= 1 - csm_AO`), not visibility. Writing an AO map value (1 = open) straight into it removed all sky light from shadowed terrain (black shadows).
- **GLSL `smoothstep`**: edges must satisfy edge0 < edge1 (reversed or equal edges are undefined and can produce NaN). For a falling ramp write `1.0 - smoothstep(lo, hi, x)`. Also guard `atan(y, x)` at (0,0) and `normalize()` of possibly-zero vectors.

### Water (reworked 2026-09)

- Geometry (`generateWaterSurfaceMesh`): shared-vertex grid over the wet area = sea cells flood-filled across connected columns whose terrain top is below `WATER_LEVEL`, dilated one cell. Inland pits and roofed caves stay dry.
- Shading (`WaterMaterial.tsx`): one material per water chunk (clones share one program). Each gets the chunk's surface height map (`grassHeightTex`) as a half-float seabed texture, so the shader knows true depth: shoreline fade at depth 0, turquoise-to-deep colour, animated shore foam, discard where depth <= 0. Camera/fog uniforms are shared objects updated once per frame.
- Underwater visuals follow the camera eye vs. the real surface height (`Player.tsx`), not body submersion.
- Debug: `window.__waterDebug(n)` (1 depth, 2 seabed bound, 3 contour stripes, 0 normal); `window.__vcDebug.teleport(x,y,z)` / `.look(yaw,pitch)` for browser checks without pointer lock.
- Vite's file watcher misses edits on external volumes: restart `npm run dev` after edits when running from /Volumes.

## Critical Constants (src/constants.ts)

```
CHUNK_SIZE_XZ = 32, CHUNK_SIZE_Y = 128, PAD = 2
ISO_LEVEL = 0.5 (density threshold)
RENDER_DISTANCE = 3 (49 chunks max)
WATER_LEVEL = 4.5

Light Grid (GI):
LIGHT_CELL_SIZE = 4 (each cell = 4×4×4 voxels)
LIGHT_GRID_SIZE_XZ = 8, LIGHT_GRID_SIZE_Y = 32 (2048 cells/chunk)
LIGHT_PROPAGATION_ITERATIONS = 6
LIGHT_FALLOFF = 0.82, SKY_LIGHT_ATTENUATION = 0.15 (retained per SOLID cell; air passes sky light fully)
```

Changing these breaks mesher output dimensions and worker communication. Light grid dimensions must divide evenly into chunk size.

## Debug Flags

- `?debug` - Enable Leva debug panels (sun, shadows, fog controls, GI toggle)
- `?mode=map` - Biome/map debug view
- `?normals` - Normal material for geometry inspection
- `?profile` or `localStorage.vcProfiler = "1"` - Enable FrameProfiler with spike detection
- `?benchmark` or `?benchmark=N` - Run FPS benchmark for N seconds (default 5s), reports pass/fail against 40 FPS threshold
- `?nocolliders` - Disable all terrain colliders (physics debugging)
- `?nosim` - Disable simulation worker (performance isolation)
- `?nominimap` - Disable minimap rendering (performance isolation)
- `localStorage.vcDebugPlacement = "1"` - Vegetation placement debug
- `window.__chunkDataManager.getStats()` - View chunk cache stats (total, dirty, pending persistence, memory MB)
- `window.__fpsBenchmark.start()` - Manually trigger FPS benchmark from console
- `window.__fpsBenchmarkResult` - Access last benchmark results (avgFps, minFps, p1Fps, passed)
- `window.__audioManager.getStats()` - View audio pool stats (totalSounds, totalInstances, activeLoops, categories)

**GI Tuning**: uGIEnabled (0/1 toggle), uGIIntensity (multiplier, default 1.0: baked open-sky light is ~1.0, so albedo is neutral in the open and darkens in enclosed spaces) accessible via debug panel.

## Key Invariants

See `AGENTS.md` for the complete list. Most critical:

1. **Chunk data ownership**: ChunkDataManager is the single source of truth. Always use `chunkDataManager.getChunk(key)` to access chunk data. Never mutate chunk data directly - use `markDirty()` or `modifyTerrain()`.
2. **Collider throttling**: Trimesh creation causes 10-30ms stalls. Always use `colliderEnableQueue`.
3. **CustomShaderMaterial**: Use `three-custom-shader-material/vanilla` for class usage. Never redeclare `normal`, `vNormal`, `vViewDir`, or `vViewPosition` in custom shaders — these are reserved by Three.js's base material chunks.
4. **Material channels**: Mesher outputs matWeightsA-D bound in ChunkMesh.tsx. Shader expects this structure.
5. **Held item poses**: Never edit HeldItemPoses.ts directly - use in-game pose tooling. The tool is the dev-server endpoint `POST /__vc/held-item-poses` ({ kind: 'stick'|'stone'|'both'|'flora'|'shard', <kind>: { xOffset, y, z, scale, rotOffset } }); it rewrites one entry (single-line or multi-line) and keeps a `.bak`.
6. **Point light caps**: MAX_LIGHTS_PER_CHUNK = 8 to avoid React overhead.
7. **Light grid order**: Light grid generated BEFORE meshing in terrain.worker.ts. Mesher samples grid to bake per-vertex colors.
8. **Item visual consistency**: ItemGeometry.ts is the single source of truth for all item geometry, colors, and materials. Never define item visuals elsewhere.
9. **Item shader consistency**: GroundItemShaders.ts defines all item shaders (STICK, ROCK, SHARD, FLORA, TORCH). When adding visual detail to items, update the shader here - never copy shader code to individual components. All consumers (UniversalTool, GroundItemsLayer, LuminaFlora) must use both `vertex` AND `fragment` properties.
10. **Audio centralization**: AudioManager (src/core/audio/AudioManager.ts) is the single source of truth for all audio playback. NEVER call `new Audio()` or play sounds directly. Always dispatch `vc-audio-play` events. Sound definitions live in soundRegistry.ts. Only exception: 3D positional sounds (campfire `FireSound` in PhysicsItem.tsx) use drei `<PositionalAudio>` with the camera's AudioListener, since AudioManager has no spatialization. Ambient loops use dedicated elements, separate from the one-shot pools.

## Logging Best Practices

**Profile-only logging**: Console logs can cause significant performance overhead, especially in hot paths. Gate all timing/debug logs behind `?profile` URL param:

```typescript
// In React components - use shouldProfile()
const shouldProfile = () => typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('profile');

if (shouldProfile()) {
  console.log(`[Component] Operation took ${duration.toFixed(1)}ms`);
}

// In workers - check profileMode flag (set via CONFIGURE message)
let profileMode = false;
const profile = (label: string, fn: () => void) => {
  if (!profileMode) { fn(); return; }
  const start = performance.now();
  fn();
  const duration = performance.now() - start;
  if (duration > 1) console.log(`[worker] ${label}: ${duration.toFixed(1)}ms`);
};
```

**Never add console.log calls** that run every frame or on every chunk. Use `?profile` for performance debugging.

## Common Pitfalls

- `Array(n).fill(obj)` creates shared references - use `Array.from({length:n}, () => new Obj())`
- React StrictMode mounts effects twice - store timeout IDs in refs
- If `ShaderMaterial` has `fog=true`, must provide fogColor/fogNear/fogFar uniforms
- Ground items need original stride-8 data for interaction, not just optimized render buffers
- **React state batching**: Multiple `setState` calls per frame cause multiple reconciliations. Use batched update queues flushed once per frame (see `VoxelTerrain.tsx` `flushVersionUpdates`)
- **Version adds vs increments**: When adding new chunks to `chunkVersions`, use `queueVersionAdd` (sets value). `queueVersionIncrement` only works on existing entries

## Testing

Tests focus on math kernels (mesher, noise) and state logic. Located in `src/tests/`.

```bash
npm run test:unit    # Run all tests
```

### Testing Strategy

**Unit Tests (Vitest)**: Test pure math kernels, data structures, and logic functions.
- **When to use**: Mathematical operations, data transformations, store logic
- **Limitations**: Cannot test browser APIs (Audio, window events), React/R3F integration, or initialization-dependent singletons

**Integration Tests (Browser)**: Test systems that require DOM, browser APIs, or app initialization.
- **When to use**: Audio playback, event systems, singleton initialization, React component mounting
- **Method**: Manual smoke testing via `npm run dev`

### Audio System Testing

The AudioManager is a singleton that initializes on app mount and uses browser-native `HTMLAudioElement` and `CustomEvent` APIs. **It cannot be tested with Vitest** because:

1. **Singleton initialization**: `audioManager.initialize()` is called in `App.tsx` useEffect. Unit tests don't mount the app.
2. **Browser APIs**: Requires `new Audio()`, `window.addEventListener`, and `window.dispatchEvent`.
3. **Type imports**: `import type` vs value imports affect runtime but don't cause test failures.

**Testing approach**:
1. **Type errors**: Caught by `npm run build` (TypeScript compilation)
2. **Import errors**: Only caught at runtime in browser (e.g., `SoundCategory` must be value import, not type import)
3. **Event system**: Test by triggering audio events in-game and verifying console logs / audio playback

**Smoke test checklist** (after implementing audio features):
```bash
npm run build        # Verify TypeScript compilation
npm run dev          # Start dev server
# In browser:
# 1. Check console for "[AudioManager] Initialized with N sounds"
# 2. Trigger digging action (verify dig sounds play)
# 3. Hit rock with rock (verify rock_hit plays)
# 4. Place torch (verify fire_loop starts)
# 5. Open browser DevTools console, verify no import errors
```

**Common audio pitfalls**:
- **Type-only imports**: `import type { SoundCategory }` fails at runtime if used as a value. Use `import { SoundCategory }` for enums/values.
- **Pool size**: Too small = overlapping sounds cut off. Too large = memory waste.
- **Event naming**: Custom events must match exactly (`'vc-audio-play'`, not `'audio-play'`).
- **Initialization order**: AudioManager MUST initialize before any audio events are dispatched.

## Subagent Usage Guide

Claude Code has access to specialized subagents for different tasks. **Use these proactively** - they reduce context usage and provide better results for their specialized domains.

### Available Subagents

| Agent | When to Use | Example Triggers |
|-------|-------------|------------------|
| **Explore** | Codebase exploration, finding files, understanding architecture | "Where is X handled?", "How does Y work?", "Find all files that..." |
| **Plan** | Designing implementation strategies for new features or refactors | "Add crafting system", "Refactor terrain pipeline", multi-file changes |
| **root-cause-analyst** | Debugging errors, stack traces, unexpected behavior | Error messages, "X is broken", "doesn't work", crashes |
| **docs-sync** | Updating CLAUDE.md/AGENTS.md after completing changes | After refactors, new features, architecture changes |
| **claude-code-guide** | Questions about Claude Code itself, hooks, MCP servers | "Can Claude do...", "How do I configure..." |
| **test-architect** | After implementing features, use to design and verify tests | New features, bug fixes needing regression tests |

### When to Use Each Agent

**Explore Agent** - Use for ANY open-ended codebase questions:
```
❌ Direct Glob/Grep for "where are errors handled?"
✅ Task(Explore): "Find where client errors are handled and explain the error handling pattern"
```

**Plan Agent** - Use BEFORE implementing non-trivial features:
```
❌ Start coding a new feature immediately
✅ Task(Plan): "Design implementation for player crafting system with inventory integration"
```

**Root Cause Analyst** - Use when user reports issues:
```
❌ Immediately try to fix based on error message
✅ Task(root-cause-analyst): "Investigate why terrain chunks aren't loading - user reports [error]"
```

**Docs Sync** - Use AFTER completing significant changes:
```
❌ Forget to update documentation
✅ Task(docs-sync): "Update CLAUDE.md and AGENTS.md after GI lighting system implementation"
```

**Test Architect** - Use AFTER implementing new features or fixing bugs:
```
❌ Implement feature without considering test coverage
✅ Task(test-architect): "Design tests for the new audio spatial system"
```

### Agent Usage Rules

1. **Prefer agents over direct tool calls** for complex searches - they explore more thoroughly
2. **Launch agents in parallel** when investigating multiple independent questions
3. **Always summarize agent results** back to the user - agent output is not visible to them
4. **Resume agents** using their ID for follow-up work in the same domain
5. **Use appropriate thoroughness** for Explore: "quick" for simple lookups, "very thorough" for architecture questions

6. **Shader debugger** - GLSL-specific debugging and optimization

### Missing Agents (Request These)

If you find yourself repeatedly doing similar complex tasks, consider requesting these specialized agents:
- **Performance profiler** - Systematic performance investigation
- **Test writer** - Generate tests for new functionality

- **Worker debugger** - Web Worker message flow analysis

## Detailed Engineering Guidance

See `AGENTS.md` for:
- Complete list of known pitfalls with code pointers
- Debug workflows and verification checklists
- Performance optimization details
- Worklog of recent changes
- If you notice important refactoring opportunities while doing other changes, make a note of them here for the future.

## Refactoring Opportunities

### Crafting System Enhancements (Identified 2026-01-04)

1. ~~**Ground Item Shader Consistency**~~: RESOLVED (2026-01-05) - All item shaders now centralized in `GroundItemShaders.ts` with both vertex and fragment shaders. UniversalTool, GroundItemsLayer, and all rendering contexts use the same shaders.

2. **Material Variant Persistence**: `StoneMesh` and `ShardMesh` now accept `variant` and `seed` props for material variety (obsidian, basalt, sandstone, clay), but item instances don't store this data. To make harvested items retain their biome-specific appearance:
   - Extend `ItemType` or create item metadata in `InventoryStore`
   - Store variant/seed when item is picked up
   - Pass stored values to mesh components

3. **GI Light Query System**: Tools currently use standard Three.js lighting. To integrate with the voxel GI system:
   - Expose `lightGrid` data from `ChunkDataManager` at runtime
   - Create a `sampleLightAtPosition(worldPos)` utility
   - Pass sampled light color to tool shaders
   - This would make tools respond to cave/surface lighting like terrain does

4. **Recipe System Formalization**: Recipes in `CraftingData.ts` are defined but loosely enforced. Consider:
   - Adding a `validateRecipe(attachments)` function
   - Showing recipe hints before all ingredients are attached
   - Supporting partial recipe matching for guidance

## Known Bugs

Resolved in the 2026-09 rework (kept here so they are not reintroduced):
- FractalTree never growing: RootHollow memoised on a fresh `position` array each render, restarting the 10s timer forever. Key memos on scalar coordinates.
- Root Hollow persistence: restored hollows persist in GroveStore (per seed); interrupted charging completes the restoration.
- Digs/builds never saved: `markDirty` must receive voxel indices (`TerrainService.brushVoxelIndices`).

Also resolved (2026-09, second pass):
- Chunk-border shading seams: normals are smoothed over a non-rendered one-cell border band, and the material/cavity blend kernel shrinks to radius 1 next to border planes (`src/tests/chunkSeams.test.ts`).
- Water through caves/pits: the water sheet is built only over sea-level water cells (dilated one cell, merged into rectangles) instead of a chunk-wide quad.
- Grass floating over digs: REMESH rebuilds the grass height/material/normal/cave textures; BladeGrassLayer swaps textures in place instead of recreating its material.
- Felled trees returning: persisted as `'tree'` ground-pickup records keyed by position (`src/state/pickupKeys.ts`).
- LuminaFlora shared uniforms: per-flora seed is a vertex attribute (`aSeed`); time comes from sharedUniforms.
- Production builds generated no terrain: the terrain worker was constructed from a URL variable, so Vite never bundled it (see Worker construction above).
- Crouch was on Ctrl (Ctrl+W closed the tab); it is now Z. Crouching keeps the feet planted and won't stand up under a ceiling.
- Log depth removed (`logarithmicDepthBuffer: false`): fog ends ~100m, so standard depth with near 0.1 is precise enough, and early-Z works again. Never write gl_FragDepth in custom shaders.

## Known Limitations

- Sharp terrain crests seen at grazing angles show a voxel-scale zig-zag silhouette (one Surface Nets vertex per cell). Fix idea: a constrained vertex relaxation pass in mesher.ts (move vertices toward the neighbour average, then re-project onto the isosurface along the gradient).

## Future Features (TODO)

### Sacred Grove Ecosystem (Planned)
Root Hollows are terraforming seeds that transform the landscape:
1. **Barren Zone**: Area around dormant Root Hollow is desert-like (RED_DESERT material)
2. **Tree Growth**: When FractalTree grows, it begins spreading life (NOT YET IMPLEMENTED)
3. **Humidity Spreading**: Gradual biome transformation from barren to lush (NOT YET IMPLEMENTED)
4. **Vegetation Spawning**: Trees and flora spawn in transformed areas (NOT YET IMPLEMENTED) 
