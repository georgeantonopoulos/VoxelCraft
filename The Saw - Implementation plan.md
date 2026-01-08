# The Saw - Implementation Plan

## 1. Overview
This feature introduces "The Saw", a new advanced tool for wood processing and construction. The implementation adds a comprehensive log-manipulation system for building structures, with logs spawning from fallen trees and a carrying/building mechanic.

### Current State (Already Implemented)
- `ItemType.SAW` exists in `src/types.ts`
- SAW recipe defined in `CraftingData.ts`: `blade_1 + blade_2 + blade_3` (3 shards on left side)
- `STICK_SLOTS` already configured with 4 slots: `blade_1`, `blade_2`, `blade_3`, `side_right`
- `ItemType.LOG` exists in `types.ts` with placeholder registration in `ItemRegistry.ts`
- `canSaw` capability exists in `ToolCapabilities.ts` but is not used in interactions
- SAW has `woodDamage: 8.0` (higher than AXE's `5.0`)

---

## 2. Implementation Progress

### ✅ Phase 1: SAW Tool Functionality - COMPLETE
- SAW can be crafted and renders correctly in first-person
- SAW pose added to `HeldItemPoses.ts`
- SAW **cannot** chop standing trees (intentional - only AXE can fell trees)
- SAW is specifically for cutting fallen trees into logs

### ✅ Phase 2: FallingTree to Log Conversion - COMPLETE
- FallingTree component has `userData` for interaction detection
- **Dual registry system** implemented for reliable physics raycasting:
  - `fallingTreeRegistry` (RigidBody handles)
  - `fallingTreeColliderRegistry` (Collider handles) - **Key fix: raycasts return collider handles, not rigidbody handles**
- SAW sawing damage system: 3-4 hits required to convert fallen tree to logs
- Particle effects (wood sawdust) during sawing
- Audio: Uses `playSound('wood_hit', ...)` via new AudioManager event system

### ✅ Phase 3: Log Entity - COMPLETE
- `Log.tsx` component created in `src/features/building/components/`
- Log physics with `RigidBody` and `CylinderCollider`
- Wood material with bark texture
- End caps showing cut grain
- Logs tracked in VoxelTerrain state

### ✅ Phase 4: Log Carrying System - COMPLETE
- `CarryingStore` manages carried log state
- Q key picks up / drops logs (via `InteractionHandler.tsx`)
- Movement speed reduced to 33% while carrying (`CARRYING_SPEED_MULTIPLIER`)
- Carried log visual in `FirstPersonTools.tsx` (cylinder mesh in first-person view)
- `vc-log-pickup` / `vc-log-drop` events for VoxelTerrain state sync

### ✅ Phase 5: Building System - COMPLETE
- **Vertical-First Placement** - Logs placed as fence posts by default
  - Ground Post: Vertical log planted in terrain (cornerstone)
  - Stacked Post: Vertical log on top of existing vertical log (walls upward)
  - Adjacent Post: Vertical log beside existing log (walls outward)
  - Roof Beam: Horizontal ONLY when two vertical supports at correct spacing
- **GhostLog.tsx** - Semi-transparent wireframe preview for placement
  - Green when valid placement, red when invalid
  - Dual rendering (solid + wireframe) for visibility
  - Orientation matches vertical/horizontal placement mode
- **useBuildingPlacement.ts** hook - Manages placement state and validation
  - Raycasts against terrain to find hit point
  - Grid snapping (0.25 unit increments) for clean alignment
  - **Placement priority**: Stack → Adjacent → Ground
  - Support detection for horizontal beams (two vertical posts ~2.5 units apart)
  - `preferHorizontal` state toggled by mouse wheel
  - Sphere intersection test for collision validation
- **Mouse wheel rotation** - Toggles between vertical/horizontal when both valid
  - Only available when two vertical supports detected
  - Wheel prevented from changing inventory while carrying
- **Right-click placement** - Places kinematic log at preview position
  - `vc-log-place-request` event from InteractionHandler
  - VoxelTerrain handles placement and state updates
  - `isVertical` flag tracked per placed log
  - Audio feedback on placement
- **Log.tsx** - Supports `isVertical` prop for correct rotation
  - Vertical: `rotation=[0, yRot, 0]` (Y-axis aligned)
  - Horizontal: `rotation=[0, yRot, PI/2]` (laying flat)
- **Debug mode tools** - Pre-crafted AXE and SAW in inventory for testing
  - `?debug` URL param adds both tools to inventory automatically
  - Defined in `InventoryStore.ts` via `getDebugModeTools()`

---

## 3. Bug Fixes Applied

### BUG 1: SAW was chopping standing trees
**Root cause**: `useTerrainInteraction.ts` checked `capabilities.canChop || capabilities.canSaw` for tree damage.
**Fix**: Changed to only allow `canChop` tools (AXE) to damage standing trees. SAW is for fallen trees only.

### BUG 2: SAW did nothing to fallen trees (raycasts not detecting)
**Root cause (complex)**:
1. Initially thought: Registry was using RigidBody handle but raycast returns Collider handle
2. Real root cause: **Player's RigidBody had no `userData`**, so player capsule passed raycast filter (`undefined !== 'terrain'`) and blocked all raycasts to fallen trees

**Fix**:
1. Added `userData={{ type: 'player' }}` to `Player.tsx` RigidBody
2. Updated raycast filter to exclude both `'terrain'` AND `'player'` types
3. Added dual registry (`fallingTreeColliderRegistry`) keyed by collider handle

### BUG 3: Log pickup sphere animation + disappearing logs
**Root cause**: `isPhysicsItemCollider` in `raycastUtils.ts` returned `true` for LOG type, so pressing E on a log triggered the generic physics item pickup flow (sphere animation, add to inventory) instead of the CarryingStore flow.
**Fix**: Added explicit exclusion `itemType !== ItemType.LOG` in `isPhysicsItemCollider`

### BUG 4: `audioPool is not defined` runtime error after merge
**Root cause**: Merged main branch which removed `audioPool` in favor of AudioManager events, but kept the reference in VoxelTerrain/useTerrainInteraction interface.
**Fix**: Removed `audioPool` from `InteractionCallbacks` interface and VoxelTerrain call site. Sawing sounds now use `playSound('wood_hit', ...)`.

---

## 4. Key Technical Lessons

### Physics Raycast Pitfalls (Documented in AGENTS.md)
1. **All RigidBodies need explicit `userData.type`** - Without it, filter functions like `userData?.type !== 'terrain'` return `true` for `undefined`, letting unintended colliders pass through.

2. **Rapier raycasts return Collider handles, not RigidBody handles** - If you need to look up entity data by handle, use a registry keyed by `collider.handle`, not `rigidBody.handle`.

3. **Player capsule intercepts raycasts** - The player is always between the camera and the world. Must explicitly filter out player collider in raycast filters.

### Audio System Migration
- Old system: `audioPool.play(url, volume, pitch)`
- New system: `playSound(soundId, { volume, pitch })` dispatches `vc-audio-play` events
- Sound IDs registered in `src/core/audio/soundRegistry.ts`

### Building Placement System
- **Grid snapping**: `Math.round(value / GRID_SNAP) * GRID_SNAP` for clean alignment
- **Validation**: Sphere intersection test with Rapier to detect collisions
- **State flow**: `vc-log-place-request` event → `placeLog()` → `setLogs()` → `isPlaced: true`

---

## 5. Files Modified/Created

### New Files (Phase 5)
| File | Purpose |
|------|---------|
| `src/features/building/components/GhostLog.tsx` | Semi-transparent placement preview |
| `src/features/building/hooks/useBuildingPlacement.ts` | Placement state, validation, snapping |
| `src/tests/building.test.ts` | Unit tests for CarryingStore and placement logic |

### Modified Files
| File | Changes |
|------|---------|
| `FallingTree.tsx` | Dual registry (RigidBody + Collider), removed debug logs |
| `useTerrainInteraction.ts` | Raycast filter excludes player, registry lookup by collider handle, damage system, migrated to AudioManager |
| `Player.tsx` | Added `userData={{ type: 'player' }}` |
| `InteractionHandler.tsx` | Q key log pickup uses CarryingStore, Right-click dispatches `vc-log-place-request` |
| `raycastUtils.ts` | `isPhysicsItemCollider` excludes LOG type |
| `VoxelTerrain.tsx` | Building placement hook integration, GhostLog rendering, place request handler |
| `InventoryStore.ts` | Debug mode pre-crafted AXE and SAW tools |
| `AGENTS.md` | Added pitfalls for physics raycasting |

---

## 6. Future Enhancements

### Not Yet Implemented
1. **Sawing animation** - Tool animation during sawing action
2. **Sawing sound** - Dedicated rhythmic saw sound (currently uses `wood_hit`)
3. **Log variants** - Different wood colors based on tree type
4. **Log persistence** - Save/load placed logs in IndexedDB
5. **Advanced snapping** - Perpendicular roof placement on wall tops

---

## 7. Verification Checklist

- [x] SAW can be crafted (3 shards on left side)
- [x] SAW shows correct held pose in first-person
- [x] SAW **cannot** damage standing trees (AXE only)
- [x] SAW can cut fallen trees into logs (3-4 hits)
- [x] Logs spawn with physics (roll, collide)
- [x] Q key picks up nearby log
- [x] Movement speed reduced to 33% while carrying
- [x] Carried log visible in first-person
- [x] Right-click places log (**vertical** by default - fence post style)
- [x] Ghost preview shows green when valid, red when invalid
- [x] Logs snap to grid (0.25 unit increments)
- [x] Vertical stacking for walls (place on top of existing vertical log)
- [x] Adjacent log snapping for wall building
- [x] Horizontal placement only when two vertical supports exist
- [x] Mouse wheel toggles vertical/horizontal when both valid
- [x] Debug mode (`?debug`) includes pre-crafted AXE and SAW
- [x] Build passes: `npm run build`
- [x] Tests pass: `npm run test:unit` (91 tests, including 16 building tests)

---

## 8. Technical Notes

### Interaction Priority
The raycast system needs priority ordering:
1. UI elements (inventory, crafting)
2. Physics items (logs, stones, fallen trees)
3. Standing trees (flora colliders)
4. Terrain (digging, building)

### Performance Considerations
- Log entities use simplified cylinder geometry (12 segments)
- Ghost preview uses wireframe + transparent solid for clarity
- Placed logs become kinematic (no physics simulation cost)
- Consider log entity pooling if many logs spawn
- Grid snapping reduces placement calculation complexity

### Audio System
All sounds go through AudioManager via events:
```typescript
// Play a sound
playSound('wood_hit', { volume: 0.4, pitch: 0.7 });

// Internal: dispatches event
window.dispatchEvent(new CustomEvent('vc-audio-play', {
  detail: { soundId: 'wood_hit', options: { volume: 0.4, pitch: 0.7 } }
}));
```

Sound IDs must be registered in `src/core/audio/soundRegistry.ts`.

### Event Flow for Building
```
User right-clicks while carrying
    ↓
InteractionHandler: dispatch 'vc-log-place-request'
    ↓
VoxelTerrain: handleLogPlaceRequest()
    ↓
useBuildingPlacement: placeLog() returns { success, position, rotation, isVertical }
    ↓
VoxelTerrain: setLogs([...prev, { ...carriedLog, isPlaced: true, isVertical }])
    ↓
CarryingStore: drop() clears carried log
    ↓
AudioManager: plays 'wood_hit' placement sound
```

### Event Flow for Rotation Toggle
```
User scrolls mouse wheel while carrying
    ↓
InteractionHandler: e.preventDefault() + dispatch 'vc-building-rotation-toggle'
    ↓
useBuildingPlacement: setPreferHorizontal(prev => !prev)
    ↓
useFrame: recalculates placement (vertical vs horizontal based on preference + support availability)
    ↓
GhostLog: renders with updated rotation
```

---

## 9. Testing

### Unit Tests (`src/tests/building.test.ts`)
- CarryingStore: pickup, drop, state transitions
- Grid snapping: position calculations
- Vertical placement height calculations
- Vertical stacking position calculations
- Adjacent placement position calculations
- Horizontal support detection (gap tolerance)
- Horizontal beam placement at midpoint
- State shapes: dropped vs placed logs (isPlaced, isVertical)
- Log rotation values: vertical vs horizontal

### Smoke Tests (Manual - `npm run dev`)
1. Start with `?debug` to get pre-crafted tools
2. Find a tree, use AXE to fell it
3. Switch to SAW, cut fallen tree (3-4 hits)
4. Press Q to pick up a log
5. Walk around (should be slow)
6. Look at terrain, verify **vertical** ghost preview appears (upright fence post)
7. Right-click to place log (should turn kinematic, standing upright)
8. Pick up another log, look at top of placed log → should show stacking preview
9. Place stacked log (wall going up)
10. Pick up another log, look beside placed log → should show adjacent preview
11. Place two vertical logs ~2.5 units apart (LOG_LENGTH + LOG_DIAMETER)
12. Pick up another log, look between the two supports
13. Scroll mouse wheel → ghost should switch to horizontal (roof beam)
14. Right-click to place horizontal beam across the two supports
