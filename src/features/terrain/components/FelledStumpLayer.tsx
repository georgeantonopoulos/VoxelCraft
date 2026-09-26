import React, { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider } from '@react-three/rapier';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { getFelledStumpGeometry, felledStumpCollider } from '@features/flora/trees/felledStump';
import { getTreeBarkMaterial } from './TreeLayer';
import { getRingTexture } from '@features/building/components/Log';

/**
 * Stumps of felled trees in a chunk (chunk-local, stride 5 like treePositions).
 * Same placement as the tree it replaces (TreeLayer's yaw from the position
 * seed, the tree's scale), so the stump sits exactly where the trunk stood.
 */

let cutMaterial: THREE.MeshStandardMaterial | null = null;
const getCutMaterial = () => (cutMaterial ??= new THREE.MeshStandardMaterial({ map: getRingTexture(), color: '#a89880', roughness: 0.95, metalness: 0 }));

const StumpsOfType: React.FC<{ type: TreeType; items: number[][]; collidersEnabled: boolean }> = ({ type, items, collidersEnabled }) => {
  const barkRef = useRef<THREE.InstancedMesh>(null);
  const cutRef = useRef<THREE.InstancedMesh>(null);
  const geo = useMemo(() => getFelledStumpGeometry(type), [type]);
  const bark = useMemo(() => getTreeBarkMaterial(type), [type]);
  const collider = useMemo(() => felledStumpCollider(type), [type]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach(([x, y, z, , scale], i) => {
      // TreeLayer's yaw: (seed % 1) * 2PI with seed = x * 12.9898 + z * 78.233.
      const seed = x * 12.9898 + z * 78.233;
      q.setFromAxisAngle(up, (seed % 1) * Math.PI * 2);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
      barkRef.current?.setMatrixAt(i, m);
      cutRef.current?.setMatrixAt(i, m);
    });
    for (const r of [barkRef.current, cutRef.current]) {
      if (!r) continue;
      r.instanceMatrix.needsUpdate = true;
      r.computeBoundingSphere();
    }
  }, [items]);

  return (
    <>
      <instancedMesh ref={barkRef} args={[geo.bark, bark, items.length]} castShadow receiveShadow />
      <instancedMesh ref={cutRef} args={[geo.cut, getCutMaterial(), items.length]} receiveShadow />
      {collidersEnabled && items.map(([x, y, z, , scale], i) => (
        <RigidBody key={i} type="fixed" colliders={false} position={[x, y + (collider.height * scale) / 2, z]} userData={{ type: 'stump' }}>
          <CylinderCollider args={[(collider.height * scale) / 2, collider.radius * scale]} />
        </RigidBody>
      ))}
    </>
  );
};

export const FelledStumpLayer: React.FC<{ data: Float32Array; collidersEnabled: boolean }> = React.memo(({ data, collidersEnabled }) => {
  const byType = useMemo(() => {
    const map = new Map<TreeType, number[][]>();
    for (let i = 0; i + 4 < data.length; i += 5) {
      const type = data[i + 3] as TreeType;
      if (type === TreeType.CACTUS) continue; // a cactus leaves nothing standing
      const list = map.get(type) ?? [];
      list.push([data[i], data[i + 1], data[i + 2], type, data[i + 4]]);
      map.set(type, list);
    }
    return [...map.entries()];
  }, [data]);
  return (
    <>
      {byType.map(([type, items]) => (
        // Keyed by count: an instanced mesh cannot grow after creation.
        <StumpsOfType key={`${type}:${items.length}`} type={type} items={items} collidersEnabled={collidersEnabled} />
      ))}
    </>
  );
});
