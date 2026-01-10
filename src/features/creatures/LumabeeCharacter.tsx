import React, { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TerrainService } from '@features/terrain/logic/terrainService';

// Import model as URL (Vite will handle bundling)
import lumabeeUrl from '@/assets/models/lumabee.glb?url';

/*
 * ===========================================================================
 * LUMABEE CHARACTER - CONNECTION MAP & ASSUMPTIONS
 * ===========================================================================
 *
 * CONNECTIONS TO OTHER FILES:
 * ----------------------------
 * 1. BeeManager.tsx (src/features/creatures/BeeManager.tsx)
 *    - Parent component that spawns LumabeeCharacter instances
 *    - Provides: id, position, treePosition, treeHeight, seed, onHarvest
 *    - Listens: onStateChange callback (optional)
 *    - Manages: LOD spawning/despawning based on player distance
 *
 * 2. NectarVFX.tsx (src/features/creatures/NectarVFX.tsx)
 *    - Currently NOT integrated - onHarvest callback exists but VFX not wired
 *    - TODO: BeeManager should spawn NectarVFX when onHarvest is called
 *
 * 3. WorldStore.ts (src/state/WorldStore.ts)
 *    - BeeManager uses getGrownTrees() to find GROWN_TREE entities
 *    - Trees are registered when FractalTree finishes growing
 *
 * 4. TerrainService.ts (src/features/terrain/logic/terrainService.ts)
 *    - getHeightAt(x, z) returns terrain height at world position
 *    - Used for height clamping to keep bees above ground
 *
 * 5. lumabee.glb (src/assets/models/lumabee.glb)
 *    - Static mesh model (NO ANIMATIONS, NO SKELETON)
 *    - Original name: demo_textured.obj
 *    - 28,164 vertices, ~2x1.7x2 unit bounding box
 *    - PBR material with embedded textures (base color + metallic/roughness)
 *
 * ===========================================================================
 */

/**
 * Bee AI States
 */
export enum BeeState {
  APPROACH = 'APPROACH',   // Flying to tree from spawn (dramatic entrance)
  IDLE = 'IDLE',           // Hovering near tree
  PATROL = 'PATROL',       // Flying in pattern around tree
  HARVEST = 'HARVEST',     // Extracting nectar from tree
  RETURN = 'RETURN',       // Flying back to hive/tree
  FLEE = 'FLEE',           // Fleeing from player
  WANDER = 'WANDER'        // Exploring area
}

export interface LumabeeProps {
  id: string;
  position: THREE.Vector3;
  treePosition?: THREE.Vector3;  // Home tree position (ground level)
  treeHeight?: number;            // Height of the tree (for canopy targeting)
  seed: number;
  onHarvest?: (position: THREE.Vector3) => void;
  onStateChange?: (state: BeeState) => void;
}

interface LumabeeGLTF extends GLTF {
  nodes: Record<string, THREE.Object3D>;
  materials: Record<string, THREE.Material>;
}

// Dev mode check
const isDev = () => import.meta.env.DEV;

/**
 * LumabeeCharacter - Single bee instance with AI and animation
 *
 * Features:
 * - GLB model loading with animations
 * - State machine AI (approach, idle, patrol, harvest, return, flee, wander)
 * - Smooth flight physics with banking and momentum
 * - Tree-seeking behavior for nectar extraction at canopy level
 * - Player avoidance with flee behavior
 * - Emissive glow effects
 * - Material cleanup to prevent memory leaks
 * - Terrain-aware height clamping
 */
export const LumabeeCharacter: React.FC<LumabeeProps> = ({
  id,
  position: initialPosition,
  treePosition,
  treeHeight = 15.0,  // Default tree height if not provided
  seed,
  onHarvest,
  onStateChange
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(lumabeeUrl) as unknown as LumabeeGLTF;
  // NOTE: This GLB has NO embedded animations - it's a static mesh
  // We'll use procedural animation (rotation/bobbing) instead

  // AI State - use ref instead of useState to avoid reconciliation in useFrame
  const stateRef = useRef<BeeState>(BeeState.APPROACH);
  const stateTimeRef = useRef(0);
  const stateThresholdRef = useRef(0);  // Cache transition thresholds
  const targetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const velocityRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const lookDirRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 1));

  // Temp vectors for calculations (prevents allocations in hot paths)
  const tempVec1 = useRef<THREE.Vector3>(new THREE.Vector3());
  const tempVec2 = useRef<THREE.Vector3>(new THREE.Vector3());

  // Quaternion-based rotation for smooth transitions
  const currentQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const targetQuat = useRef<THREE.Quaternion>(new THREE.Quaternion());
  const tempEuler = useRef<THREE.Euler>(new THREE.Euler(0, 0, 0, 'YXZ'));

  // Flight parameters
  // TODO: These values are ASSUMED - need visual testing to verify they feel right
  // TODO: maxSpeed, acceleration, turnSpeed should be tuned with actual gameplay
  // TODO: patrolRadius should match FractalTree canopy size (check FractalTree.tsx)
  // TODO: harvestDistance may need adjustment based on where bees visually "touch" leaves
  const flightParams = useMemo(() => ({
    maxSpeed: 3.5 + Math.sin(seed * 100) * 0.5,
    approachSpeed: 5.0,  // Faster speed during initial approach
    acceleration: 8.0,
    deceleration: 5.0,
    turnSpeed: 4.0,
    hoverAmplitude: 0.3,
    hoverFrequency: 2.0 + Math.sin(seed * 50) * 0.5,
    bankAngle: Math.PI / 6, // 30 degrees max bank
    patrolRadius: 8.0 + Math.sin(seed * 200) * 2.0,
    fleeDistance: 12.0,
    harvestDistance: 2.5,  // Horizontal XZ distance
    wanderRadius: 15.0,
    minHeight: 2.0,  // Minimum height above terrain
    maxHeight: 50.0  // Maximum flight height
  }), [seed]);

  // Pseudo-random generator for this bee (cached)
  const random = useMemo(() => {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }, [seed]);

  // Clone model for this instance
  // NOTE: This GLB has NO animations - it's a static textured mesh (demo_textured.obj)
  // The model has embedded textures for base color and metallic/roughness
  const modelClone = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        // Enable shadow casting and receiving
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        // Clone materials to avoid shared state between instances
        // IMPORTANT: Don't modify the material properties - the GLB has proper
        // PBR textures that provide the bee's appearance
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => mat.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      }
    });
    return clone;
  }, [scene]);

  // Cleanup materials on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      modelClone.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(mat => mat.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
    };
  }, [modelClone]);

  // Initialize position
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.copy(initialPosition);
      targetRef.current.copy(initialPosition);
    }
  }, [initialPosition]);

  // Log model structure once on mount (only first bee in dev mode)
  const hasLoggedModel = useRef(false);
  useEffect(() => {
    if (isDev() && scene && !hasLoggedModel.current && id === 'bee-0') {
      hasLoggedModel.current = true;

      console.log(`\n========== LUMABEE MODEL INSPECTION ==========`);
      console.log(`[Lumabee] NOTE: This is a STATIC mesh with NO animations`);

      // Log scene hierarchy
      console.log(`[Lumabee] Scene hierarchy:`);
      const logNode = (node: THREE.Object3D, depth: number = 0) => {
        const indent = '  '.repeat(depth);
        const mesh = node as THREE.Mesh;
        let info = `${indent}${node.name || '(unnamed)'} [${node.type}]`;
        if (mesh.isMesh) {
          info += ` - MESH (${mesh.geometry?.attributes?.position?.count || 0} verts)`;
        }
        console.log(info);
        node.children.forEach(child => logNode(child, depth + 1));
      };
      logNode(scene);

      // Log bounding box to understand model scale and orientation
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      console.log(`[Lumabee] Model bounds:`, {
        min: { x: box.min.x.toFixed(2), y: box.min.y.toFixed(2), z: box.min.z.toFixed(2) },
        max: { x: box.max.x.toFixed(2), y: box.max.y.toFixed(2), z: box.max.z.toFixed(2) },
        size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) }
      });

      console.log(`==========================================\n`);
    }
  }, [id, scene]);

  // State machine transitions with cached thresholds
  const transitionState = (newState: BeeState) => {
    if (newState === stateRef.current) return;

    if (isDev()) {
      console.log(`[Lumabee ${id}] ${stateRef.current} → ${newState}`);
    }

    stateRef.current = newState;
    stateTimeRef.current = 0;
    onStateChange?.(newState);

    // Cache transition threshold for this state
    switch (newState) {
      case BeeState.IDLE:
        stateThresholdRef.current = 2.0 + random() * 2.0;
        break;
      case BeeState.PATROL:
        stateThresholdRef.current = 8.0 + random() * 4.0;
        break;
      case BeeState.HARVEST:
        stateThresholdRef.current = 3.0 + random() * 2.0;
        break;
      case BeeState.WANDER:
        stateThresholdRef.current = 5.0 + random() * 3.0;
        break;
      default:
        stateThresholdRef.current = 0;
    }
    // NOTE: No animation switching needed - model has no embedded animations
    // Procedural animation (bobbing/rotation) is handled in useFrame
  };

  // Canopy radius estimate based on tree height (fractal trees have wide canopies)
  // TODO: ASSUMPTION - 0.4 ratio is guessed. Check FractalTree.tsx for actual canopy spread
  // TODO: FractalTree may have variable canopy sizes - consider passing actual radius from BeeManager
  const canopyRadius = useMemo(() => treeHeight * 0.4, [treeHeight]);

  // Harvest position on canopy edge - stored per-bee for consistency
  const harvestAngleRef = useRef<number>(seed * Math.PI * 2);

  // Calculate canopy position on the outer edge (where leaves are)
  // Returns a point at canopy height, offset from trunk by canopy radius
  // TODO: ASSUMPTION - 0.7 height ratio is guessed. FractalTree may have different foliage distribution
  // TODO: ASSUMPTION - 0.8 canopy offset is guessed. Bees might still hit trunk or float in air
  const getCanopyPosition = (basePos: THREE.Vector3, output: THREE.Vector3, forHarvest: boolean = false): THREE.Vector3 => {
    const canopyHeight = basePos.y + treeHeight * 0.7;

    if (forHarvest) {
      // For harvest, target a specific point on canopy edge (consistent per bee)
      const angle = harvestAngleRef.current;
      return output.set(
        basePos.x + Math.cos(angle) * canopyRadius * 0.8,
        canopyHeight,
        basePos.z + Math.sin(angle) * canopyRadius * 0.8
      );
    } else {
      // For approach/return, target center of canopy
      return output.set(
        basePos.x,
        canopyHeight,
        basePos.z
      );
    }
  };

  // AI behavior update
  useFrame((frameState, dt) => {
    if (!groupRef.current) return;

    const position = groupRef.current.position;
    const camera = frameState.camera;
    stateTimeRef.current += dt;

    // Player distance check
    const playerDist = position.distanceTo(camera.position);
    const playerClose = playerDist < flightParams.fleeDistance;

    // State machine logic
    switch (stateRef.current) {
      case BeeState.APPROACH:
        // Fly toward tree from spawn (dramatic entrance)
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (!treePosition) {
          transitionState(BeeState.WANDER);
        } else {
          // Check horizontal distance to tree
          const dx = position.x - treePosition.x;
          const dz = position.z - treePosition.z;
          const horizDist = Math.sqrt(dx * dx + dz * dz);

          if (horizDist < flightParams.patrolRadius * 1.5) {
            // Reached tree - transition to patrol
            transitionState(BeeState.PATROL);
          } else {
            // Keep flying toward canopy (writes directly to targetRef to avoid allocation)
            getCanopyPosition(treePosition, targetRef.current);
          }
        }
        break;

      case BeeState.IDLE:
        // Hover in place with gentle bobbing
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (stateTimeRef.current > stateThresholdRef.current) {
          if (treePosition && random() > 0.3) {
            transitionState(BeeState.PATROL);
          } else {
            transitionState(BeeState.WANDER);
          }
        }
        break;

      case BeeState.PATROL:
        // Circle around tree at canopy level
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (!treePosition) {
          transitionState(BeeState.WANDER);
        } else if (stateTimeRef.current > stateThresholdRef.current) {
          if (random() > 0.5) {
            transitionState(BeeState.HARVEST);
          } else {
            transitionState(BeeState.IDLE);
          }
        } else {
          // Update patrol target - circle at canopy level
          const angle = stateTimeRef.current * 0.5 + seed * Math.PI * 2;
          const radius = flightParams.patrolRadius;
          const canopyY = treePosition.y + treeHeight * 0.7;

          targetRef.current.set(
            treePosition.x + Math.cos(angle) * radius,
            canopyY + Math.sin(stateTimeRef.current * 1.5) * 2.0,
            treePosition.z + Math.sin(angle) * radius
          );
        }
        break;

      case BeeState.HARVEST:
        // Approach tree canopy edge (leaves) and extract nectar
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (!treePosition) {
          transitionState(BeeState.WANDER);
        } else {
          // Get target position at canopy edge (where leaves are)
          getCanopyPosition(treePosition, tempVec1.current, true);

          // Check distance to harvest target (not trunk)
          const distToHarvest = position.distanceTo(tempVec1.current);

          if (distToHarvest < flightParams.harvestDistance) {
            // At harvest position on canopy - hover and extract
            if (stateTimeRef.current > stateThresholdRef.current) {
              onHarvest?.(position.clone());
              // Pick a new random harvest angle for next time
              harvestAngleRef.current = random() * Math.PI * 2;
              transitionState(BeeState.RETURN);
            }
            // Stay near harvest point with gentle drift
            targetRef.current.copy(tempVec1.current);
          } else {
            // Move toward canopy edge harvest point
            targetRef.current.copy(tempVec1.current);
          }
        }
        break;

      case BeeState.RETURN:
        // Fly back to patrol zone
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (treePosition) {
          const dx = position.x - treePosition.x;
          const dz = position.z - treePosition.z;
          const horizDist = Math.sqrt(dx * dx + dz * dz);

          if (horizDist < flightParams.patrolRadius * 1.5) {
            transitionState(BeeState.PATROL);
          } else {
            // Fly back to canopy (writes directly to targetRef to avoid allocation)
            getCanopyPosition(treePosition, targetRef.current);
          }
        } else {
          transitionState(BeeState.IDLE);
        }
        break;

      case BeeState.FLEE:
        // Flee from player
        if (playerDist > flightParams.fleeDistance * 2.0) {
          transitionState(treePosition ? BeeState.PATROL : BeeState.WANDER);
        } else {
          // Flee away from player (use cached temp vector)
          const fleeDir = tempVec1.current
            .subVectors(position, camera.position)
            .normalize();
          targetRef.current.copy(position).addScaledVector(fleeDir, 10.0);
          targetRef.current.y = Math.max(targetRef.current.y, position.y + 3.0);
        }
        break;

      case BeeState.WANDER:
        // Random exploration
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (treePosition && random() > 0.98) {
          transitionState(BeeState.PATROL);
        } else if (stateTimeRef.current > stateThresholdRef.current ||
                   position.distanceTo(targetRef.current) < 2.0) {
          // Pick new wander target
          const angle = random() * Math.PI * 2;
          const distance = random() * flightParams.wanderRadius;
          targetRef.current.set(
            position.x + Math.cos(angle) * distance,
            4.0 + random() * 8.0,
            position.z + Math.sin(angle) * distance
          );
          stateTimeRef.current = 0;
        }
        break;
    }

    // Flight physics - smooth movement toward target (use cached temp vector)
    const toTarget = tempVec2.current.subVectors(targetRef.current, position);
    const distToTarget = toTarget.length();

    if (distToTarget > 0.1) {
      // Use faster speed during APPROACH state
      const maxSpeed = stateRef.current === BeeState.APPROACH
        ? flightParams.approachSpeed
        : flightParams.maxSpeed;

      const desiredVel = toTarget.normalize().multiplyScalar(
        Math.min(maxSpeed, distToTarget)
      );

      // Smooth acceleration (faster when fleeing or approaching)
      const accel = (stateRef.current === BeeState.FLEE || stateRef.current === BeeState.APPROACH)
        ? flightParams.acceleration * 1.5
        : flightParams.acceleration;
      velocityRef.current.lerp(desiredVel, 1.0 - Math.pow(0.001, dt * accel));
    } else {
      // Decelerate when near target
      velocityRef.current.multiplyScalar(Math.pow(0.001, dt * flightParams.deceleration));
    }

    // Apply velocity
    position.addScaledVector(velocityRef.current, dt);

    // Hover bobbing (gentle oscillation)
    const hoverOffset = Math.sin(frameState.clock.elapsedTime * flightParams.hoverFrequency + seed * 10)
      * flightParams.hoverAmplitude;
    position.y += hoverOffset * dt;

    // Terrain-aware height clamping
    const terrainHeight = TerrainService.getHeightAt(position.x, position.z);
    position.y = THREE.MathUtils.clamp(
      position.y,
      terrainHeight + flightParams.minHeight,
      flightParams.maxHeight
    );

    // Rotation - use quaternion slerp for smooth transitions
    // TODO: ASSUMPTION - model forward is -Z (Three.js convention)
    // TODO: If bee faces wrong direction, adjust MODEL_YAW_OFFSET at bottom of file
    // TODO: GLB inspection showed nearly cubic mesh (~2x1.7x2) - forward axis is unclear
    if (velocityRef.current.lengthSq() > 0.01) {
      // Smoothly update look direction
      lookDirRef.current.lerp(
        tempVec2.current.copy(velocityRef.current).normalize(),
        1.0 - Math.pow(0.05, dt * flightParams.turnSpeed)
      );
      lookDirRef.current.normalize();

      // Calculate target orientation from look direction
      const yaw = Math.atan2(lookDirRef.current.x, lookDirRef.current.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(-lookDirRef.current.y, -1, 1));

      // Bank based on rate of yaw change (turning) - smoother banking
      const lateralVel = velocityRef.current.x * Math.cos(yaw) - velocityRef.current.z * Math.sin(yaw);
      const roll = THREE.MathUtils.clamp(lateralVel * flightParams.bankAngle * 0.2, -Math.PI / 4, Math.PI / 4);

      // Set target rotation using euler with YXZ order
      tempEuler.current.set(pitch, yaw, roll, 'YXZ');
      targetQuat.current.setFromEuler(tempEuler.current);

      // Smoothly slerp current rotation toward target
      currentQuat.current.slerp(targetQuat.current, 1.0 - Math.pow(0.01, dt * 8.0));

      // Apply to group
      groupRef.current.quaternion.copy(currentQuat.current);
    }
    // NOTE: No mixer/animation speed update - model has no embedded animations
  });

  // Model orientation offset - GLB model was authored with +Z forward (Blender convention)
  // Math.PI rotates 180° so the model faces -Z (Three.js forward direction)
  // Tuned via ?debug=bee interface on 2026-01-10
  const MODEL_YAW_OFFSET = Math.PI; // Radians - rotate model to face -Z (flight direction)

  return (
    <group ref={groupRef}>
      {/* Inner group for model base rotation offset */}
      <group rotation={[0, MODEL_YAW_OFFSET, 0]}>
        {/* TODO: ASSUMPTION - 0.15 scale is arbitrary, based on model being ~2 units
             TODO: Adjust if bees are too big or too small relative to trees */}
        <primitive object={modelClone} scale={0.15} />
      </group>

      {/* Glow effect for nectar trail */}
      {stateRef.current === BeeState.HARVEST && (
        <pointLight
          intensity={0.8}
          distance={3.0}
          color="#ffcc00"
          castShadow={false}
        />
      )}
    </group>
  );
};

// Preload the model
useGLTF.preload(lumabeeUrl);
