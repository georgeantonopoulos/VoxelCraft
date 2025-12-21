# Plan: Core Game Loop

This plan outlines the steps to establish the fundamental gameplay loop of VoxelCraft.

---

## Phase 1: Player Exploration [checkpoint: ade5bf6]

In this phase, we will focus on the player's ability to move through and explore the procedurally generated world.

- [x] Task: Implement basic player movement (WASD) and mouse-look camera controls. [pre-existing]
- [x] Task: Ensure the world generates new chunks as the player moves into new areas. [pre-existing]
- [x] Task: Conductor - User Manual Verification 'Phase 1: Player Exploration' (Protocol in workflow.md)

---

## Phase 2: Basic Interaction [checkpoint: 0a76cec]

This phase will implement the core interaction mechanics of digging and building.

- [x] Task: Implement the ability for the player to remove voxel blocks from the world (digging). [pre-existing]
- [x] Task: Implement the ability for the player to add voxel blocks to the world (building). [pre-existing]
- [x] Task: Add visual and audio feedback for digging and building actions. [pre-existing]
- [x] Task: Conductor - User Manual Verification 'Phase 2: Basic Interaction' (Protocol in workflow.md)

---

## Phase 3: Environmental Simulation [checkpoint: 4252ae8]

In this phase, we will integrate and enhance the environmental simulation features.

- [x] Task: Verify and ensure the existing wetness and moss growth system is functioning correctly.
- [x] Task: Implement a basic day/night cycle. [pre-existing]
- [x] Task: Conductor - User Manual Verification 'Phase 3: Environmental Simulation' (Protocol in workflow.md)

---

## Phase 4: Performance Optimization

This phase focuses exclusively on profiling and optimizing the game's performance.

- [x] Task: Reduce the polygons in the grove trees by 75% to improve performance.
- [x] Task: Implement comprehensive profiling tools (CPU, GPU, Memory, Draw Calls).
- [x] Task: Apply optimizations based on profiling data (Mesh Simplification, Texture Compression, Shader Optimization, Culling Techniques).
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Performance Optimization' (Protocol in workflow.md)

---

## Phase 5: Final Refinement

This phase will focus on gameplay bug fixes and control refinement.

- [ ] Task: Fix Bug: Hitting a thrown rock with another rock does not deplete its life.
- [ ] Task: Refine the player controls and interaction feedback based on playtesting.
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Final Refinement' (Protocol in workflow.md)
