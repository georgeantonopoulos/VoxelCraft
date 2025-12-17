import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies, InstancedRigidBodyProps } from '@react-three/rapier';
import { RockVariant } from '@features/terrain/logic/GroundItemKinds';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';
import { STICK_SHADER, ROCK_SHADER } from '@core/graphics/GroundItemShaders';

type StickEntry = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  variant: number;
  seed: number;
};

type RockEntry = {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  variant: RockVariant;
  seed: number;
};

type LargeRockEntry = {
  x: number;
  y: number;
  z: number;
  radius: number;
  variant: RockVariant;
  seed: number;
};

const STICK_STRIDE = 8;
const ROCK_STRIDE = 8;
const LARGE_ROCK_STRIDE = 6;

const readStickEntries = (data: Float32Array | undefined): StickEntry[] => {
  if (!data || data.length === 0) return [];
  const out: StickEntry[] = [];
  for (let i = 0; i < data.length; i += STICK_STRIDE) {
    const y = data[i + 1];
    out.push({
      x: data[i + 0],
      y,
      z: data[i + 2],
      nx: data[i + 3],
      ny: data[i + 4],
      nz: data[i + 5],
      variant: data[i + 6],
      seed: data[i + 7]
    });
  }
  return out;
};

const readRockEntries = (data: Float32Array | undefined): RockEntry[] => {
  if (!data || data.length === 0) return [];
  const out: RockEntry[] = [];
  for (let i = 0; i < data.length; i += ROCK_STRIDE) {
    const y = data[i + 1];
    out.push({
      x: data[i + 0],
      y,
      z: data[i + 2],
      nx: data[i + 3],
      ny: data[i + 4],
      nz: data[i + 5],
      variant: data[i + 6] as RockVariant,
      seed: data[i + 7]
    });
  }
  return out;
};

const readLargeRockEntries = (data: Float32Array | undefined): LargeRockEntry[] => {
  if (!data || data.length === 0) return [];
  const out: LargeRockEntry[] = [];
  for (let i = 0; i < data.length; i += LARGE_ROCK_STRIDE) {
    out.push({
      x: data[i + 0],
      y: data[i + 1],
      z: data[i + 2],
      radius: data[i + 3],
      variant: data[i + 4] as RockVariant,
      seed: data[i + 5]
    });
  }
  return out;
};

const isHiddenY = (y: number): boolean => y < -9999;

const splitBy = <T,>(items: T[], getKey: (t: T) => number): Map<number, T[]> => {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const k = getKey(item);
    const arr = map.get(k);
    if (arr) arr.push(item);
    else map.set(k, [item]);
  }
  return map;
};

export const GroundItemsLayer: React.FC<{
  stickData?: Float32Array;
  rockData?: Float32Array;
  largeRockData?: Float32Array;
}> = React.memo(({ stickData, rockData, largeRockData }) => {
  const stickMeshDry = useRef<THREE.InstancedMesh>(null);
  const stickMeshJungle = useRef<THREE.InstancedMesh>(null);
  const rockMeshes = useRef<Map<RockVariant, THREE.InstancedMesh>>(new Map());

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpUp = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const tmpN = useMemo(() => new THREE.Vector3(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);

  const sticks = useMemo(() => readStickEntries(stickData), [stickData]);
  const rocks = useMemo(() => readRockEntries(rockData), [rockData]);
  const largeRocks = useMemo(() => readLargeRockEntries(largeRockData), [largeRockData]);

  const stickBatches = useMemo(() => splitBy(sticks, (s) => s.variant), [sticks]);
  const rockBatches = useMemo(() => splitBy(rocks, (r) => r.variant), [rocks]);
  const largeRockBatches = useMemo(() => splitBy(largeRocks, (r) => r.variant), [largeRocks]);

  // Geometries with more segments for displacement
  const stickGeometry = useMemo(() => new THREE.CylinderGeometry(1, 0.7, 1.0, 8, 4), []);
  const rockGeometry = useMemo(() => new THREE.DodecahedronGeometry(0.22, 1), []);
  const largeRockGeometry = useMemo(() => new THREE.IcosahedronGeometry(1.0, 2), []);


  const rockMats = useMemo(() => {
    const mk = (color: string, roughness: number) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.0 });
    return new Map<RockVariant, THREE.MeshStandardMaterial>([
      [RockVariant.MOUNTAIN, mk('#8c8c96', 0.92)],
      [RockVariant.CAVE, mk('#4b4b55', 0.96)],
      [RockVariant.BEACH, mk('#b89f7c', 0.85)],
      [RockVariant.MOSSY, mk('#5c7a3a', 0.93)]
    ]);
  }, []);

  const setStickMatrices = (mesh: THREE.InstancedMesh | null, batch: StickEntry[]) => {
    if (!mesh) return;
    for (let i = 0; i < batch.length; i++) {
      const s = batch[i];
      if (isHiddenY(s.y)) {
        dummy.position.set(0, -10000, 0);
        dummy.scale.setScalar(0);
        dummy.quaternion.identity();
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Align to ground normal, then lay the cylinder onto the ground.
      tmpN.set(s.nx, s.ny, s.nz);
      if (tmpN.lengthSq() < 1e-6) tmpN.set(0, 1, 0);
      tmpN.normalize();
      tmpQ.setFromUnitVectors(tmpUp, tmpN);

      const angle = (s.seed % 1) * Math.PI * 2;
      const length = 0.80 + (s.seed % 1) * 0.40;
      const radius = 0.035 + ((s.seed * 31.7) % 1) * 0.020;

      dummy.position.set(s.x, s.y + 0.10, s.z);
      dummy.quaternion.copy(tmpQ);
      dummy.rotateY(angle);
      dummy.rotateX(Math.PI * 0.5);
      dummy.scale.set(radius, length, radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  const setRockMatrices = (mesh: THREE.InstancedMesh | null, batch: RockEntry[]) => {
    if (!mesh) return;
    for (let i = 0; i < batch.length; i++) {
      const r = batch[i];
      if (isHiddenY(r.y)) {
        dummy.position.set(0, -10000, 0);
        dummy.scale.setScalar(0);
        dummy.quaternion.identity();
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      tmpN.set(r.nx, r.ny, r.nz);
      if (tmpN.lengthSq() < 1e-6) tmpN.set(0, 1, 0);
      tmpN.normalize();
      tmpQ.setFromUnitVectors(tmpUp, tmpN);

      const s01 = r.seed % 1;
      const scale = 0.85 + s01 * 0.80;

      dummy.position.set(r.x, r.y, r.z);
      dummy.quaternion.copy(tmpQ);
      dummy.rotateY(s01 * Math.PI * 2);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  useLayoutEffect(() => {
    const dry = stickBatches.get(0) ?? [];
    const jungle = stickBatches.get(1) ?? [];
    setStickMatrices(stickMeshDry.current, dry);
    setStickMatrices(stickMeshJungle.current, jungle);
  }, [stickBatches, tmpUp, tmpN, tmpQ, dummy]);

  useLayoutEffect(() => {
    for (const [variant, batch] of rockBatches.entries()) {
      const mesh = rockMeshes.current.get(variant as RockVariant) ?? null;
      setRockMatrices(mesh, batch as RockEntry[]);
    }
  }, [rockBatches, tmpUp, tmpN, tmpQ, dummy]);

  const largeRockInstanceGroups = useMemo(() => {
    const groups = new Map<RockVariant, InstancedRigidBodyProps[]>();
    for (const [variantKey, batch] of largeRockBatches.entries()) {
      const variant = variantKey as RockVariant;
      const instances: InstancedRigidBodyProps[] = [];
      for (let i = 0; i < batch.length; i++) {
        const r = batch[i] as LargeRockEntry;
        if (isHiddenY(r.y)) continue;
        const yaw = (r.seed % 1) * Math.PI * 2;
        instances.push({
          key: `large-rock-${variant}-${i}`,
          position: [r.x, r.y, r.z],
          rotation: [0, yaw, 0],
          scale: [r.radius, r.radius, r.radius],
          userData: { type: 'large_rock', variant }
        });
      }
      groups.set(variant, instances);
    }
    return groups;
  }, [largeRockBatches]);

  if (sticks.length === 0 && rocks.length === 0 && largeRocks.length === 0) return null;

  const drySticks = stickBatches.get(0) ?? [];
  const jungleSticks = stickBatches.get(1) ?? [];

  return (
    <group>
      {/* Sticks (pickups) */}
      {drySticks.length > 0 && (
        <instancedMesh
          ref={stickMeshDry}
          args={[stickGeometry, undefined, drySticks.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <CustomShaderMaterial
            baseMaterial={THREE.MeshStandardMaterial}
            vertexShader={STICK_SHADER.vertex}
            uniforms={{ uSeed: { value: 0 }, uHeight: { value: 1.0 } }}
            color="#8b5a2b"
            roughness={0.92}
            metalness={0.0}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </instancedMesh>
      )}
      {jungleSticks.length > 0 && (
        <instancedMesh
          ref={stickMeshJungle}
          args={[stickGeometry, undefined, jungleSticks.length]}
          castShadow
          receiveShadow
          frustumCulled={false}
        >
          <CustomShaderMaterial
            baseMaterial={THREE.MeshStandardMaterial}
            vertexShader={STICK_SHADER.vertex}
            uniforms={{ uSeed: { value: 42 }, uHeight: { value: 1.0 } }}
            color="#6a4a2a"
            roughness={0.95}
            metalness={0.0}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </instancedMesh>
      )}

      {/* Stones/Rocks (pickups) */}
      {([RockVariant.MOUNTAIN, RockVariant.CAVE, RockVariant.BEACH, RockVariant.MOSSY] as RockVariant[]).map((variant) => {
        const batch = rockBatches.get(variant) ?? [];
        const mat = rockMats.get(variant);
        if (!mat || batch.length === 0) return null;
        return (
          <instancedMesh
            key={`rocks-${variant}`}
            ref={(r) => {
              if (r) rockMeshes.current.set(variant, r);
            }}
            args={[rockGeometry, undefined, batch.length]}
            castShadow
            receiveShadow
            frustumCulled={false}
          >
            <CustomShaderMaterial
              baseMaterial={THREE.MeshStandardMaterial}
              vertexShader={ROCK_SHADER.vertex}
              uniforms={{
                uNoiseTexture: { value: noiseTexture },
                uSeed: { value: 0 }
              }}
              color={mat.color}
              roughness={mat.roughness}
              metalness={0.0}
              toneMapped={false}
            />
          </instancedMesh>
        );
      })}

      {/* Large rocks (non-pickup, collidable) */}
      {([RockVariant.MOUNTAIN, RockVariant.CAVE, RockVariant.BEACH, RockVariant.MOSSY] as RockVariant[]).map((variant) => {
        const instances = largeRockInstanceGroups.get(variant) ?? [];
        const mat = rockMats.get(variant);
        if (!mat || instances.length === 0) return null;
        return (
          <InstancedRigidBodies key={`large-rocks-${variant}`} instances={instances} type="fixed" colliders="ball">
            <instancedMesh args={[largeRockGeometry, undefined, instances.length]} castShadow receiveShadow frustumCulled={false}>
              <CustomShaderMaterial
                baseMaterial={THREE.MeshStandardMaterial}
                vertexShader={ROCK_SHADER.vertex}
                uniforms={{
                  uNoiseTexture: { value: noiseTexture },
                  uSeed: { value: 123 }
                }}
                color={mat.color}
                roughness={mat.roughness}
                metalness={0.0}
                toneMapped={false}
              />
            </instancedMesh>
          </InstancedRigidBodies>
        );
      })}
    </group>
  );
});
