import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CHUNK_SIZE_XZ } from '@/constants';

interface LuminaLayerProps {
  data: Float32Array; // stride 4: x, y, z, type (type unused for now)
  lightPositions?: Float32Array; // stride 3: x, y, z
  cx: number;
  cz: number;
}

/**
 * Lightweight instanced renderer for cavern lumina flora.
 * - Disables frustum culling to fix visibility issues when chunk origin is off-screen.
 * - Adds clustered point lights that only activate when player is near.
 */
export const LuminaLayer: React.FC<LuminaLayerProps> = React.memo(({ data, lightPositions, cx, cz }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  // const { camera } = useThree(); // Unused

  const count = data.length / 4;

  // 1. Lights are now pre-computed in worker and passed as prop
  const lights = useMemo(() => {
    if (!lightPositions) return [];
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < lightPositions.length; i += 3) {
      arr.push(new THREE.Vector3(lightPositions[i], lightPositions[i + 1], lightPositions[i + 2]));
    }
    return arr;
  }, [lightPositions]);

  // 2. Setup Instances
  useLayoutEffect(() => {
    if (!meshRef.current) return;

    // CRITICAL FIX: Manually set bounding sphere to prevent aggressive culling
    // Since we disable frustumCulled, this is less critical but good practice if we re-enable it later with a proper sphere.
    // For now, we just disable culling.

    const originX = cx * CHUNK_SIZE_XZ;
    const originZ = cz * CHUNK_SIZE_XZ;

    for (let i = 0; i < count; i++) {
      // Data is in WORLD SPACE, but we are inside a group at [originX, 0, originZ]
      // So we must subtract the origin to get local space.
      const x = data[i * 4] - originX;
      const y = data[i * 4 + 1];
      const z = data[i * 4 + 2] - originZ;

      dummy.position.set(x, y, z);
      // Randomize scale slightly
      const scale = 0.3 + Math.random() * 0.15;
      dummy.scale.setScalar(scale);

      // Random rotation
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.rotation.x = (Math.random() - 0.5) * 0.5;

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [data, count, dummy]);

  const mat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#00e5ff',
    emissive: '#00e5ff',
    emissiveIntensity: 2.0,
    roughness: 0.4,
    metalness: 0.1,
    toneMapped: false // Important for bloom
  }), []);

  return (
    <group>
      {/* Flora Mesh - Frustum Culling Disabled to fix visibility */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, count]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.25, 12, 12]} />
        <primitive object={mat} attach="material" />
      </instancedMesh>

      {/* Clustered Lights - Distance Culled */}
      {lights.map((pos, i) => (
        <DistanceCulledLight key={i} position={pos} />
      ))}
    </group>
  );
});

/**
 * Helper component to cull lights based on distance to camera.
 * React-Three-Fiber handles unmounting/mounting, but we want to toggle intensity/visibility
 * to avoid overhead. Actually, conditionally rendering the PointLight is better for Three.js
 * state management if we have many.
 */
const DistanceCulledLight: React.FC<{ position: THREE.Vector3 }> = ({ position }) => {
  // const ref = useRef<THREE.PointLight>(null); // Unused
  const [visible, setVisible] = useState(false);

  useFrame((state) => {
    // Check distance
    const distSq = state.camera.position.distanceToSquared(position);
    const MAX_DIST = 45; // Visible within 45 units
    const isNear = distSq < MAX_DIST * MAX_DIST;

    if (isNear !== visible) {
      setVisible(isNear);
    }
  });

  if (!visible) return null;

  return (
    <pointLight
      position={position}
      color="#00e5ff"
      intensity={2.0}
      distance={12}
      decay={2}
      castShadow={false} // No shadows for performance
    />
  );
};
