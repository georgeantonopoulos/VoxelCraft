import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * StoneTool
 * Lightweight held stone item (first-person).
 */
export const StoneTool: React.FC = () => {
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#8e8e9a',
    roughness: 0.92,
    metalness: 0.0
  }), []);

  return (
    <group>
      <mesh material={material} castShadow receiveShadow>
        <dodecahedronGeometry args={[0.22, 0]} />
      </mesh>
    </group>
  );
};

