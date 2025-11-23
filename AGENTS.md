## Agent Notes for `VoxelCraft`

- **Project**: Vite + React + TypeScript + `three` / `@react-three/fiber`; physics via `@react-three/rapier`; Tailwind loaded from CDN in `index.html`.
- **Entry**: `index.tsx` mounts `App` into `#root` in `index.html`; Vite dev server is `npm run dev` on port `3000`.
- **Controls**: Pointer lock with `PointerLockControls`; `InteractionLayer` handles dig/build mouse actions; keyboard map is in `App.tsx`.
- **Env vars**: `vite.config.ts` maps `.env.local` (e.g., `GEMINI_API_KEY`) into `process.env`.
- **Rendering notes**: Uses `CustomShaderMaterial` with flat `vMaterial` to avoid interpolation artifacts; materials stay opaque (`transparent={false}`) for `N8AO`; post-processing prefers `halfRes` + `distanceFalloff` on `N8AO`; clamp shader outputs (0–10) to avoid NaNs; set wide shadow frustums and memoize light targets; Tailwind utilities rely on the CDN script.

### Terrain & Meshing
- Surface-nets mesher with boundary snapping so adjacent chunks share edge vertices. X faces run `start`→`end-1`; Y/Z faces run `start+1`→`end` to stitch to boundaries.
- Chunk padding: `TOTAL_SIZE = CHUNK_SIZE + PAD * 2` (XZ) and `TOTAL_SIZE_Y = CHUNK_SIZE_Y + PAD * 2`; keep `userData: { type: 'terrain' }` on rigid bodies for raycast filtering.

### Systems Overview
- **TerrainService**: Generates density/material plus metadata layers (`wetness`, `mossiness`); `modifyChunk` applies radial falloff.
- **Mesher**: Produces terrain + water meshes with normals/material/wetness/mossiness attributes.
- **SimulationManager**: Runs `simulation.worker` to update metadata (e.g., wetness propagation, moss growth) and notifies `VoxelTerrain` to remesh.
- **VoxelTerrain**: Manages chunk lifecycle via `terrain.worker`, handles dig/build, and feeds geometry to `TriplanarMaterial` / `WaterMaterial`.
- **MetadataDB**: Stores per-chunk metadata layers globally for simulation.

### Visual QA
- When visually inspecting, wait a few seconds and capture multiple angles to verify lighting/post effects and avoid regressions; update this doc with findings if you perform a QA pass.
