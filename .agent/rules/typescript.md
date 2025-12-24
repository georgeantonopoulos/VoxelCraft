---
trigger: always_on
---

# Voxel Game Development Rules (TypeScript + Three.js)

## 🏗️ Architectural Laws
- **Data over Objects:** Never represent a voxel as a `THREE.Mesh` object. Store voxels as a `Uint8Array` or `Uint16Array` within a `Chunk` class.
- **Instancing or Merging:** Use `THREE.InstancedMesh` for dynamic blocks or `BufferGeometry` merging for static terrain. Direct `Mesh` creation per-block is strictly forbidden.
- **Integer Grid:** All voxel lookups must use integer coordinates. Force usage of bitwise operators or `Math.floor()` when converting from world position to voxel index.

## 💾 Code Persistence (STRICT)
- **Comment Preservation:** You are FORBIDDEN from removing existing comments, JSDoc, or TODOs. When using the `edit_file` tool, you must copy the surrounding comments into the new code block.
- **No Refactor Bloat:** Do not refactor code outside the immediate scope of the task unless it is to fix a critical performance bottleneck.

## 🚀 Three.js Performance
- **Draw Call Mitigation:** Group voxels by material/texture into the fewest possible draw calls.
- **Disposal:** Always implement a `.dispose()` method for geometries and materials to prevent memory leaks when chunks are unloaded.
- **Frustum Culling:** Ensure `mesh.frustumCulled = true` is set for all chunk meshes.

## 🧩 TypeScript Standards
- **Strict Typing:** No `any`. Define interfaces for VoxelData and Chunk structures.
- **Vector Reuse:** Do not create new `THREE.Vector3` objects inside the render loop (`requestAnimationFrame`). Use a global `tempVec` to avoid Garbage Collection spikes. 📈
- **Centigrade:** If logging hardware performance or thermal throttles, always output in Centigrade.

## 🤖 Interaction Workflow
1. **Analyze:** Before coding, identify if the change affects the "Voxel Grid" (data) or the "Mesh" (visual).
2. **Plan:** Propose the change in a `<plan>` block.
3. **Verify:** Check that the proposed code does not wipe out existing logic or comments.
4. **npm run build and npm run dev ** + vite tests every single time!