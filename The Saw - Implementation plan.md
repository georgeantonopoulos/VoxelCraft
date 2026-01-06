# The Saw - Implementation Plan

## 1. Overview
This feature introduces "The Saw", a new advanced tool for wood processing and construction. The implementation changes the core crafting mechanic for stick-based tools and adds a comprehensive log-manipulation system for building structures.

## 2. Crafting System Overhaul
**Goal**: Redesign the stick attachment system to support multi-shard blades (Saw) and adjust existing recipes.

### 2.1. Slot Configuration
Modify `src/features/crafting/CraftingData.ts`:
- **Remove**: `tip_center` slot.
- **Add**: 3 slotted positions on the left side (`blade_1`, `blade_2`, `blade_3`).
- **Update**: `side_right` slot (remains for balance/counterweight).
- **Visuals**: Update coordinate positions `[x, y, z]` to match the user's provided reference image (3 overlapping spheres on left).

### 2.2. New Recipes
Update `RECIPES` in `src/features/crafting/CraftingData.ts`:
- **Pickaxe**: `blade_1` (Shard) + `side_right` (Shard).
- **Axe**: `blade_1` (Shard) + `blade_2` (Shard) + `side_right` (Stone).
- **Saw**: `blade_1` (Shard) + `blade_2` (Shard) + `blade_3` (Shard).

### 2.3. Visual Updates
- **UniversalTool.tsx**: The component iterates over `STICK_SLOTS`, so updating the data should automatically render the new configuration.
- **LashingMesh**: Ensure lashing geometry generates correctly for the new slot positions (helices might need radius/offset tuning).

## 3. The Saw Tool
**Goal**: A specialized tool with high sharpness but no impact damage (unlike Axe/Pickaxe).

### 3.1. Item Definition
- **ItemType**: Add `SAW` to `ItemType` enum in `types.ts`.
- **ItemGeometry**: Reuse `StickMesh` and `ShardMesh`. No new unique geometry needed, but the *combination* is unique.
- **Tool Capabilities**:
    - **Pickaxe**: Digging enabled.
    - **Axe**: Chopping enabled (standing trees).
    - **Saw**: Cutting enabled (fallen trees/logs).

## 4. Tree Cutting Mechanics (The Saw Ability)
**Goal**: Allow "real-time" cutting of fallen trees into Logs.

### 4.1. Interaction Logic
- Update `useTerrainInteraction.ts`:
    - Check if held item is Saw.
    - Raycast against `FallingTree` (RigidBody).
    - On Click/Hold: Perform "Cut".

### 4.2. Cutting Implementation
Since "real-time mesh slicing" (CSG) is expensive and complex, we use a **segmentation approach**:
1.  **Hit Detection**: Identify point on `FallingTree` cylinder.
2.  **Transformation**:
    - Destroy the `FallingTree` entity.
    - Spawn 2-3 `Log` entities in its place, matching the original tree's position/rotation.
    - Apply a small impulse to separate them.
    - **Constraint**: Only valid on *fallen* trees (check rotation or state).

## 5. The Log Entity & Mechanics
**Goal**: A physical, interactable object that serves as the primary building block.

### 5.1. Log Component (`Log.tsx`)
- **Physics**: `RigidBody` (Cylinder collider, mass ~50kg).
- **Visuals**:
    - Cylinder mesh with bark shader (`STICK_SHADER` variant or reused `Tree` shader).
    - Visible "cut rings" on caps (texture or shader).
- **State**: `movable` (physics enabled) vs `placed` (kinematic/static).

### 5.2. Carrying System
- **Input**: Press `Q` while looking at a Log.
- **State**: Enter `CARRYING_LOG` state in `PlayerController`.
- **Movement Penalty**:
    - Reduce `maxSpeed` to 33% (`moveSpeedMultiplier` = 0.33).
- **Visual Feedback**:
    - Hide main held tool.
    - Render "Log End" mesh attached to camera (bottom-right or center-bottom), swaying with movement.
    - Player arms (if visible) positioning.

## 6. Building System (Hut Construction)
**Goal**: Precision placement of logs to build walls and roofs.

### 6.1. Deployment (Right Click)
- **Animation**: Log interpolates from "held" position to "standing vertical" on the ground.
- **Physics**: Becomes `Kinematic` or `Fixed` once placed to ensure stability.

### 6.2. Snapping Logic (The "Green Bounding Box")
- **Ghost Preview**: When holding a log and looking at a *placed* log:
    - Show valid snap positions (Green Box outline).
    - **Wall Snap**: Adjacent to existing log (offset by log diameter).
    - **Roof Snap**: Perpendicular on top of wall logs (requires 4-wall check or height check).
    - **Alignment**: Auto-align rotation to match the neighbor.

### 6.3. Construction Rules
- **Walls**: Snapping places logs side-by-side vertically.
- **Roof**: Enabled after a certain condition (e.g., "4 sides" or just manual horizontal placement detection).
- **Doorway**: Allow skipping a snap position (gap) which serves as a door.

## 7. Execution Steps

1.  **Crafting Data**: Modify `STICK_SLOTS` and `RECIPES` in `CraftingData.ts`.
2.  **Type Definitions**: Add `ItemType.SAW` and `ItemType.LOG`.
3.  **Log Component**: Create `src/features/building/components/Log.tsx`.
4.  **Interaction Expansion**:
    - Add "Saw" case to `InteractionHandler`.
    - Add "Carry" logic to `usePlayerInput` / `PlayerController`.
5.  **Building Logic**: Implement `useBuildingPlacement` hook for ghost preview and snapping calculations.
6.  **Integration**: Wire up the Saw tool to spawn Logs from Trees.

## 8. Summary of Files to Modify/Create
- `src/features/crafting/CraftingData.ts` (Crafting Logic)
- `src/types.ts` (Item Enums)
- `src/features/interaction/components/UniversalTool.tsx` (Visuals)
- `src/features/building/components/Log.tsx` (New Entity)
- `src/features/interaction/hooks/useTerrainInteraction.ts` (Cutting Logic)
- `src/features/player/PlayerController.tsx` (Speed/Carrying)
