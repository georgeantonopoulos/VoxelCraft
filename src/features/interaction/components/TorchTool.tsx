import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three';

/**
 * TorchTool
 * A lightweight first-person torch that sits in the player's left hand.
 * - Procedural mesh (no assets) to keep load fast.
 * - Small instanced "ember" particles drifting upward.
 * - Warm point light with subtle flicker.
 *
 * Keep particle count low and avoid allocations per-frame for performance.
 */
export const TorchTool: React.FC = () => {
  const torchRef = useRef<THREE.Group>(null);
  const flameLightRef = useRef<THREE.SpotLight>(null);
  const lightTargetRef = useRef<THREE.Object3D>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);
  
  // Preallocated helpers for spotlight aiming (avoid per-frame allocs)
  const worldQuat = useRef(new THREE.Quaternion());
  const forwardWorld = useRef(new THREE.Vector3());
  const lightPosWorld = useRef(new THREE.Vector3());
  const targetWorld = useRef(new THREE.Vector3());
  const downWorld = useRef(new THREE.Vector3(0, -0.35, 0));
  
  // Debug UI: enable with ?debug in URL (same switch as App).
  const debugMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  }, []);
  
  // Live-tweak spotlight properties in debug mode.
	  const torchLightDebug = useControls(
	    'Torch Spotlight',
	    {
	      enabled: true,
	      color: '#ffdbb1',
	      baseIntensity: { value: 2.1, min: 0.2, max: 12.0, step: 0.1 },
	      distance: { value: 28, min: 4, max: 120, step: 1 },
	      decay: { value: 0.4, min: 0, max: 4, step: 0.1 },
	      // Three.js spotlight angles effectively cap near 90deg (PI/2).
	      angleDeg: { value: 89, min: 5, max: 89, step: 1 },
	      penumbra: { value: 1.0, min: 0, max: 1, step: 0.05 },
	      targetDistance: { value: 12.0, min: 1.5, max: 12, step: 0.1 },
	      downBias: { value: 0.35, min: 0, max: 1.5, step: 0.05 },
	      flickerAmount: { value: 0.24, min: 0, max: 0.4, step: 0.01 },
	    },
	    { hidden: !debugMode }
	  );

  // Stable helper objects
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = 14;
  const lifetimes = useRef<number[]>(Array.from({ length: count }, () => 0));
  const velocities = useRef<THREE.Vector3[]>(
    Array.from({ length: count }, () => new THREE.Vector3())
  );
  const offsets = useRef<THREE.Vector3[]>(
    Array.from({ length: count }, () => new THREE.Vector3())
  );

  // Seed particles once.
  useEffect(() => {
    for (let i = 0; i < count; i++) {
      lifetimes.current[i] = Math.random() * 0.6;
      velocities.current[i].set(
        (Math.random() - 0.5) * 0.12,
        0.25 + Math.random() * 0.25,
        (Math.random() - 0.5) * 0.12
      );
      offsets.current[i].set(
        (Math.random() - 0.5) * 0.03,
        Math.random() * 0.05,
        (Math.random() - 0.5) * 0.03
      );
    }
  }, []);
  
  // Wire spotlight target once refs are mounted.
  useEffect(() => {
    if (flameLightRef.current && lightTargetRef.current) {
      flameLightRef.current.target = lightTargetRef.current;
      flameLightRef.current.updateMatrixWorld();
    }
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    // Subtle idle sway for the torch itself.
    if (torchRef.current) {
      // Base yaw flips the torch so the flame faces forward in FPS space.
      torchRef.current.rotation.y = Math.PI;
      torchRef.current.rotation.z = -0.15 + Math.sin(t * 1.8) * 0.015;
      torchRef.current.rotation.x = 0.05 + Math.cos(t * 1.2) * 0.01;
    }

    // Light flicker (small amplitude so it doesn't distract).
    if (flameLightRef.current) {
      const flicker = 1.0 + Math.sin(t * 14.0) * 0.08 + Math.sin(t * 7.0) * 0.04;
      const baseIntensity = debugMode ? torchLightDebug.baseIntensity : 2.1;
      const flickerAmt = debugMode ? torchLightDebug.flickerAmount : 0.24;
      // Scale flicker amount relative to default 0.12.
      flameLightRef.current.intensity = baseIntensity * (1.0 + (flicker - 1.0) * (flickerAmt / 0.12));
    }
    
    // Aim spotlight forward in world space, with a slight downward bias.
    // The FPS rig rotates the torch, so we can't rely on a fixed local target.
    if (torchRef.current && flameLightRef.current && lightTargetRef.current) {
      torchRef.current.getWorldQuaternion(worldQuat.current);
      // Torch "forward" in world space (-Z by convention).
      forwardWorld.current.set(0, 0, -1).applyQuaternion(worldQuat.current).normalize();
      flameLightRef.current.getWorldPosition(lightPosWorld.current);
      
      const targetDist = debugMode ? torchLightDebug.targetDistance : 12.0;
      const downBias = debugMode ? torchLightDebug.downBias : 0.35;
      downWorld.current.set(0, -downBias, 0);
      
      targetWorld.current
        .copy(lightPosWorld.current)
        .addScaledVector(forwardWorld.current, targetDist)
        .add(downWorld.current);
      
      // Convert to torch local space for the target object.
      torchRef.current.worldToLocal(targetWorld.current);
      lightTargetRef.current.position.copy(targetWorld.current);
      lightTargetRef.current.updateMatrixWorld();
    }
    
    // Apply debug spotlight properties live.
    if (debugMode && flameLightRef.current) {
      flameLightRef.current.visible = torchLightDebug.enabled;
      flameLightRef.current.color.set(torchLightDebug.color);
      flameLightRef.current.distance = torchLightDebug.distance;
      flameLightRef.current.decay = torchLightDebug.decay;
      flameLightRef.current.angle = THREE.MathUtils.degToRad(torchLightDebug.angleDeg);
      flameLightRef.current.penumbra = torchLightDebug.penumbra;
    }

    // Particle update: drift upward and respawn in place.
    const mesh = particlesRef.current;
    if (!mesh) return;

    for (let i = 0; i < count; i++) {
      lifetimes.current[i] -= delta;
      if (lifetimes.current[i] <= 0) {
        lifetimes.current[i] = 0.5 + Math.random() * 0.6;
        velocities.current[i].set(
          (Math.random() - 0.5) * 0.12,
          0.25 + Math.random() * 0.25,
          (Math.random() - 0.5) * 0.12
        );
        offsets.current[i].set(
          (Math.random() - 0.5) * 0.03,
          Math.random() * 0.05,
          (Math.random() - 0.5) * 0.03
        );
      }

      // Flame origin relative to torch local space (top).
      dummy.position.set(
        offsets.current[i].x,
        0.60 + offsets.current[i].y,
        offsets.current[i].z
      );
      dummy.position.addScaledVector(velocities.current[i], (0.6 - lifetimes.current[i]) * delta * 60);

      // Soft fade and slight growth.
      const life01 = THREE.MathUtils.clamp(lifetimes.current[i] / 1.1, 0, 1);
      const scale = THREE.MathUtils.lerp(0.02, 0.06, 1.0 - life01);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={torchRef}>
      {/* Torch handle */}
      <mesh position={[0, 0.0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.8, 8]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} metalness={0.0} />
      </mesh>

      {/* Metal collar */}
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.06, 10]} />
        <meshStandardMaterial color="#3a3a44" roughness={0.4} metalness={0.6} />
      </mesh>

      {/* Ember core */}
      <mesh position={[0, 0.52, 0]} castShadow>
        <sphereGeometry args={[0.06, 12, 10]} />
        <meshStandardMaterial
          color="#ff9b47"
          emissive="#ff6b1a"
          emissiveIntensity={2.2}
          roughness={0.3}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>

      {/* Flame glow shell */}
      <mesh position={[0, 0.56, 0]}>
        <sphereGeometry args={[0.11, 12, 10]} />
        <meshStandardMaterial
          color="#ffd39a"
          emissive="#ffb36b"
          emissiveIntensity={1.8}
          transparent
          opacity={0.35}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>

      {/* Spotlight for forward cave visibility */}
      <spotLight
        ref={flameLightRef}
        position={[0, 0.60, 0.0]}
        color="#ffdbb1"
        intensity={2.1}
        distance={28}
        decay={0.4}
        // Wider cone to cover most of player's FOV.
        angle={THREE.MathUtils.degToRad(89)}
        penumbra={1.0}
        castShadow={false} // Keep performance stable
      />
      {/* Spotlight target is aimed each frame in world space. */}
      <group ref={lightTargetRef} position={[0, 0.60, -2.5]} />

      {/* Fire particles (embers) */}
      <instancedMesh ref={particlesRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshStandardMaterial
          color="#ffb36b"
          emissive="#ff6b1a"
          emissiveIntensity={1.6}
          transparent
          opacity={0.7}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
};
