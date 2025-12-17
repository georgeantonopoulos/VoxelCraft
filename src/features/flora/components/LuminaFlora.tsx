import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';

interface LuminaFloraProps {
  id: string;
  position: [number, number, number];
  onPickup?: () => void;
  seed?: number; // To vary the phase
  bodyRef?: React.RefObject<any>;
}

export const LuminaFlora: React.FC<LuminaFloraProps> = ({ id, position, seed = 0, bodyRef }) => {
  const bulbMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  // If no external ref provided, use internal one (though for placed flora, bodyRef is expected)
  const internalRef = useRef<any>(null);
  const refToUse = bodyRef || internalRef;

  // Keep these stable to avoid re-allocations; we reuse the seed and a shared color.
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#00FFFF') }, // Cyan
    uSeed: { value: seed }
  }), [seed]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (bulbMaterialRef.current) {
      // Breathing effect (keeps it "alive") without custom shaders.
      const pulse = Math.sin(t * 2.0 + uniforms.uSeed.value) * 0.35 + 1.15; // ~0.8..1.5
      bulbMaterialRef.current.emissiveIntensity = 1.35 * pulse;
    }
  });

  return (
    <RigidBody
      ref={refToUse}
      type="dynamic"
      colliders="ball"
      position={position}
      restitution={0.2}
      friction={0.8}
      userData={{ type: 'flora', id }} // For interaction (pickup on dig)
    >
      <group>
        {/* The Light Source - Cool White, moderate range */}
        {/* NOTE: moved to a small pooled light set (see `src/features/flora/components/FloraPlacer.tsx`)
            to avoid a frame hitch when creating/removing point lights at runtime. */}

        {/* The Visual Bulb - Cyan Emissive with Shader Pulse */}
        <mesh castShadow receiveShadow>
          {/* A cluster of spheres or a single sphere for now. User said "Group of 3 spheres" in plan Phase 1 */}
          <sphereGeometry args={[0.25, 24, 24]} />
          <meshStandardMaterial
            ref={bulbMaterialRef}
            color="#222"
            emissive={uniforms.uColor.value}
            emissiveIntensity={1.35}
            roughness={0.4}
            metalness={0.0}
            toneMapped={false} // Crucial for Bloom
          />
        </mesh>

        {/* Extra geometry for "Cluster" look?
            Let's keep it simple for the first pass or add small side bulbs.
        */}
        <mesh position={[0.15, -0.1, 0.1]} castShadow receiveShadow>
          <sphereGeometry args={[0.15, 16, 16]} />
          <meshStandardMaterial
            color="#222"
            emissive="#00FFFF"
            emissiveIntensity={0.5}
            toneMapped={false}
          />
          {/* Note: Side bulbs use simple material for now, or we can reuse the CSM if we extract it */}
        </mesh>
        <mesh position={[-0.15, -0.15, -0.05]} castShadow receiveShadow>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial
            color="#222"
            emissive="#00FFFF"
            emissiveIntensity={0.5}
            toneMapped={false}
          />
        </mesh>
      </group>
    </RigidBody>
  );
};
