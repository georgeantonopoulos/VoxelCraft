import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useLogStore, PLANK_THICKNESS, type LogData } from '@/state/LogStore';
import { emitImpact } from '@features/interaction/components/ImpactFX';

/**
 * Placing a carried log. A ghost shows where it will go, softly green when it
 * fits and red when it does not. Two ways to set a log (wheel or R toggles):
 * - upright: a post, sunk a little into the ground or stood on another post;
 * - lying: across the view on the ground, or stacked on a lying log below it
 *   (same line and direction), so walls go up course by course.
 * Right click places it (InteractionHandler sends vc-log-place-request).
 */

const REACH = 4.5;
const SINK = 0.12;

type Mode = 'upright' | 'lying';

interface Placement { position: THREE.Vector3; rotation: THREE.Quaternion; valid: boolean }

const UP = new THREE.Vector3(0, 1, 0);

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: '#9dbd62', transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false,
  emissive: new THREE.Color('#9dbd62'), emissiveIntensity: 0.25,
});

export const BuildPreview: React.FC = () => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const carried = useLogStore((s) => (s.carriedId ? s.logs[s.carriedId] : null));
  const [mode, setMode] = useState<Mode>('upright');
  const modeRef = useRef<Mode>('upright');
  modeRef.current = mode;
  const ghost = useRef<THREE.Group>(null);
  const placement = useRef<Placement | null>(null);
  const tmp = useMemo(() => ({ dir: new THREE.Vector3(), flat: new THREE.Vector3(), q: new THREE.Quaternion(), axis: new THREE.Vector3() }), []);

  // Wheel or R switches between upright and lying while a log is carried.
  useEffect(() => {
    const toggle = () => setMode((m) => (m === 'upright' ? 'lying' : 'upright'));
    const onKey = (e: KeyboardEvent) => { if (e.code === 'KeyR' && useLogStore.getState().carriedId) toggle(); };
    window.addEventListener('vc-build-rotate', toggle);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('vc-build-rotate', toggle); window.removeEventListener('keydown', onKey); };
  }, []);

  // Place on request.
  useEffect(() => {
    const onPlace = () => {
      const logs = useLogStore.getState();
      const id = logs.carriedId;
      const p = placement.current;
      if (!id || !p || !p.valid) {
        window.dispatchEvent(new CustomEvent('vc-audio-play', { detail: { soundId: 'wood_hit', options: { pitch: 1.6, volume: 0.25 } } }));
        return;
      }
      logs.updateLog(id, {
        state: 'placed',
        position: [p.position.x, p.position.y, p.position.z],
        rotation: [p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w],
      });
      logs.setCarried(null);
      const base = p.position.clone();
      emitImpact({ position: base, direction: UP, kind: 'earth', color: '#6b5236', strength: 0.6, floorY: base.y - 1 });
      window.dispatchEvent(new CustomEvent('vc-audio-play', { detail: { soundId: 'wood_hit', options: { pitch: 0.55, volume: 0.9 } } }));
    };
    window.addEventListener('vc-log-place-request', onPlace);
    return () => window.removeEventListener('vc-log-place-request', onPlace);
  }, []);

  useFrame(() => {
    const g = ghost.current;
    if (!g) return;
    if (!carried) { g.visible = false; placement.current = null; return; }
    camera.getWorldDirection(tmp.dir);
    const origin = camera.position;
    const hit = world.castRayAndGetNormal(new rapier.Ray(origin, tmp.dir), REACH, true, undefined, undefined, undefined, undefined,
      (c: { parent: () => { userData?: unknown } | null }) => {
        const ud = c.parent()?.userData as { type?: string; id?: string } | undefined;
        if (ud?.type === 'terrain') return true;
        return ud?.type === 'log' && useLogStore.getState().logs[ud.id ?? '']?.state === 'placed';
      });
    if (!hit) { g.visible = false; placement.current = null; return; }
    const point = new THREE.Vector3().copy(origin).addScaledVector(tmp.dir, hit.timeOfImpact);
    const ud = hit.collider.parent()?.userData as { type?: string; id?: string } | undefined;
    const target: LogData | undefined = ud?.type === 'log' ? useLogStore.getState().logs[ud.id ?? ''] : undefined;
    const len = carried.length, r = carried.radius;

    // Lying logs lie across the view.
    tmp.flat.set(tmp.dir.x, 0, tmp.dir.z);
    if (tmp.flat.lengthSq() < 1e-6) tmp.flat.set(0, 0, -1);
    tmp.flat.normalize();
    const across = new THREE.Vector3(-tmp.flat.z, 0, tmp.flat.x);
    const lyingQ = new THREE.Quaternion().setFromUnitVectors(UP, across);
    const uprightQ = new THREE.Quaternion();

    let pos = new THREE.Vector3();
    let rot = uprightQ;
    let valid = true;
    const m = modeRef.current;

    if (carried.kind === 'plank') {
      // Planks always lie flat, length across the view (floors, benches, roofs).
      const flatQ = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(across, UP), across, UP));
      rot = flatQ;
      const half = PLANK_THICKNESS / 2;
      if (target?.kind === 'plank') {
        // Lay the next board beside the one aimed at (same direction).
        tmp.q.set(target.rotation[0], target.rotation[1], target.rotation[2], target.rotation[3]);
        const widthDir = new THREE.Vector3(1, 0, 0).applyQuaternion(tmp.q);
        const tPos = new THREE.Vector3(...target.position);
        const k = point.clone().sub(tPos).dot(widthDir) >= 0 ? 1 : -1;
        pos = tPos.clone().addScaledVector(widthDir, k * (target.radius + carried.radius + 0.01));
        rot = tmp.q.clone();
      } else if (target) {
        tmp.q.set(target.rotation[0], target.rotation[1], target.rotation[2], target.rotation[3]);
        tmp.axis.copy(UP).applyQuaternion(tmp.q);
        const tPos = new THREE.Vector3(...target.position);
        const top = Math.abs(tmp.axis.y) > 0.8 ? tPos.y + target.length / 2 : tPos.y + target.radius;
        pos = new THREE.Vector3(point.x, top + half, point.z);
      } else {
        pos = point.clone().addScaledVector(UP, half);
        valid = hit.normal.y > 0.6;
      }
    } else if (target) {
      tmp.q.set(target.rotation[0], target.rotation[1], target.rotation[2], target.rotation[3]);
      tmp.axis.copy(UP).applyQuaternion(tmp.q);
      const tPos = new THREE.Vector3(...target.position);
      const targetUpright = Math.abs(tmp.axis.y) > 0.8;
      if (targetUpright) {
        const top = tPos.clone().addScaledVector(tmp.axis, (tmp.axis.y > 0 ? 1 : -1) * target.length / 2);
        if (m === 'upright') { pos = top.clone().addScaledVector(UP, len / 2); rot = uprightQ; }
        else { pos = top.clone().addScaledVector(UP, r); rot = lyingQ; }
      } else if (m === 'lying') {
        // Stack on the course below: same line, same direction.
        pos = tPos.clone().addScaledVector(UP, target.radius + r * 0.95);
        rot = tmp.q.clone();
      } else {
        pos = new THREE.Vector3(point.x, tPos.y + target.radius + len / 2, point.z);
        rot = uprightQ;
      }
    } else {
      const flatGround = hit.normal.y > 0.6;
      if (m === 'upright') {
        pos = point.clone().addScaledVector(UP, len / 2 - SINK);
        valid = flatGround;
      } else {
        pos = point.clone().addScaledVector(UP, r * 0.85);
        rot = lyingQ;
        valid = hit.normal.y > 0.45;
      }
    }

    placement.current = { position: pos, rotation: rot, valid };
    g.visible = true;
    g.position.copy(pos);
    g.quaternion.copy(rot);
    ghostMaterial.color.set(valid ? '#9dbd62' : '#b4745f');
    ghostMaterial.emissive.set(valid ? '#9dbd62' : '#b4745f');
  });

  const geo = useMemo(() => (!carried ? null
    : carried.kind === 'plank' ? new THREE.BoxGeometry(carried.radius * 2, carried.length, PLANK_THICKNESS)
    : new THREE.CylinderGeometry(carried.radius * 0.95, carried.radius, carried.length, 14)), [carried?.id, carried?.length, carried?.radius, carried?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { geo?.dispose(); }, [geo]);

  return (
    <group ref={ghost} visible={false}>
      {geo && <mesh geometry={geo} material={ghostMaterial} renderOrder={3} />}
    </group>
  );
};
