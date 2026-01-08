import React, { useEffect, useRef, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Import model as URL (Vite will handle bundling)
import lumabeeUrl from '@/assets/models/lumabee.glb?url';

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

interface LumabeeProps {
  id: string;
  position: THREE.Vector3;
  treePosition?: THREE.Vector3;  // Home tree position
  seed: number;
  onHarvest?: (position: THREE.Vector3) => void;
  onStateChange?: (state: BeeState) => void;
}

interface LumabeeGLTF extends GLTF {
  nodes: Record<string, THREE.Mesh>;
  materials: Record<string, THREE.Material>;
}

/**
 * LumabeeCharacter - Single bee instance with AI and animation
 *
 * Features:
 * - GLB model loading with animations
 * - State machine AI (idle, patrol, harvest, flee, wander)
 * - Smooth flight physics with banking and momentum
 * - Tree-seeking behavior for nectar extraction
 * - Player avoidance
 * - Emissive glow effects
 */
export const LumabeeCharacter: React.FC<LumabeeProps> = ({
  id,
  position: initialPosition,
  treePosition,
  seed,
  onHarvest,
  onStateChange
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(lumabeeUrl) as LumabeeGLTF;
  const { actions, mixer } = useAnimations(animations, groupRef);

  // AI State
  const [state, setState] = useState<BeeState>(BeeState.IDLE);
  const stateTimeRef = useRef(0);
  const targetRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const velocityRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const lookDirRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0, 1));

  // Flight parameters
  const flightParams = useMemo(() => ({
    maxSpeed: 3.5 + Math.sin(seed * 100) * 0.5,
    acceleration: 8.0,
    deceleration: 5.0,
    turnSpeed: 4.0,
    hoverAmplitude: 0.3,
    hoverFrequency: 2.0 + Math.sin(seed * 50) * 0.5,
    bankAngle: Math.PI / 6, // 30 degrees max bank
    patrolRadius: 8.0 + Math.sin(seed * 200) * 2.0,
    fleeDistance: 12.0,
    harvestDistance: 1.5,
    wanderRadius: 15.0
  }), [seed]);

  // Pseudo-random generator for this bee
  const random = useMemo(() => {
    let s = seed * 9301 + 49297;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }, [seed]);

  // Clone model for this instance
  const modelClone = useMemo(() => {
    const clone = scene.clone();
    // Apply emissive glow to bee materials
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => {
            const clonedMat = mat.clone();
            if ('emissive' in clonedMat) {
              (clonedMat as THREE.MeshStandardMaterial).emissive = new THREE.Color('#ffcc00');
              (clonedMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
            }
            return clonedMat;
          });
        } else {
          mesh.material = mesh.material.clone();
          if ('emissive' in mesh.material) {
            (mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#ffcc00');
            (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3;
          }
        }
      }
    });
    return clone;
  }, [scene]);

  // Initialize position
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.position.copy(initialPosition);
      targetRef.current.copy(initialPosition);
    }
  }, [initialPosition]);

  // State machine transitions
  const transitionState = (newState: BeeState) => {
    if (newState === state) return;
    setState(newState);
    stateTimeRef.current = 0;
    onStateChange?.(newState);

    // Play appropriate animation
    if (actions) {
      Object.values(actions).forEach(action => action?.fadeOut(0.2));

      const animMap: Record<BeeState, string> = {
        [BeeState.IDLE]: 'Idle',
        [BeeState.PATROL]: 'Fly',
        [BeeState.HARVEST]: 'Harvest',
        [BeeState.RETURN]: 'Fly',
        [BeeState.FLEE]: 'Fly',
        [BeeState.WANDER]: 'Fly'
      };

      const animName = animMap[newState];
      const action = Object.entries(actions).find(([name]) =>
        name.toLowerCase().includes(animName.toLowerCase())
      )?.[1];

      if (action) {
        action.reset().fadeIn(0.2).play();
      }
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
    switch (state) {
      case BeeState.IDLE:
        // Hover in place with gentle bobbing
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (stateTimeRef.current > 2.0 + random() * 2.0) {
          if (treePosition && random() > 0.3) {
            transitionState(BeeState.PATROL);
          } else {
            transitionState(BeeState.WANDER);
          }
        }
        break;

      case BeeState.PATROL:
        // Circle around tree
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (!treePosition) {
          transitionState(BeeState.WANDER);
        } else if (stateTimeRef.current > 8.0 + random() * 4.0) {
          if (random() > 0.5) {
            transitionState(BeeState.HARVEST);
          } else {
            transitionState(BeeState.IDLE);
          }
        } else {
          // Update patrol target
          const angle = stateTimeRef.current * 0.5 + seed * Math.PI * 2;
          const radius = flightParams.patrolRadius;
          targetRef.current.set(
            treePosition.x + Math.cos(angle) * radius,
            treePosition.y + 5.0 + Math.sin(stateTimeRef.current * 1.5) * 2.0,
            treePosition.z + Math.sin(angle) * radius
          );
        }
        break;

      case BeeState.HARVEST:
        // Approach tree and extract nectar
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (!treePosition) {
          transitionState(BeeState.WANDER);
        } else {
          const distToTree = position.distanceTo(treePosition);
          if (distToTree < flightParams.harvestDistance) {
            // At harvest position - hover and extract
            if (stateTimeRef.current > 3.0 + random() * 2.0) {
              onHarvest?.(position.clone());
              transitionState(BeeState.RETURN);
            }
          } else {
            // Move toward tree
            targetRef.current.copy(treePosition).setY(treePosition.y + 8.0);
          }
        }
        break;

      case BeeState.RETURN:
        // Fly back to patrol zone
        if (playerClose) {
          transitionState(BeeState.FLEE);
        } else if (treePosition) {
          const distToTree = position.distanceTo(treePosition);
          if (distToTree < flightParams.patrolRadius * 1.5) {
            transitionState(BeeState.PATROL);
          } else {
            targetRef.current.copy(treePosition).setY(treePosition.y + 6.0);
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
          // Flee away from player
          const fleeDir = new THREE.Vector3()
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
        } else if (stateTimeRef.current > 5.0 || position.distanceTo(targetRef.current) < 2.0) {
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

    // Flight physics - smooth movement toward target
    const toTarget = new THREE.Vector3().subVectors(targetRef.current, position);
    const distToTarget = toTarget.length();

    if (distToTarget > 0.1) {
      const desiredVel = toTarget.normalize().multiplyScalar(
        Math.min(flightParams.maxSpeed, distToTarget)
      );

      // Smooth acceleration
      const accel = state === BeeState.FLEE ? flightParams.acceleration * 1.5 : flightParams.acceleration;
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

    // Rotation - look in flight direction with banking
    if (velocityRef.current.lengthSq() > 0.01) {
      lookDirRef.current.lerp(
        velocityRef.current.clone().normalize(),
        1.0 - Math.pow(0.0001, dt * flightParams.turnSpeed)
      );

      const yaw = Math.atan2(lookDirRef.current.x, lookDirRef.current.z);
      const pitch = Math.asin(-lookDirRef.current.y);
      const roll = velocityRef.current.x * flightParams.bankAngle;

      groupRef.current.rotation.set(pitch, yaw, roll);
    }

    // Update animation speed based on velocity
    if (mixer) {
      const speed = velocityRef.current.length() / flightParams.maxSpeed;
      mixer.timeScale = 0.5 + speed * 0.5;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={modelClone} scale={0.15} />

      {/* Glow effect for nectar trail */}
      {state === BeeState.HARVEST && (
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
