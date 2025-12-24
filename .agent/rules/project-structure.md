# VoxelCraft Project Structure Map

Quick reference for where everything important lives in the VoxelCraft codebase.

---

## 📦 Root Level

- `index.html` — Entry HTML, loads Vite modules
- `vite.config.ts` — Build config, COOP/COEP headers for SharedArrayBuffer
- `tsconfig.json` — TypeScript compiler settings
- `package.json` — Dependencies, scripts (`npm run dev`, `npm run build`, `npm test`)
- `tailwind.config.cjs` — CSS framework config
- `AGENTS.md` — **Agent guide**: invariants, pitfalls, verified facts (READ FIRST, UPDATE ALWAYS)
- `README.md` — Project overview

---

## 🗂️ Source (`/src`)

### Entry Points
- `src/index.tsx` — Mounts React app
- `src/App.tsx` — Main app component, Physics provider, scene setup
- `src/constants.ts` — Global constants (chunk sizes, ISO_LEVEL, PAD)
- `src/types.ts` — Shared TypeScript types

### Core (`/src/core`)
**Engine primitives, reusable utilities**

- `core/graphics/` — Shaders, materials, celestial helpers
  - `TriplanarShader.ts` — Terrain shader code (triplanar blending, caustics, height fog)
  - `TriplanarMaterial.tsx` — Terrain material component (singleton)
  - `WaterMaterial.tsx` — Animated water shader
  - `SharedUniforms.ts` — Global uniforms (time, sun direction, fog)
  - `celestial.ts` — Orbit calculations for Sun/Moon
  - `textureGenerator.ts` — Procedural noise textures

- `core/math/` — Math utilities
  - `noise.ts` — 3D Simplex noise

- `core/memory/` — Memory management
  - `sharedResources.ts` — Lazy-loaded shared assets (noise textures)

- `core/workers/` — Worker infrastructure
  - `WorkerPool.ts` — Multi-threaded task dispatcher

### Features (`/src/features`)
**Game systems, modular by domain**

#### Terrain (`features/terrain/`)
- `components/VoxelTerrain.tsx` — **Master orchestrator**: chunk streaming, LOD, worker messages, caching
- `components/ChunkMesh.tsx` — Individual chunk renderer (heightfield/trimesh colliders, layers)
- `logic/mesher.ts` — Surface Nets meshing algorithm
- `logic/TerrainService.ts` — Density generation, material assignment, cavern logic
- `materials/WaterMaterial.tsx` — Water rendering
- `workers/terrain.worker.ts` — Offloaded generation/meshing

#### Environment (`features/environment/`)
- `components/AtmosphereController.tsx` — Sky color, fog, time-of-day
- `components/SkyDome.tsx` — Procedural sky, stars, Milky Way
- `components/Sun.tsx` — Sun billboard shader
- `components/Moon.tsx` — Painterly moon shader
- `components/CinematicComposer.tsx` — Post-processing (bloom, vignette, exposure)
- `components/BubbleSystem.tsx` — Underwater bubbles (GPU)

#### Player (`features/player/`)
- `components/Player.tsx` — Character controller, input, underwater detection
- `components/TouchCameraControls.tsx` — Touch-mode camera
- `logic/usePlayerInput.ts` — Input abstraction (keyboard/touch)

#### Interaction (`features/interaction/`)
- `components/FirstPersonTools.tsx` — Held item rendering, animations, Lumina light
- `components/InteractionHandler.tsx` — Raycast logic, terrain digging, item pickup, fire creation
- `logic/HeldItemPoses.ts` — **NEVER EDIT**: Hand-tuned poses for held items
- `logic/ToolCapabilities.ts` — Derives powers from custom tool attachments
- `logic/LuminaExitFinder.ts` — Cave-exit finder for Lumina dash

#### Flora (`features/flora/`)
- `components/TreeLayer.tsx` — Tree instance rendering (with LOD)
- `components/VegetationLayer.tsx` — Grass/undergrowth instancing
- `components/GroundItemsLayer.tsx` — Sticks, stones, hotspots (bucketed rendering)
- `components/LuminaLayer.tsx` — Lumina plant lights (point lights with culling)
- `components/StumpLayer.tsx` — Tree stumps (instanced)
- `components/FloraPlacer.tsx` — Procedural vegetation placement
- `logic/TreeGeometryFactory.ts` — Procedural tree mesh generation (trunk, branches, canopy)
- `logic/VegetationConfig.ts` — Biome vegetation profiles
- `logic/SimulationManager.ts` — Flora worker manager
- `workers/simulation.worker.ts` — Offloaded vegetation placement

#### Crafting (`features/crafting/`)
- `components/CraftingInterface.tsx` — Drag-and-drop tool builder
- `components/UniversalTool.tsx` — **Single source of truth**: 3D meshes for all items
- `components/ItemThumbnail.tsx` — 3D inventory icons
- `logic/WoodworkingLogic.ts` — Crafting rules, tool assembly

#### Creatures (`features/creatures/`)
- `FogDeer.tsx` — Ambient creature entity

### State (`/src/state`)
**Global Zustand stores**

- `SettingsStore.ts` — Graphics quality, input mode
- `InventoryStore.ts` — Player inventory, custom tools
- `EnvironmentStore.ts` — Time of day, underwater state
- `WorldStateStore.ts` — Active world type, spawn position
- `InputStore.ts` — Mouse/keyboard input state
- `CraftingStore.ts` — Crafting UI state
- `EntityHistoryStore.ts` — Entity health/hits tracking
- `PhysicsItemStore.ts` — Dropped item physics state
- `ChunkCache.ts` — IndexedDB chunkcache (pristine meshes)

### UI (`/src/ui`)
**React components for HUD/menus**

- `HUD.tsx` — On-screen display (coordinates, inventory, fps)
- `SettingsMenu.tsx` — Graphics/input settings dialog
- `Minimap.tsx` — Biome map overlay
- `LoadingScreen.tsx` — Initial loading screen
- `WorldSelector.tsx` — Biome selection screen

### Tests (`/src/tests`)
**Vitest unit tests**

- `terrainService.test.ts` — Terrain generation tests
- `mesher.test.ts` — Surface Nets tests

---

## 🌍 Public Assets (`/public`)

- `public/models/` — GLB models (e.g., `tree_stump.glb`)
- `public/textures/` — Texture images
- `public/sounds/` — Audio files

---

## ⚙️ Config & Tooling

- `.agent/workflows/` — Agent workflow definitions (automation steps)
- `.vscode/` — VS Code settings
- `.git/` — Git repository
- `node_modules/` — Dependencies (DO NOT EDIT)
- `dist/` — Build output (generated, DO NOT EDIT)

---

## 🧭 Quick Lookup by Task

| Task | Primary Location |
|------|------------------|
| **Terrain meshing** | `src/features/terrain/logic/mesher.ts` |
| **Chunk streaming** | `src/features/terrain/components/VoxelTerrain.tsx` |
| **Voxel generation** | `src/features/terrain/logic/TerrainService.ts` |
| **Terrain shader** | `src/core/graphics/TriplanarShader.ts` |
| **Player movement** | `src/features/player/components/Player.tsx` |
| **Held item rendering** | `src/features/interaction/components/FirstPersonTools.tsx` |
| **Item pickup/digging** | `src/features/interaction/components/InteractionHandler.tsx` |
| **Tree generation** | `src/features/flora/logic/TreeGeometryFactory.ts` |
| **Crafting UI** | `src/features/crafting/components/CraftingInterface.tsx` |
| **Custom tool logic** | `src/features/crafting/logic/WoodworkingLogic.ts` |
| **Inventory** | `src/state/InventoryStore.ts` |
| **Graphics settings** | `src/state/SettingsStore.ts` |
| **Post-processing** | `src/features/environment/components/CinematicComposer.tsx` |
| **Global constants** | `src/constants.ts` |
| **Agent rules** | `AGENTS.md` |

---

## 📝 Critical Files (Always Check Before Changes)

1. **`AGENTS.md`** — Read first, update always
2. **`src/constants.ts`** — Global configuration values
3. **`src/features/terrain/components/VoxelTerrain.tsx`** — Terrain orchestration
4. **`src/features/interaction/logic/HeldItemPoses.ts`** — DO NOT TOUCH (see AGENTS.md)
5. **`src/core/graphics/SharedUniforms.ts`** — Shared render state

---

*Last updated: 2025-12-24*
