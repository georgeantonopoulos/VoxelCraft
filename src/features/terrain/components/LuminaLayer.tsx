import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CHUNK_SIZE_XZ } from '@/constants';

interface LuminaLayerProps {
  data: Float32Array; // stride 4: x, y, z, type (type unused for now)
  lightPositions?: Float32Array; // stride 3: x, y, z
  cx: number;
  cz: number;
  collidersEnabled: boolean;
  simplified?: boolean;
}

// Shared material pool for Lumina flora
let sharedLuminaMaterial: THREE.MeshStandardMaterial | null = null;

const getSharedLuminaMaterial = () => {
  if (sharedLuminaMaterial) return sharedLuminaMaterial;
  sharedLuminaMaterial = new THREE.MeshStandardMaterial({
    color: '#00e5ff',
    emissive: '#00e5ff',
    emissiveIntensity: 2.0,
    roughness: 0.4,
    metalness: 0.1,
    toneMapped: false // Important for bloom
  });
  return sharedLuminaMaterial;
};

/**
 * Lightweight instanced renderer for cavern lumina flora.
 * - Disables frustum culling to fix visibility issues when chunk origin is off-screen.
 * - Adds clustered point lights that only activate when player is near.
 */
export const LuminaLayer: React.FC<LuminaLayerProps> = React.memo(({ data, lightPositions, cx, cz, collidersEnabled, simplified }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const count = data.length / 4;

  const lights = useMemo(() => {
    if (!lightPositions) return [];
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < lightPositions.length; i += 3) {
      arr.push(new THREE.Vector3(lightPositions[i], lightPositions[i + 1], lightPositions[i + 2]));
    }
    return arr;
  }, [lightPositions]);

  useLayoutEffect(() => {
    if (!meshRef.current) return;

    const originX = cx * CHUNK_SIZE_XZ;
    const originZ = cz * CHUNK_SIZE_XZ;

    const hash01 = (x: number, y: number, z: number, salt: number) => {
      const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 19.19) * 43758.5453;
      return s - Math.floor(s);
    };

    for (let i = 0; i < count; i++) {
      const wx = data[i * 4];
      const wy = data[i * 4 + 1];
      const wz = data[i * 4 + 2];
      const x = wx - originX;
      const y = wy;
      const z = wz - originZ;

      dummy.position.set(x, y, z);
      const scale = 0.3 + hash01(wx, wy, wz, 0) * 0.15;
      dummy.scale.setScalar(scale);

      dummy.rotation.y = hash01(wx, wy, wz, 1) * Math.PI * 2;
      dummy.rotation.x = (hash01(wx, wy, wz, 2) - 0.5) * 0.5;

      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [data, count, dummy, cx, cz]);

  const mat = useMemo(() => getSharedLuminaMaterial(), []);

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, mat, count]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.25, simplified ? 6 : 12, simplified ? 6 : 12]} />
      </instancedMesh>

      {!simplified && collidersEnabled && lights.map((pos, i) => (
        <DistanceCulledLight key={i} position={pos} intensityMul={1.0} />
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
const DistanceCulledLight: React.FC<{ position: THREE.Vector3; intensityMul: number }> = ({ position, intensityMul }) => {
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
      intensity={2.0 * intensityMul}
      distance={12}
      decay={2}
      castShadow={false} // No shadows for performance
    />
  );
};
