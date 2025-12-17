import React, { useMemo } from 'react';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import floraImg from '@/assets/images/flower_blue.png';

/**
 * FloraTool
 * Lightweight held "flora" item for first-person.
 * Uses a textured quad so it loads instantly and matches the inventory icon.
 */
export const FloraTool: React.FC = () => {
  const texture = useTexture(floraImg);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.15,
      side: THREE.DoubleSide,
      color: new THREE.Color('#ffffff'),
      emissive: new THREE.Color('#66ccff'),
      emissiveIntensity: 0.35,
      roughness: 0.85,
      metalness: 0.0,
    });
    // Don't let tone mapping crush the icon colors.
    mat.toneMapped = false;
    return mat;
  }, [texture]);

  return (
    <group>
      <mesh material={material} castShadow receiveShadow>
        {/* Keep roughly similar screen size to the held stone. */}
        <planeGeometry args={[0.25, 0.25]} />
      </mesh>
    </group>
  );
};
