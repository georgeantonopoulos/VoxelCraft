import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useLogStore, lastPlaced, PLANK_THICKNESS, ROOF_THICKNESS, DOOR_THICKNESS, type LogData } from '@/state/LogStore';
import { emitImpact } from '@features/interaction/components/ImpactFX';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { computePlacement, type Placement } from '../logic/buildSnap';
import type { Bench } from '../logic/benches';
import { useBuildModeStore } from '../buildModeStore';

/**
 * Placing a carried piece. A ghost shows where it will go, softly green when
 * it fits, red when it does not, amber on a workbench. The rules live in
 * buildSnap.ts. R or the wheel changes how it is set (logs: lying/upright;
 * planks: flat/standing/pitched; roof boards: pitched/flat). Right click
 * places it (InteractionHandler sends vc-log-place-request); on a workbench
 * the carpentry menu opens (vc-carpentry-open).
 */

const REACH = 4.5;
const UP = new THREE.Vector3(0, 1, 0);

const ghostMaterial = new THREE.MeshStandardMaterial({
  color: '#9dbd62', transparent: true, opacity: 0.35, roughness: 0.9, depthWrite: false,
  emissive: new THREE.Color('#9dbd62'), emissiveIntensity: 0.25,
});

const ghostGeometry = (p: LogData): THREE.BufferGeometry => {
  switch (p.kind) {
    case 'plank': return new THREE.BoxGeometry(p.radius * 2, p.length, PLANK_THICKNESS);
    case 'roof': return new THREE.BoxGeometry(p.radius * 2, p.length, ROOF_THICKNESS);
    case 'door': return new THREE.BoxGeometry(p.radius * 2, p.length, DOOR_THICKNESS);
    case 'post': return new THREE.BoxGeometry(p.radius * 2, p.length, p.radius * 2);
    default: return new THREE.CylinderGeometry(p.radius * 0.95, p.radius, p.length, 14);
  }
};

export const BuildPreview: React.FC<{ benches: Bench[] }> = ({ benches }) => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const carried = useLogStore((s) => (s.carriedId ? s.logs[s.carriedId] : null));
  const ghost = useRef<THREE.Group>(null);
  const placement = useRef<Placement | null>(null);
  const benchesRef = useRef(benches);
  benchesRef.current = benches;
  const dir = useMemo(() => new THREE.Vector3(), []);

  // Wheel or R steps through the ways this piece can be set down.
  useEffect(() => {
    const toggle = () => {
      const st = useLogStore.getState();
      const piece = st.carriedId ? st.logs[st.carriedId] : undefined;
      if (!piece) return;
      useBuildModeStore.getState().cycle(piece.kind);
    };
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
        onBench: p.onBench,
        ...(p.swing ? { swing: p.swing, open: false } : {}),
      });
      logs.setCarried(null);
      lastPlaced.id = id;
      lastPlaced.at = performance.now();
      const base = p.position.clone();
      if (p.onBench) {
        window.dispatchEvent(new CustomEvent('vc-audio-play', { detail: { soundId: 'wood_hit', options: { pitch: 0.8, volume: 0.6 } } }));
        window.dispatchEvent(new CustomEvent('vc-carpentry-open', { detail: { benchId: p.onBench } }));
        return;
      }
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
    camera.getWorldDirection(dir);
    const origin = camera.position;
    const all = useLogStore.getState().logs;
    const hit = world.castRayAndGetNormal(new rapier.Ray(origin, dir), REACH, true, undefined, undefined, undefined, undefined,
      (c: { parent: () => { userData?: unknown } | null }) => {
        const ud = c.parent()?.userData as { type?: string; id?: string } | undefined;
        if (ud?.type === 'terrain') return true;
        return ud?.type === 'log' && all[ud.id ?? '']?.state === 'placed';
      });
    if (!hit) { g.visible = false; placement.current = null; return; }
    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, hit.timeOfImpact);
    const ud = hit.collider.parent()?.userData as { type?: string; id?: string } | undefined;
    let target: LogData | undefined = ud?.type === 'log' ? all[ud.id ?? ''] : undefined;
    // A piece already waiting on a bench stands for the bench (it is busy).
    if (target?.onBench) target = all[target.onBench];
    const placed = Object.values(all).filter((l) => l.state === 'placed');
    const p = computePlacement({
      carried,
      mode: useBuildModeStore.getState().modeOf(carried.kind),
      point,
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      target,
      view: dir.clone(),
      placed,
      benches: benchesRef.current,
      groundAt: (x, z) => TerrainService.getHeightAt(x, z),
    });
    placement.current = p;
    g.visible = true;
    g.position.copy(p.position);
    g.quaternion.copy(p.rotation);
    const tone = !p.valid ? '#b4745f' : p.onBench ? '#e0b86a' : '#9dbd62';
    ghostMaterial.color.set(tone);
    ghostMaterial.emissive.set(tone);
  });

  const geo = useMemo(() => (carried ? ghostGeometry(carried) : null), [carried?.id, carried?.length, carried?.radius, carried?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { geo?.dispose(); }, [geo]);

  return (
    <group ref={ghost} visible={false}>
      {geo && <mesh geometry={geo} material={ghostMaterial} renderOrder={3} />}
    </group>
  );
};
