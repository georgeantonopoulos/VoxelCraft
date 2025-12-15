import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * StickTool
 * Lightweight held stick item (first-person).
 */
export const StickTool: React.FC = () => {
  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#8b5a2b',
    roughness: 0.92,
    metalness: 0.0
  }), []);

  return (
    <group>
      <mesh material={material} castShadow receiveShadow>
        <cylinderGeometry args={[0.045, 0.04, 0.95, 10]} />
      </mesh>
    </group>
  );
};

