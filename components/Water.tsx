
import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WATER_LEVEL } from '../constants';

export const Water: React.FC = () => {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(({ clock }) => {
    if (materialRef.current) {
        // Simple animation of normal map scale or offset could go here if we had textures.
        // For now, we pulse opacity slightly or just rely on specular.
        const t = clock.getElapsedTime();
        materialRef.current.opacity = 0.6 + Math.sin(t * 0.5) * 0.05;
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow>
      <planeGeometry args={[1000, 1000, 1, 1]} />
      <meshStandardMaterial 
        ref={materialRef}
        color="#22aadd"
        transparent
        opacity={0.6}
        roughness={0.1}
        metalness={0.1}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};
