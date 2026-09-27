import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useLogStore, lastPlaced, PLANK_THICKNESS, ROOF_THICKNESS, DOOR_THICKNESS, type LogData } from '@/state/LogStore';
import { emitImpact } from '@features/interaction/components/ImpactFX';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { computePlacement, benchLegPairNear, logPairNear, type Placement } from '../logic/buildSnap';
import { SAWHORSE_MAX_LENGTH, type Bench } from '../logic/benches';
import { frameOf, isUpright } from '../logic/pieceFrame';
import { useBuildModeStore } from '../buildModeStore';
import { isHeld, supportedSet } from '../logic/support';
import { makeGroundProbe } from '../groundProbe';

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

/** A short note walking the player through a workbench, after each piece that starts one. */
const benchHint = (id: string) => {
  const all = Object.values(useLogStore.getState().logs).filter((l) => l.state === 'placed');
  const piece = all.find((l) => l.id === id);
  if (!piece) return;
  const note = (text: string) => window.dispatchEvent(new CustomEvent('vc-hud-note', { detail: { text } }));
  const f = frameOf(piece);
  const p = new THREE.Vector3(...piece.position);
  if (piece.kind === 'plank' && isUpright(f)) {
    if (benchLegPairNear(all, p, 3.1)) note('Bench legs set · now lay a plank across them');
    else if (!all.some((o) => o.id !== id && o.kind === 'plank' && isUpright(frameOf(o)) && Math.hypot(o.position[0] - p.x, o.position[2] - p.z) < 1.8)) {
      note('A bench leg · set a second standing plank beside it');
    }
  } else if ((piece.kind ?? 'log') === 'log' && !isUpright(f) && piece.length <= SAWHORSE_MAX_LENGTH && logPairNear(all, p, 3.1)) {
    note('Two sawhorses · lay a plank flat across them for a bench');
  }
};

export const BuildPreview: React.FC<{ benches: Bench[] }> = ({ benches }) => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const carried = useLogStore((s) => (s.carriedId ? s.logs[s.carriedId] : null));
  const ghost = useRef<THREE.Group>(null);
  const placement = useRef<Placement | null>(null);
  // Will the piece stay where it is set? (orange ghost, and it falls when placed)
  const heldRef = useRef(true);
  const probe = useMemo(() => makeGroundProbe(world, rapier), [world, rapier]);
  // Supported pieces, recomputed only when the pieces change.
  const supportCache = useRef<{ logs: unknown; pieces: LogData[] }>({ logs: null, pieces: [] });
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
    // One step per press: a held key's auto-repeat skipped past the wanted mode.
    const onKey = (e: KeyboardEvent) => { if (e.code === 'KeyR' && !e.repeat && useLogStore.getState().carriedId) toggle(); };
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
      // Nothing holds it there: let go of it and it falls.
      if (!p.onBench && !heldRef.current) {
        logs.updateLog(id, {
          state: 'loose',
          position: [p.position.x, p.position.y + 0.02, p.position.z],
          rotation: [p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w],
        });
        logs.release(id);
        window.dispatchEvent(new CustomEvent('vc-hud-note', { detail: { text: 'Nothing holds it there · it falls' } }));
        return;
      }
      logs.updateLog(id, {
        state: 'placed',
        position: [p.position.x, p.position.y, p.position.z],
        rotation: [p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w],
        onBench: p.onBench,
        ...(p.swing ? { swing: p.swing, open: false } : {}),
      });
      logs.release(id);
      // A neighbour moved to fit (a bench leg driven down to level with this one).
      for (const a of p.adjust ?? []) logs.updateLog(a.id, a.rotation ? { position: a.position, rotation: a.rotation } : { position: a.position });
      lastPlaced.id = id;
      lastPlaced.at = performance.now();
      const base = p.position.clone();
      if (p.onBench) {
        window.dispatchEvent(new CustomEvent('vc-audio-play', { detail: { soundId: 'wood_hit', options: { pitch: 0.8, volume: 0.6 } } }));
        window.dispatchEvent(new CustomEvent('vc-carpentry-open', { detail: { benchId: p.onBench } }));
        return;
      }
      emitImpact({ position: base, direction: UP, kind: 'earth', color: '#6b5236', strength: 0.6, floorY: base.y - 1 });
      benchHint(id);
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
      groundAt: (x, z) => probe(x, z, point.y) ?? TerrainService.getHeightAt(x, z),
    });
    placement.current = p;
    if (supportCache.current.logs !== all) {
      const placedNow = Object.values(all).filter((l) => l.state === 'placed');
      const held = supportedSet(placedNow, probe);
      supportCache.current = { logs: all, pieces: placedNow.filter((l) => held.has(l.id)) };
    }
    heldRef.current = !!p.onBench || isHeld({
      ...carried, state: 'placed', onBench: p.onBench,
      position: [p.position.x, p.position.y, p.position.z],
      rotation: [p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w],
    }, supportCache.current.pieces, probe);
    g.visible = true;
    g.position.copy(p.position);
    g.quaternion.copy(p.rotation);
    const tone = !p.valid ? '#b4745f' : p.onBench ? '#e0b86a' : !heldRef.current ? '#e08a3c' : '#9dbd62';
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
