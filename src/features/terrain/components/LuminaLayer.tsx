import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { CHUNK_SIZE_XZ } from '@/constants';
import { frameProfiler } from '@core/utils/FrameProfiler';
import { PooledPointLight, type VirtualPointLight } from '@core/graphics/PointLightPool';
import { createLuminaPlantGeometry } from '@core/items/ItemGeometry';

interface LuminaLayerProps {
  data: Float32Array; // stride 4: x, y, z, type (type unused for now)
  lightPositions?: Float32Array; // stride 3: x, y, z
  cx: number;
  cz: number;
  collidersEnabled: boolean;
  simplified?: boolean;
}

// Shared materials for Lumina flora: glowing pods and plain dark stems.
let sharedPodMaterial: THREE.MeshStandardMaterial | null = null;
let sharedStemMaterial: THREE.MeshStandardMaterial | null = null;

const getLuminaMaterials = () => {
  if (!sharedPodMaterial) {
    sharedPodMaterial = new THREE.MeshStandardMaterial({
      color: '#c9f7ef',
      emissive: '#62e6d8',
      emissiveIntensity: 1.7,
      roughness: 0.35,
      metalness: 0.0,
      toneMapped: false, // pods bloom
    });
  }
  if (!sharedStemMaterial) {
    sharedStemMaterial = new THREE.MeshStandardMaterial({ color: '#2c3d31', roughness: 0.8, metalness: 0.0 });
  }
  return { pod: sharedPodMaterial, stem: sharedStemMaterial };
};

/**
 * Lightweight instanced renderer for cavern lumina flora.
 * - Disables frustum culling to fix visibility issues when chunk origin is off-screen.
 * - Adds clustered point lights that only activate when player is near.
 */
export const LuminaLayer: React.FC<LuminaLayerProps> = React.memo(({ data, lightPositions, cx, cz, collidersEnabled, simplified }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const stemRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const count = data.length / 4;
  const lastCullTime = useRef(0);
  const lightRefs = useRef<(VirtualPointLight | null)[]>([]);

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
    frameProfiler.begin('lumina-layer');
    // Throttled culling check (every ~200ms)
    const now = state.clock.getElapsedTime();
    if (now - lastCullTime.current < 0.2) {
      frameProfiler.end('lumina-layer');
      return;
    }
    lastCullTime.current = now;

    if (simplified || !collidersEnabled || lights.length === 0) {
      lightRefs.current.forEach(l => { if (l) l.visible = false; });
      frameProfiler.end('lumina-layer');
      return;
    }

    const MAX_DIST_SQ = 45 * 45;
    lights.forEach((lightPos, i) => {
      const light = lightRefs.current[i];
      if (light) {
        const isNear = state.camera.position.distanceToSquared(lightPos) < MAX_DIST_SQ;
        light.visible = isNear;
      }
    });
    frameProfiler.end('lumina-layer');
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
      // Plant base slightly below the placement point (it grows from the soil).
      dummy.position.set(wx - originX, wy - 0.04, wz - originZ);
      const scale = 0.85 + hash01(wx, wy, wz, 0) * 0.5;
      dummy.scale.setScalar(scale);
      dummy.rotation.set((hash01(wx, wy, wz, 2) - 0.5) * 0.25, hash01(wx, wy, wz, 1) * Math.PI * 2, 0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      stemRef.current?.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (stemRef.current) stemRef.current.instanceMatrix.needsUpdate = true;
  }, [data, count, dummy, cx, cz]);

  const mats = useMemo(() => getLuminaMaterials(), []);
  const plant = useMemo(() => createLuminaPlantGeometry(), []);

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[plant.pods, mats.pod, count]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      />
      <instancedMesh
        ref={stemRef}
        args={[plant.stems, mats.stem, count]}
        castShadow={false}
        receiveShadow={false}
        frustumCulled={false}
      />

      {lights.map((pos, i) => (
        <PooledPointLight
          key={i}
          ref={el => { lightRefs.current[i] = el; }}
          position={pos}
          color="#62e6d8"
          intensity={2.0}
          distance={12}
          decay={2}
          visible={false}
          castShadow={false}
        />
      ))}
    </group>
  );
});
