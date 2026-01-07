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

## 2. Phase 1: SAW Tool Functionality

### 2.1. Enable SAW to Cut Trees
**File**: [useTerrainInteraction.ts](src/features/terrain/hooks/useTerrainInteraction.ts)

**Problem**: Line 216 guards tree damage with `if (!capabilities.canChop)`, but SAW has `canSaw` instead.

**Solution**: Update the capability check to allow both chopping and sawing tools:
```typescript
// Line 216: Change from:
if (!capabilities.canChop) {
// To:
if (!capabilities.canChop && !capabilities.canSaw) {
```

This allows SAW to damage standing trees (with its higher woodDamage of 8.0).

### 2.2. Add SAW Held Item Pose
**File**: [HeldItemPoses.ts](src/features/interaction/logic/HeldItemPoses.ts)

Add a pose for the SAW tool. Since it's similar to a stick-based tool, derive from `STICK` pose:
```typescript
[ItemType.SAW]: {
  x: PICKAXE_POSE.x,
  xOffset: 0.27,
  y: -0.457,
  z: -0.789,
  scale: 1.234,
  rot: {
    x: THREE.MathUtils.degToRad(-18.0),
    y: THREE.MathUtils.degToRad(89.0),
    z: THREE.MathUtils.degToRad(162.0)
  }
}
```

### 2.3. Add SAW to FirstPersonTools Rendering
**File**: [FirstPersonTools.tsx](src/features/interaction/components/FirstPersonTools.tsx)

Ensure the SAW tool type is handled in the tool rendering switch/conditional. It should render as a stick with 3 shards attached (like the crafting preview).

---

## 3. Phase 2: FallingTree to Log Conversion

### 3.1. Modify FallingTree Component
**File**: [FallingTree.tsx](src/features/flora/components/FallingTree.tsx)

**Current State**: FallingTree is a physics-enabled tree that spawns when a standing tree's health reaches 0. It uses `RigidBody` with `CylinderCollider`.

**Changes**:
1. Add interaction detection for SAW tool
2. When SAW hits a fallen tree, convert it to Log entities
3. Track "fallen" state (rotation or ground contact)

**Implementation**:
```typescript
// Add to FallingTreeProps
interface FallingTreeProps {
    position: THREE.Vector3;
    type: number;
    seed: number;
    onConvertToLogs?: (logs: LogData[]) => void;  // NEW
}

// Add userData for interaction detection
<RigidBody
    userData={{ type: 'fallen_tree', treeType: type, seed }}
    // ... existing props
>
```

### 3.2. Sawing Interaction on Fallen Trees
**File**: [useTerrainInteraction.ts](src/features/terrain/hooks/useTerrainInteraction.ts)

Add a new case for SAW interacting with fallen trees:
```typescript
// In the physics hit detection section (around line 168)
if (userData.type === 'fallen_tree') {
    const capabilities = getToolCapabilities(currentTool);
    if (!capabilities.canSaw) {
        audioPool.play(clunkUrl, 0.3, 1.5);
        return;
    }

    // Spawn 2-3 logs at the fallen tree's position
    const logCount = 2 + Math.floor(Math.random());
    for (let i = 0; i < logCount; i++) {
        // Call callback to spawn Log entity
        callbacks.onLogSpawn({
            position: fallingTreePosition.clone().add(new THREE.Vector3(i * 0.5, 0, 0)),
            treeType: userData.treeType,
            seed: userData.seed + i
        });
    }

    // Remove the FallingTree entity
    callbacks.onFallingTreeRemove(userData.id);
}
```

---

## 4. Phase 3: Log Entity

### 4.1. Create Log Component
**New File**: `src/features/building/components/Log.tsx`

```typescript
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';

export interface LogProps {
    id: string;
    position: THREE.Vector3;
    treeType: number;
    seed: number;
    isPlaced?: boolean;  // Kinematic when placed
    onPickup?: (id: string) => void;
}

export const Log: React.FC<LogProps> = ({
    id,
    position,
    treeType,
    seed,
    isPlaced = false,
    onPickup
}) => {
    // Log dimensions (shorter than tree trunk)
    const LOG_LENGTH = 2.0;
    const LOG_RADIUS = 0.25;

    // Wood material (simplified from FallingTree wood shader)
    const woodMaterial = useMemo(() => {
        return new CustomShaderMaterial({
            baseMaterial: THREE.MeshStandardMaterial,
            vertexShader: `
                varying vec3 vPos;
                void main() {
                    vPos = position;
                    csm_Position = position;
                }
            `,
            fragmentShader: `
                precision highp sampler3D;
                varying vec3 vPos;
                uniform vec3 uColorBase;
                uniform sampler3D uNoiseTexture;

                void main() {
                    float nBark = texture(uNoiseTexture, vPos * 0.8).r;
                    vec3 col = uColorBase * mix(0.85, 1.1, nBark);
                    csm_DiffuseColor = vec4(col, 1.0);
                }
            `,
            uniforms: {
                uColorBase: { value: new THREE.Color('#5D4037') },
                uNoiseTexture: { value: getNoiseTexture() },
            },
            roughness: 0.85,
        });
    }, []);

    // Cut ring texture for log ends (visible grain pattern)
    const endMaterial = useMemo(() => {
        return new THREE.MeshStandardMaterial({
            color: '#8D6E63',
            roughness: 0.9,
        });
    }, []);

    return (
        <RigidBody
            position={position}
            type={isPlaced ? 'kinematicPosition' : 'dynamic'}
            mass={50}
            friction={2.0}
            linearDamping={4.0}
            angularDamping={6.0}
            userData={{ type: 'log', id, treeType }}
        >
            <CylinderCollider
                args={[LOG_LENGTH / 2, LOG_RADIUS]}
                rotation={[0, 0, Math.PI / 2]}  // Horizontal orientation
            />

            {/* Main log cylinder */}
            <mesh material={woodMaterial} castShadow receiveShadow>
                <cylinderGeometry args={[LOG_RADIUS, LOG_RADIUS, LOG_LENGTH, 12]} />
            </mesh>

            {/* End caps with visible rings */}
            <mesh
                position={[LOG_LENGTH / 2, 0, 0]}
                rotation={[0, 0, Math.PI / 2]}
                material={endMaterial}
            >
                <circleGeometry args={[LOG_RADIUS, 12]} />
            </mesh>
            <mesh
                position={[-LOG_LENGTH / 2, 0, 0]}
                rotation={[0, 0, -Math.PI / 2]}
                material={endMaterial}
            >
                <circleGeometry args={[LOG_RADIUS, 12]} />
            </mesh>
        </RigidBody>
    );
};
```

### 4.2. Log State Management
**File**: [WorldStore.ts](src/state/WorldStore.ts) or new `LogStore.ts`

Add state for tracking logs in the world:
```typescript
interface LogState {
    id: string;
    position: [number, number, number];
    rotation: [number, number, number];
    treeType: number;
    isPlaced: boolean;
}

// In WorldStore or new LogStore
logs: Map<string, LogState>;
addLog: (log: LogState) => void;
removeLog: (id: string) => void;
updateLog: (id: string, updates: Partial<LogState>) => void;
```

---

## 5. Phase 4: Log Carrying System

### 5.1. Player State Extension
**File**: [Player.tsx](src/features/player/Player.tsx)

Add carrying state and speed modifier:
```typescript
// Constants
const CARRYING_SPEED_MULTIPLIER = 0.33;  // 33% speed when carrying

// State
const [isCarrying, setIsCarrying] = useState<string | null>(null);  // Log ID

// In movement calculation (around line 200-201)
const carryMul = isCarrying ? CARRYING_SPEED_MULTIPLIER : 1.0;
const baseSpeed = isFlying ? FLY_SPEED : (inWater ? SWIM_SPEED : PLAYER_SPEED * crouchMul * carryMul);
```

### 5.2. Carrying Input Handling
**File**: [usePlayerInput.ts](src/features/player/usePlayerInput.ts) or [InteractionHandler.tsx](src/features/interaction/logic/InteractionHandler.tsx)

Add Q key to pick up/drop logs:
```typescript
// In InteractionHandler or new hook
useEffect(() => {
    const handlePickup = (e: KeyboardEvent) => {
        if (e.code !== 'KeyQ') return;

        if (isCarrying) {
            // Drop the log
            dropLog(isCarrying, playerPosition);
            setIsCarrying(null);
        } else {
            // Raycast for nearby log
            const logHit = raycastForLog();
            if (logHit) {
                setIsCarrying(logHit.id);
                removeLogFromWorld(logHit.id);
            }
        }
    };

    window.addEventListener('keydown', handlePickup);
    return () => window.removeEventListener('keydown', handlePickup);
}, [isCarrying]);
```

### 5.3. Carried Log Visual
**File**: [FirstPersonTools.tsx](src/features/interaction/components/FirstPersonTools.tsx)

When carrying a log, render the log end in first-person view:
```typescript
// Add carried log visual when isCarrying is set
{isCarrying && (
    <group position={[0.5, -0.6, -0.8]}>
        {/* Log end (circular) with slight sway animation */}
        <mesh>
            <cylinderGeometry args={[0.15, 0.15, 0.3, 12]} />
            <meshStandardMaterial color="#5D4037" />
        </mesh>
    </group>
)}
```

---

## 6. Phase 5: Building System (Hut Construction)

### 6.1. Create Building Placement Hook
**New File**: `src/features/building/hooks/useBuildingPlacement.ts`

```typescript
import { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';

interface SnapPosition {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    type: 'wall' | 'roof';
}

export function useBuildingPlacement(isCarrying: boolean) {
    const { camera } = useThree();
    const { world, rapier } = useRapier();

    const [ghostPosition, setGhostPosition] = useState<SnapPosition | null>(null);
    const [canPlace, setCanPlace] = useState(false);

    useEffect(() => {
        if (!isCarrying) {
            setGhostPosition(null);
            return;
        }

        // Raycast forward from camera
        const origin = camera.position.clone();
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const ray = new rapier.Ray(origin, direction);

        // Check for existing placed logs
        const hit = world.castRay(ray, 8.0, true, undefined, undefined, undefined, undefined,
            (collider) => collider.parent()?.userData?.type === 'log'
        );

        if (hit) {
            // Calculate snap position adjacent to hit log
            const hitPoint = ray.pointAt(hit.timeOfImpact);
            const snapPos = calculateSnapPosition(hitPoint, hit.collider);
            setGhostPosition(snapPos);
            setCanPlace(true);
        } else {
            // Ground placement
            const groundHit = world.castRay(ray, 8.0, true);
            if (groundHit) {
                setGhostPosition({
                    position: new THREE.Vector3().copy(ray.pointAt(groundHit.timeOfImpact)),
                    rotation: new THREE.Euler(0, 0, 0),
                    type: 'wall'
                });
                setCanPlace(true);
            }
        }
    }, [isCarrying, camera.position]);

    return { ghostPosition, canPlace };
}
```

### 6.2. Ghost Preview Component
**New File**: `src/features/building/components/GhostLog.tsx`

```typescript
import React from 'react';
import * as THREE from 'three';

interface GhostLogProps {
    position: THREE.Vector3;
    rotation: THREE.Euler;
    canPlace: boolean;
}

export const GhostLog: React.FC<GhostLogProps> = ({ position, rotation, canPlace }) => {
    return (
        <group position={position} rotation={rotation}>
            <mesh>
                <cylinderGeometry args={[0.25, 0.25, 2.0, 8]} />
                <meshBasicMaterial
                    color={canPlace ? '#00ff00' : '#ff0000'}
                    transparent
                    opacity={0.5}
                    wireframe
                />
            </mesh>
            {/* Bounding box outline */}
            <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(0.5, 2.0, 0.5)]} />
                <lineBasicMaterial color={canPlace ? '#00ff00' : '#ff0000'} />
            </lineSegments>
        </group>
    );
};
```

### 6.3. Snap Logic Constants
```typescript
// Building constants
const LOG_DIAMETER = 0.5;
const LOG_LENGTH = 2.0;
const SNAP_THRESHOLD = 0.3;  // Distance to trigger snap

// Wall snap: Adjacent logs side-by-side
// Roof snap: Perpendicular on top, requires 2+ wall logs with gap
```

---

## 7. File Summary

### Files to Modify
| File | Changes |
|------|---------|
| [useTerrainInteraction.ts](src/features/terrain/hooks/useTerrainInteraction.ts) | Add `canSaw` check for tree damage; Add fallen tree sawing logic |
| [HeldItemPoses.ts](src/features/interaction/logic/HeldItemPoses.ts) | Add SAW pose |
| [FirstPersonTools.tsx](src/features/interaction/components/FirstPersonTools.tsx) | Add SAW rendering; Add carried log visual |
| [FallingTree.tsx](src/features/flora/components/FallingTree.tsx) | Add userData for sawing; Add conversion callback |
| [Player.tsx](src/features/player/Player.tsx) | Add carrying state and speed modifier |
| [WorldStore.ts](src/state/WorldStore.ts) | Add log state management |
| [InteractionHandler.tsx](src/features/interaction/logic/InteractionHandler.tsx) | Add Q key log pickup |

### New Files to Create
| File | Purpose |
|------|---------|
| `src/features/building/components/Log.tsx` | Log entity with physics |
| `src/features/building/components/GhostLog.tsx` | Building preview ghost |
| `src/features/building/hooks/useBuildingPlacement.ts` | Snap placement logic |

---

## 8. Implementation Order

### Phase 1: SAW Basic Functionality (30 min)
1. Update `useTerrainInteraction.ts` line 216 to accept `canSaw`
2. Add SAW pose to `HeldItemPoses.ts`
3. Test: Craft SAW, equip, chop trees

### Phase 2: Fallen Tree Sawing (45 min)
1. Add `userData` to `FallingTree.tsx`
2. Add sawing interaction in `useTerrainInteraction.ts`
3. Test: Fell tree with AXE, saw with SAW to get logs

### Phase 3: Log Entity (45 min)
1. Create `Log.tsx` component
2. Add log state to `WorldStore.ts`
3. Integrate log spawning from fallen trees
4. Test: Logs spawn and have physics

### Phase 4: Carrying System (45 min)
1. Add carrying state to `Player.tsx`
2. Add Q key handler in `InteractionHandler.tsx`
3. Add carried log visual to `FirstPersonTools.tsx`
4. Test: Pick up log, move slower, drop log

### Phase 5: Building System (60 min)
1. Create `useBuildingPlacement.ts` hook
2. Create `GhostLog.tsx` component
3. Add placement input (Right Click while carrying)
4. Test: Build walls, snap logs together

---

## 9. Verification Checklist

- [ ] SAW can be crafted (3 shards on left side)
- [ ] SAW shows correct held pose in first-person
- [ ] SAW can damage standing trees (woodDamage: 8.0)
- [ ] SAW can cut fallen trees into logs
- [ ] Logs spawn with physics (roll, collide)
- [ ] Q key picks up nearby log
- [ ] Movement speed reduced to 33% while carrying
- [ ] Carried log visible in first-person
- [ ] Right Click places log (vertical by default)
- [ ] Ghost preview shows green when valid placement
- [ ] Logs snap adjacent to existing placed logs
- [ ] Build passes: `npm run build && npm run test:unit`
- [ ] Smoke test: Full flow from crafting to building

---

## 10. Technical Notes

### Interaction Priority
The raycast system needs priority ordering:
1. UI elements (inventory, crafting)
2. Physics items (logs, stones, fallen trees)
3. Standing trees (flora colliders)
4. Terrain (digging, building)

### Performance Considerations
- Log entities use simplified cylinder geometry (12 segments)
- Ghost preview uses wireframe to minimize draw calls
- Placed logs become kinematic (no physics simulation cost)
- Consider log entity pooling if many logs spawn

### Audio Suggestions
- Sawing sound: New asset (rhythmic wood cutting)
- Log pickup: Existing `clunk.wav` with lower pitch
- Log placement: Solid "thunk" sound
- Snap feedback: Subtle confirmation sound
