import React, { useMemo, useRef, useLayoutEffect, useEffect } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies, InstancedRigidBodyProps } from '@react-three/rapier';
import { RockVariant } from '@features/terrain/logic/GroundItemKinds';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { noiseTexture } from '@core/memory/sharedResources';
import { STICK_SHADER, ROCK_SHADER } from '@core/graphics/GroundItemShaders';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

// Material pool for ground items (sticks, rocks)
const groundItemMaterialPool: Record<string, THREE.Material> = {};

const getGroundItemMaterial = (shader: any, color: string, roughness: number, isInstanced: boolean) => {
  const key = `${shader === STICK_SHADER ? 'stick' : 'rock'}-${color}-${roughness}-${isInstanced}`;
  if (groundItemMaterialPool[key]) return groundItemMaterialPool[key];

  groundItemMaterialPool[key] = new (CustomShaderMaterial as any)({
    baseMaterial: THREE.MeshStandardMaterial,
    vertexShader: shader.vertex,
    uniforms: {
      ...sharedUniforms,
      uInstancing: { value: isInstanced },
      uSeed: { value: 0 },
      uHeight: { value: 1.0 },
      uNoiseTexture: { value: noiseTexture }
    },
    color: color,
    roughness: roughness,
    metalness: 0.0,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  return groundItemMaterialPool[key];
};

const LARGE_ROCK_STRIDE = 6; // x, y, z, radius, variant, seed

const isHiddenY = (y: number): boolean => y < -9999;

export const GroundItemsLayer: React.FC<{
  drySticks?: Float32Array;
  jungleSticks?: Float32Array;
  rockDataBuckets?: Record<number, Float32Array>;
  largeRockData?: Float32Array;
  collidersEnabled: boolean;
}> = React.memo(({ drySticks, jungleSticks, rockDataBuckets, largeRockData, collidersEnabled }) => {
  // 1. Large Rocks (still need InstancedRigidBodies, so we must make the objects)
  const largeRockInstanceGroups = useMemo(() => {
    if (!largeRockData) return new Map<RockVariant, InstancedRigidBodyProps[]>();
    const groups = new Map<RockVariant, InstancedRigidBodyProps[]>();
    for (let i = 0; i < largeRockData.length; i += LARGE_ROCK_STRIDE) {
      const y = largeRockData[i + 1];
      if (isHiddenY(y)) continue;
      const variant = largeRockData[i + 4] as RockVariant;
      if (!groups.has(variant)) groups.set(variant, []);
      const target = groups.get(variant)!;

      const x = largeRockData[i + 0];
      const z = largeRockData[i + 2];
      const radius = largeRockData[i + 3];
      const seed = largeRockData[i + 5];
      const yaw = (seed % 1) * Math.PI * 2;

      target.push({
        key: `large-rock-${variant}-${i}`,
        position: [x, y, z],
        rotation: [0, yaw, 0],
        scale: [radius, radius, radius],
        userData: { type: 'large_rock', variant }
      });
    }
    return groups;
  }, [largeRockData]);

  // Shared Geometries
  const stickGeometry = useMemo(() => new THREE.CylinderGeometry(1, 0.7, 1.0, 8, 4), []);
  const rockGeometry = useMemo(() => new THREE.DodecahedronGeometry(0.22, 1), []);
  const largeRockGeometry = useMemo(() => new THREE.IcosahedronGeometry(1.0, 2), []);

  const rockMats = useMemo(() => {
    const mk = (color: string, roughness: number) => ({ color, roughness });
    return new Map<RockVariant, { color: string, roughness: number }>([
      [RockVariant.MOUNTAIN, mk('#8c8c96', 0.92)],
      [RockVariant.CAVE, mk('#4b4b55', 0.96)],
      [RockVariant.BEACH, mk('#b89f7c', 0.85)],
      [RockVariant.MOSSY, mk('#5c7a3a', 0.93)]
    ]);
  }, []);

  return (
    <group>
      {drySticks && drySticks.length > 0 && (
        <GroundItemBatch geometry={stickGeometry} data={drySticks} color="#8b5a2b" shader={STICK_SHADER} />
      )}
      {jungleSticks && jungleSticks.length > 0 && (
        <GroundItemBatch geometry={stickGeometry} data={jungleSticks} color="#6a4a2a" shader={STICK_SHADER} />
      )}

      {rockDataBuckets && Object.entries(rockDataBuckets).map(([vStr, data]) => {
        const variant = parseInt(vStr) as RockVariant;
        const config = rockMats.get(variant);
        if (!config || !data || data.length === 0) return null;
        return (
          <GroundItemBatch
            key={`rocks-${variant}`}
            geometry={rockGeometry}
            data={data}
            color={config.color}
            roughness={config.roughness}
            shader={ROCK_SHADER}
          />
        );
      })}

      {collidersEnabled && Array.from(largeRockInstanceGroups.entries()).map(([variant, instances]) => {
        const config = rockMats.get(variant);
        if (!config) return null;
        const material = getGroundItemMaterial(ROCK_SHADER, config.color, config.roughness, false);
        return (
          <InstancedRigidBodies key={`large-rocks-${variant}`} instances={instances} type="fixed" colliders="ball">
            <instancedMesh
              args={[largeRockGeometry, material, instances.length]}
              castShadow
              receiveShadow
              frustumCulled={true}
              material={material}
            />
          </InstancedRigidBodies>
        );
      })}
    </group>
  );
});

const GroundItemBatch: React.FC<{
  geometry: THREE.BufferGeometry;
  data: Float32Array;
  color: string;
  roughness?: number;
  shader: any;
}> = ({ geometry, data, color, roughness = 0.9, shader }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = data.length / 7;

  const instGeo = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry();
    g.index = geometry.index;
    g.attributes.position = geometry.attributes.position;
    g.attributes.normal = geometry.attributes.normal;
    g.attributes.uv = geometry.attributes.uv;

    // Conservative bounding box for chunks (32x32XZ, -40 to 40Y)
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(-2, -40, -2),
      new THREE.Vector3(34, 40, 34)
    );
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(16, 0, 16), 45);
    return g;
  }, [geometry]);

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const interleaved = new THREE.InstancedInterleavedBuffer(data, 7);
    instGeo.setAttribute('aInstancePos', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
    instGeo.setAttribute('aInstanceNormal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3));
    instGeo.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(interleaved, 1, 6));

    // Ensure the mesh knows the count has changed if it's already mounted
    if (meshRef.current) {
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [data, instGeo]);

  useEffect(() => {
    return () => {
      instGeo.dispose();
    };
  }, [instGeo]);

  const material = useMemo(() => getGroundItemMaterial(shader, color, roughness, true), [shader, color, roughness]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[instGeo, material, count]}
      castShadow
      receiveShadow
      frustumCulled={true}
      material={material}
    />
  );
};
