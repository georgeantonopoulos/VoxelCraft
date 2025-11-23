## Agent Notes for `VoxelCraft`

- **Project type**: Vite + React + TypeScript + `three` / `@react-three/*` voxel terrain demo.
- **Entry point**: React entry is `index.tsx` in the project root, which mounts `App` into the `#root` div in `index.html`.
- **Dev server**: Use `npm install` once, then `npm run dev` from the project root. Vite serves on port `3000` (see `vite.config.ts`).
- **HTML entry**: `index.html` must include a `<script type="module" src="/index.tsx"></script>` tag so Vite can load the React app. If the page is pure black with no UI, check that this tag is present.
- **Styling**: Tailwind is loaded via CDN in `index.html` (not via a local config). Utility classes in React components rely on that `<script src="https://cdn.tailwindcss.com"></script>` in the HTML.
- **Pointer lock / controls**: The app uses `PointerLockControls` and keyboard controls; clicking into the canvas captures the pointer, and `InteractionLayer` handles mouse events for dig/build actions.
- **Environment variables**: `vite.config.ts` maps `GEMINI_API_KEY` from `.env.local` into `process.env.*` for use by the app.
- **User preferences**: 
  - Keep edits focused on the user’s immediate request; suggest larger refactors before doing them.
  - Add docstrings / JSDoc-style comments to new functions or components you introduce.
  - Do not edit build artifacts in `dist/`; change source files instead.
- **2025-03-xx seam fix**: Boundary snapping is enabled in `utils/mesher.ts` so adjacent chunks share exact edge vertices. We use a single-loop approach with carefully gated face generation: X-faces run `start` to `end-1` (skipping boundary wall), while Y/Z-faces run `start+1` to `end` (connecting to the boundary vertex).
- **Rendering**:
  - Uses `CustomShaderMaterial` (CSM) with `Three.js`.
  - `vMaterial` must be `flat varying` in shaders to avoid interpolation artifacts (rainbow gradients) when using float IDs.
  - Materials should be opaque (`transparent={false}`) to support `N8AO` and proper depth writing.

- **Rendering Stability**:
  - **Post-Processing**: Always use `halfRes` and `distanceFalloff` for `N8AO` to prevent artifacts on high-DPI screens and at the sky horizon.
  - **Shader Safety**: Explicitly `clamp` final colors (e.g., 0.0 to 10.0) and guard against NaNs in fragment shaders before outputting. Unclamped values cause Bloom/ToneMapping to crash the frame into black.
  - **Shadows**: Ensure `shadow-camera` frustum covers the entire `far` clip plane. Use `useMemo` for light targets to prevent frame-by-frame recreation/jitter.
