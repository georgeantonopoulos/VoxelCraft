import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TorchFlame } from './TorchFlame';

/**
 * A Keeper's torch: a tapered wooden handle, a head of resin-soaked fibre
 * wrapped under rope bindings, a charred crown whose embers breathe with the
 * flame, and the flame itself anchored on the tip (it used to float beside
 * it whenever the torch tilted). Shared by the held and the placed torch.
 * The handle's bottom is at y = 0; the flame sits at `height`.
 */

const handleMat = new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 0.95, metalness: 0 });
const wrapMat = new THREE.MeshStandardMaterial({ color: '#34261a', roughness: 0.98, metalness: 0 });
const ropeMat = new THREE.MeshStandardMaterial({ color: '#6b5a44', roughness: 0.92, metalness: 0 });
const emberMat = new THREE.MeshStandardMaterial({
  color: '#1c130d', roughness: 0.8, emissive: new THREE.Color('#ff6a1f'), emissiveIntensity: 1.2, toneMapped: false,
});

export const TORCH_HEAD = 0.13;

export const TorchModel: React.FC<{ length: number; flameScale?: number }> = ({ length, flameScale = 1 }) => {
  const g = useMemo(() => {
    const handle = new THREE.CylinderGeometry(0.03, 0.037, length, 10);
    handle.translate(0, length / 2, 0);
    const wrap = new THREE.CylinderGeometry(0.05, 0.044, TORCH_HEAD, 12, 3);
    // Lumpy wrap: nudge rings in and out a little.
    const pos = wrap.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const k = 1 + 0.08 * Math.sin(a * 5 + pos.getY(i) * 60) ;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
    wrap.computeVertexNormals();
    wrap.translate(0, length + TORCH_HEAD / 2, 0);
    const rope = [0.2, 0.55, 0.9].map((f) => {
      const r = new THREE.TorusGeometry(0.052, 0.006, 6, 20);
      r.rotateX(Math.PI / 2);
      r.translate(0, length + TORCH_HEAD * f, 0);
      return r;
    });
    const crown = new THREE.CylinderGeometry(0.036, 0.05, 0.03, 12);
    crown.translate(0, length + TORCH_HEAD + 0.012, 0);
    return { handle, wrap, rope, crown };
  }, [length]);

  const t0 = useRef(Math.random() * 10);
  useFrame((state) => {
    const t = state.clock.elapsedTime + t0.current;
    emberMat.emissiveIntensity = 1.0 + 0.35 * Math.sin(t * 9.1) + 0.2 * Math.sin(t * 17.3);
  });

  return (
    <group>
      <mesh geometry={g.handle} material={handleMat} castShadow receiveShadow />
      <mesh geometry={g.wrap} material={wrapMat} castShadow receiveShadow />
      {g.rope.map((r, i) => <mesh key={i} geometry={r} material={ropeMat} />)}
      <mesh geometry={g.crown} material={emberMat} />
      <TorchFlame position={[0, length + TORCH_HEAD + 0.02, 0]} scale={flameScale} anchor="base" />
    </group>
  );
};
