## Agent Notes for `VoxelCraft`

ALWAYS DEBUG YOUR OUTPUT. 
Run visual tests to confirm results. Becareful not to break dependent files
Update this md everytime with your findings. 

### 1. Project Overview
- **Tech Stack**: Vite + React + TypeScript + `three` / `@react-three/fiber`.
- **Physics**: `@react-three/rapier`.
- **Styling**: Tailwind CSS (via CDN in `index.html`).
- **Entry**: `index.tsx` -> `App.tsx`.

### 2. Core Architecture

#### File Structure
- `components/`: React components (Terrain, Player, UI).
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
  - **Seam Fix**: Boundary snapping is enabled. X-faces generate `start` to `end-1`. Y/Z-faces generate `start+1` to `end` to share vertices.
- **Materials**: `TriplanarMaterial` uses custom shaders to blend textures based on world position and normal direction.

#### Simulation System
- **Metadata**: `MetadataDB` stores `wetness` and `mossiness` layers globally.
- **Loop**: `SimulationManager` runs a `simulation.worker` that updates metadata (e.g., water makes nearby stone wet -> wet stone grows moss).
- **Updates**: Worker sends `CHUNKS_UPDATED` -> `SimulationManager` -> `VoxelTerrain` (triggers visual update/remesh).

#### Interaction & Physics
- **Physics**: Chunks are `fixed` rigid bodies with `trimesh` colliders. Player is a `dynamic` capsule.
- **Controls**: `PointerLockControls` for view. `KeyboardControls` for input.
- **Dig/Build**:
  - Raycast via Rapier (`world.castRay`) filters for `userData.type === 'terrain'`.
  - `TerrainService.modifyChunk` applies a radial density falloff to smooth/carve terrain.

### 4. Developer Guidelines
- **Do Not Break**:
  - **Chunk Padding**: `TOTAL_SIZE = CHUNK_SIZE + PAD * 2`. Critical for meshing neighbors.
  - **UserData**: Keep `userData: { type: 'terrain' }` on chunk RigidBodies for interaction raycasting.
  - **Worker Messages**: Follow the `type` / `payload` pattern in workers.
- **Performance**:
  - Use `ref` for high-frequency updates (Player movement, Particles).
  - Avoid blocking the main thread; offload heavy math to workers.
- **Conventions**:
  - Add JSDoc to new functions.
  - Use `constants.ts` for magic numbers (Gravity, Speed, Chunk Size).

### 5. Environment
- **Env Vars**: `vite.config.ts` maps `.env.local` vars (like `GEMINI_API_KEY`) to `process.env`.
- **Dev Server**: `npm run dev` on port 3000.
