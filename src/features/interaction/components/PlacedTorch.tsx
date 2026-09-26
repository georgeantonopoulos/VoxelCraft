import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PooledPointLight, type VirtualPointLight } from '@core/graphics/PointLightPool';
import { TorchModel } from './TorchModel';

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
  const lightRef = useRef<VirtualPointLight>(null);
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
      <TorchModel length={0.44} flameScale={0.9} />

      {/* Warm point light */}
      <PooledPointLight
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

