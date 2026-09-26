import { forwardRef, useMemo } from 'react';
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
// Moss-grey linen: a brown sleeve with ring bindings read as a cut log beside the tool.
const cloth = new THREE.MeshStandardMaterial({ color: '#5a6150', roughness: 0.97, metalness: 0 });
const cuffCloth = new THREE.MeshStandardMaterial({ color: '#6c7360', roughness: 0.95, metalness: 0 });

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
    // Skin shows only at the wrist; the sleeve covers the rest of the forearm.
    const arm = new THREE.CylinderGeometry(0.031, 0.036, 0.2, 16, 1, true);
    arm.translate(0, 0.1, 0);
    const sleeve = new THREE.CylinderGeometry(0.047, 0.062, 0.86, 18, 3, true);
    sleeve.translate(0, 0.57, 0);
    // Soft rolled cuff where the sleeve ends.
    const cuff = new THREE.TorusGeometry(0.046, 0.012, 8, 20);
    cuff.rotateX(Math.PI / 2);
    cuff.translate(0, 0.15, 0);
    return { arm, sleeve, cuff };
  }, []);
  return (
    <group ref={ref}>
      <mesh geometry={parts.arm} material={skin} castShadow />
      <mesh geometry={parts.sleeve} material={cloth} castShadow />
      <mesh geometry={parts.cuff} material={cuffCloth} />
    </group>
  );
});
