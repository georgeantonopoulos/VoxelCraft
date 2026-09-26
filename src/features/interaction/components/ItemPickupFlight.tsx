import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { ItemType, CustomTool } from '@/types';
import { UniversalTool } from './UniversalTool';

/**
 * A picked-up item on its way to the hotbar: the real item mesh (the same
 * one the player saw lying there) lifts off the ground, turns, then arcs down
 * toward the bottom of the view and shrinks away, as if tucked into a pouch.
 * Replaces a generic cylinder/octahedron that flew at the camera.
 */

const LIFT_S = 0.2;
const FLY_S = 0.42;
const LIFT_M = 0.28;

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeInOut = (t: number) => t * t * (3 - 2 * t);

export const ItemPickupFlight: React.FC<{
  start: THREE.Vector3;
  item: ItemType | CustomTool;
  onDone: () => void;
}> = ({ start, item, onDone }) => {
  const { camera } = useThree();
  const ref = useRef<THREE.Group>(null);
  const age = useRef(0);
  const done = useRef(false);
  const s = useMemo(() => ({
    lifted: start.clone().add(new THREE.Vector3(0, LIFT_M, 0)),
    target: new THREE.Vector3(),
    fwd: new THREE.Vector3(),
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    mid: new THREE.Vector3(),
    p: new THREE.Vector3(),
    spin: Math.random() * Math.PI * 2,
  }), [start]);

  useFrame((_st, delta) => {
    const g = ref.current;
    if (!g || done.current) return;
    age.current += Math.min(delta, 0.05);
    const a = age.current;

    if (a < LIFT_S) {
      const u = easeOut(a / LIFT_S);
      g.position.lerpVectors(start, s.lifted, u);
      g.rotation.set(0, s.spin + u * 0.8, 0);
      g.scale.setScalar(1);
      return;
    }

    // Aim just under the view, toward the hotbar, a little right of centre.
    camera.getWorldDirection(s.fwd);
    s.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    s.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    s.target.copy(camera.position)
      .addScaledVector(s.fwd, 0.55)
      .addScaledVector(s.up, -0.42)
      .addScaledVector(s.right, 0.08);

    const u = Math.min(1, (a - LIFT_S) / FLY_S);
    const e = easeInOut(u);
    // Quadratic arc: up and over before dropping toward the target.
    s.mid.lerpVectors(s.lifted, s.target, 0.5).y += 0.25;
    s.p.copy(s.lifted).multiplyScalar((1 - e) * (1 - e))
      .addScaledVector(s.mid, 2 * e * (1 - e))
      .addScaledVector(s.target, e * e);
    g.position.copy(s.p);
    g.rotation.set(e * 0.6, s.spin + 0.8 + e * 2.4, 0);
    g.scale.setScalar(1 - 0.7 * e);

    if (u >= 1) {
      done.current = true;
      g.visible = false;
      onDone();
    }
  });

  // Torches and flora-bound tools carry raw point lights in their full
  // versions; mounting one would change the light count and recompile every
  // lit shader, so they fly as their light-free versions.
  const lightFree = item === ItemType.TORCH
    || (typeof item === 'object' && Object.values(item.attachments).includes(ItemType.FLORA));

  return (
    <group ref={ref} position={start}>
      <UniversalTool item={item} isThumbnail={lightFree} />
    </group>
  );
};
