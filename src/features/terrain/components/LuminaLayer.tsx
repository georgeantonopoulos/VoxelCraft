import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

interface LuminaLayerProps {
  data: Float32Array; // stride 4: x, y, z, type (type unused for now)
}

/**
 * Lightweight instanced renderer for cavern lumina flora.
 * No shadows and minimal material state to avoid exhausting texture units.
 */
export const LuminaLayer: React.FC<LuminaLayerProps> = React.memo(({ data }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const count = data.length / 4;

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    for (let i = 0; i < count; i++) {
      const x = data[i * 4];
      const y = data[i * 4 + 1];
      const z = data[i * 4 + 2];
      dummy.position.set(x, y, z);
      const scale = 0.35;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [data, count, dummy]);

  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#00e5ff',
    emissive: '#00e5ff',
    emissiveIntensity: 2.4,
    roughness: 0.4,
    metalness: 0.0,
    toneMapped: false
  }), []);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow={false} receiveShadow={false}>
      <sphereGeometry args={[0.25, 12, 12]} />
      <primitive object={mat} attach="material" />
    </instancedMesh>
  );
});
