import React, { forwardRef, useMemo } from 'react';
import * as THREE from 'three';

/**
 * The Keeper's right hand and forearm, in camera space.
 *
 * Local frame of the fist: +Y runs along the handle it grips, +Z points from
 * the handle toward the wrist. Fingers are four curled segments wrapping the
 * handle, the thumb lies across them, the back of the hand and wrist sit on
 * the +Z side. The forearm (a separate mesh, placed by FirstPersonTools) runs
 * from the wrist to an elbow below the view, wrapped in a cloth sleeve.
 */

const skin = new THREE.MeshStandardMaterial({ color: '#a97f62', roughness: 0.72, metalness: 0 });
const knuckle = new THREE.MeshStandardMaterial({ color: '#b38a6c', roughness: 0.65, metalness: 0 });
const cloth = new THREE.MeshStandardMaterial({ color: '#4f4134', roughness: 0.95, metalness: 0 });
const binding = new THREE.MeshStandardMaterial({ color: '#6b5a44', roughness: 0.9, metalness: 0 });

const HANDLE_R = 0.034; // hand units: the fist's inner radius around a handle

export const KeeperFist = forwardRef<THREE.Group>(function KeeperFist(_props, ref) {
  const parts = useMemo(() => {
    // One curled finger: a torus arc wrapping the handle, starting at the
    // knuckle on the +X side and ending with the fingertip tucked in.
    const fingers: { geo: THREE.BufferGeometry; y: number; r: number }[] = [];
    const specs = [
      { y: 0.03, r: 0.0105 },  // index
      { y: 0.009, r: 0.011 },  // middle
      { y: -0.012, r: 0.0105 }, // ring
      { y: -0.031, r: 0.0092 }, // little
    ];
    for (const s of specs) {
      const g = new THREE.TorusGeometry(HANDLE_R + s.r, s.r, 8, 14, Math.PI * 1.35);
      // Torus lies in XY around Z: turn it to wrap around the Y (handle) axis.
      g.rotateX(Math.PI / 2);
      g.rotateY(-Math.PI * 0.25);
      fingers.push({ geo: g, y: s.y, r: s.r });
    }
    // Back of the hand / palm: a flattened rounded block on the wrist side.
    const palm = new THREE.SphereGeometry(1, 16, 12);
    palm.scale(0.03, 0.05, 0.034);
    palm.translate(0, -0.002, HANDLE_R + 0.022);
    // Thumb: a short capsule across the front of the curled fingers.
    const thumb = new THREE.CapsuleGeometry(0.0115, 0.045, 4, 10);
    thumb.rotateZ(Math.PI * 0.5 - 0.35);
    thumb.translate(0.022, 0.045, 0.02);
    // Wrist stub leading into the forearm.
    const wrist = new THREE.CylinderGeometry(0.03, 0.032, 0.05, 14);
    wrist.rotateX(Math.PI / 2);
    wrist.translate(0, -0.006, HANDLE_R + 0.058);
    return { fingers, palm, thumb, wrist };
  }, []);

  return (
    <group ref={ref}>
      {parts.fingers.map((f, i) => (
        <mesh key={i} geometry={f.geo} material={i === 0 ? knuckle : skin} position={[0, f.y, 0]} castShadow />
      ))}
      <mesh geometry={parts.palm} material={skin} castShadow />
      <mesh geometry={parts.thumb} material={knuckle} castShadow />
      <mesh geometry={parts.wrist} material={skin} castShadow />
    </group>
  );
});

/** Forearm from wrist (y = 0) to elbow (y = 1) in a unit frame; scaled/placed per frame. */
export const KeeperForearm = forwardRef<THREE.Group>(function KeeperForearm(_props, ref) {
  const parts = useMemo(() => {
    const arm = new THREE.CylinderGeometry(0.034, 0.048, 1, 16, 1, true);
    arm.translate(0, 0.5, 0);
    // A wrapped cloth sleeve from a little above the wrist, with two bindings.
    const sleeve = new THREE.CylinderGeometry(0.041, 0.056, 0.82, 16, 1, true);
    sleeve.translate(0, 0.59, 0);
    const b1 = new THREE.TorusGeometry(0.043, 0.006, 6, 18);
    b1.rotateX(Math.PI / 2);
    b1.translate(0, 0.2, 0);
    const b2 = b1.clone();
    b2.translate(0, 0.14, 0);
    return { arm, sleeve, b1, b2 };
  }, []);
  return (
    <group ref={ref}>
      <mesh geometry={parts.arm} material={skin} castShadow />
      <mesh geometry={parts.sleeve} material={cloth} castShadow />
      <mesh geometry={parts.b1} material={binding} />
      <mesh geometry={parts.b2} material={binding} />
    </group>
  );
});
