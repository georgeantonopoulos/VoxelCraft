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

  // Track visibility of lights within this chunk to avoid 8 useFrame calls
  const [visibleLights, setVisibleLights] = useState<THREE.Vector3[]>([]);
  const lastCullTime = useRef(0);

  const lights = useMemo(() => {
    if (!lightPositions || lightPositions.length === 0) return [];
    const arr: THREE.Vector3[] = [];
    const MAX_LIGHTS_PER_CHUNK = 8;
    // AAA FIX: Use Stride 4 to match floraPositions/lightPositions logic from worker
    const stride = 4;
    const totalPossible = lightPositions.length / stride;
    const step = Math.max(1, Math.floor(totalPossible / MAX_LIGHTS_PER_CHUNK));

    for (let i = 0; i < lightPositions.length && arr.length < MAX_LIGHTS_PER_CHUNK; i += stride * step) {
      arr.push(new THREE.Vector3(lightPositions[i], lightPositions[i + 1], lightPositions[i + 2]));
    }
    return arr;
  }, [lightPositions]);

  useFrame((state) => {
    // Throttled culling check (every ~200ms)
    const now = state.clock.getElapsedTime();
    if (now - lastCullTime.current < 0.2) return;
    lastCullTime.current = now;

    if (simplified || !collidersEnabled || lights.length === 0) {
      if (visibleLights.length > 0) setVisibleLights([]);
      return;
    }

    const near: THREE.Vector3[] = [];
    const MAX_DIST_SQ = 45 * 45;
    for (const light of lights) {
      if (state.camera.position.distanceToSquared(light) < MAX_DIST_SQ) {
        near.push(light);
      }
    }

    // Only update state if set of visible lights changed (shallow comparison)
    if (near.length !== visibleLights.length || near.some((v, i) => v !== visibleLights[i])) {
      setVisibleLights(near);
    }
  });

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
      dummy.position.set(wx - originX, wy, wz - originZ);
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

      {visibleLights.map((pos, i) => (
        <pointLight
          key={i}
          position={pos}
          color="#00e5ff"
          intensity={2.0}
          distance={12}
          decay={2}
          castShadow={false}
        />
      ))}
    </group>
  );
});
