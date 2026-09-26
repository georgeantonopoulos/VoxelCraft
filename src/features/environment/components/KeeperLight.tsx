import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { PooledPointLight, type VirtualPointLight } from '@core/graphics/PointLightPool';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { useEnvironmentStore } from '@state/EnvironmentStore';

/**
 * The Keeper's glow for objects. Terrain gets it in its shader (uPlayerGlow),
 * because baked GI scales every lit term there; items, flora and creatures use
 * ordinary lights, so underground they get this soft pooled light at the camera.
 * Off on the surface (it would double the terrain glow at night).
 */
export const KeeperLight: React.FC = () => {
  const { camera } = useThree();
  const anchor = useRef<THREE.Group>(null);
  const light = useRef<VirtualPointLight>(null);

  useFrame(() => {
    const g = anchor.current;
    if (g) g.position.copy(camera.position);
    if (light.current) {
      const cave = THREE.MathUtils.smoothstep(useEnvironmentStore.getState().undergroundBlend, 0.25, 0.85);
      light.current.intensity = cave * sharedUniforms.uPlayerGlow.value * 12;
    }
  });

  return (
    <group ref={anchor}>
      <PooledPointLight ref={light} color="#d8e6cf" intensity={0} distance={14} decay={1.6} />
    </group>
  );
};
