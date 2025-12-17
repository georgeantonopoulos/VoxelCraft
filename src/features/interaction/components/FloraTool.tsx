import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/**
 * FloraTool
 * Held "flora" item for first-person.
 * Uses the actual 3D mesh of the glowing blue flora (3 spheres).
 */
export const FloraTool: React.FC = () => {
  const bulbRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (bulbRef.current) {
      const t = clock.getElapsedTime();
      const pulse = Math.sin(t * 2.0) * 0.35 + 1.15;
      bulbRef.current.emissiveIntensity = 1.35 * pulse;
    }
  });

  return (
    <group>
      {/* Main Bulb */}
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.2, 24, 24]} />
        <meshStandardMaterial
          ref={bulbRef}
          color="#111"
          emissive="#00FFFF"
          emissiveIntensity={1.35}
          roughness={0.4}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>

      {/* Side Bulb 1 */}
      <mesh position={[0.12, -0.08, 0.08]} castShadow receiveShadow>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color="#111"
          emissive="#00FFFF"
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>

      {/* Side Bulb 2 */}
      <mesh position={[-0.12, -0.12, -0.04]} castShadow receiveShadow>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshStandardMaterial
          color="#111"
          emissive="#00FFFF"
          emissiveIntensity={0.5}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};
