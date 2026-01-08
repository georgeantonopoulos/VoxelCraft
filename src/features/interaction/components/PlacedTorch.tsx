import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * PlacedTorch
 * A simple world-placed torch:
 * - Oriented by a precomputed quaternion (facing away from the surface normal).
 * - Lightweight flicker to keep it alive without allocating per-frame.
 */
export const PlacedTorch: React.FC<{
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}> = ({ position, rotation }) => {
  const groupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const tmpEuler = useMemo(() => new THREE.Euler(), []);

  // Apply placement transform once (updates if entity changes).
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.copy(position);
    groupRef.current.quaternion.copy(rotation);
  }, [position, rotation]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (lightRef.current) {
      // Small, stable flicker (two sines) to avoid distracting noise.
      const flicker = 1.0 + Math.sin(t * 13.0) * 0.06 + Math.sin(t * 7.0) * 0.03;
      lightRef.current.intensity = 1.4 * flicker;
    }
    if (groupRef.current) {
      // Tiny rotation to keep specular alive; use Euler cached instance.
      tmpEuler.set(0, 0, Math.sin(t * 1.1) * 0.01);
      groupRef.current.rotation.z = tmpEuler.z;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Handle: local +Y points out of the wall/floor based on placement quaternion */}
      <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.44, 8]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} metalness={0.0} />
      </mesh>

      {/* Metal collar */}
      <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.06, 10]} />
        <meshStandardMaterial color="#3a3a44" roughness={0.4} metalness={0.6} />
      </mesh>

      {/* Ember core */}
      <mesh position={[0, 0.54, 0]} castShadow>
        <sphereGeometry args={[0.06, 12, 10]} />
        <meshStandardMaterial
          color="#ff9b47"
          emissive="#ff6b1a"
          emissiveIntensity={2.0}
          roughness={0.3}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>

      {/* Warm point light */}
      <pointLight
        ref={lightRef}
        position={[0, 0.56, 0.0]}
        color="#ffdbb1"
        intensity={1.4}
        distance={18}
        decay={1.2}
        castShadow={false} // Keep this cheap; terrain already has heavy shadowing
      />
    </group>
  );
};

