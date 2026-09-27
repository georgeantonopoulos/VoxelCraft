import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CylinderCollider, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import { useLogStore, lastPlaced, PLANK_THICKNESS, ROOF_THICKNESS, DOOR_THICKNESS, type LogData } from '@/state/LogStore';
import { useMaterialsStore, MATERIALS_PREFIX } from '@/state/MaterialsStore';
import { useGroveStore } from '@/state/GroveStore';
import { BuildPreview } from './BuildPreview';
import { PieceMesh } from './PieceMeshes';
import { playerState } from '@core/player/PlayerState';
import { GEN_VERSION } from '@/constants';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { settleLogs } from '../logic/settleLogs';
import { findBenches, type Bench } from '../logic/benches';

export { LogMesh, PlankMesh, PieceMesh, getRingTexture } from './PieceMeshes';

/**
 * Building pieces in the world: sawn logs and everything shaped from them.
 * Loose pieces are dynamic bodies; placed ones are fixed (doors are
 * kinematic, so they can swing on their hinges). Live bodies are registered
 * so the player can pick up the one they are looking at.
 */

export const logBodies = new Map<string, RapierRigidBody>();

/** How far a door swings open (rad). */
const DOOR_OPEN_ANGLE = 1.75;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const PieceCollider: React.FC<{ log: LogData }> = ({ log }) => {
  switch (log.kind) {
    case 'plank': return <CuboidCollider args={[log.radius, log.length / 2, PLANK_THICKNESS / 2]} />;
    case 'roof': return <CuboidCollider args={[log.radius, log.length / 2, ROOF_THICKNESS / 2]} />;
    case 'door': return <CuboidCollider args={[log.radius, log.length / 2, DOOR_THICKNESS / 2]} />;
    case 'post': return <CuboidCollider args={[log.radius, log.length / 2, log.radius]} />;
    default: return <CylinderCollider args={[log.length / 2, log.radius]} />;
  }
};

/** Swings a placed door about its hinge edge (local -X) toward its open or shut angle. */
const useDoorSwing = (log: LogData, body: React.RefObject<RapierRigidBody | null>) => {
  const angle = useRef(log.open ? -(log.swing ?? 1) * DOOR_OPEN_ANGLE : 0);
  // The body starts at the shut pose (its props): write the real pose once.
  const applied = useRef(false);
  const tmp = useMemo(() => ({ q: new THREE.Quaternion(), turn: new THREE.Quaternion(), hinge: new THREE.Vector3(), p: new THREE.Vector3() }), []);
  useFrame((_, dt) => {
    if (log.kind !== 'door' || log.state !== 'placed') return;
    const b = body.current;
    if (!b || !b.isValid()) return;
    const target = log.open ? -(log.swing ?? 1) * DOOR_OPEN_ANGLE : 0;
    if (applied.current && Math.abs(target - angle.current) < 1e-4) return;
    applied.current = true;
    angle.current += (target - angle.current) * Math.min(1, dt * 6);
    if (Math.abs(target - angle.current) < 0.002) angle.current = target;
    const base = tmp.q.set(log.rotation[0], log.rotation[1], log.rotation[2], log.rotation[3]);
    const width = new THREE.Vector3(1, 0, 0).applyQuaternion(base);
    const center = tmp.p.set(log.position[0], log.position[1], log.position[2]);
    tmp.hinge.copy(center).addScaledVector(width, -log.radius);
    tmp.turn.setFromAxisAngle(Y_AXIS, angle.current);
    const offset = center.clone().sub(tmp.hinge).applyQuaternion(tmp.turn);
    const pos = tmp.hinge.clone().add(offset);
    b.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    const q = tmp.turn.clone().multiply(base);
    b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  });
};

const Log: React.FC<{ log: LogData }> = ({ log }) => {
  const body = useRef<RapierRigidBody>(null);
  useEffect(() => {
    if (body.current) logBodies.set(log.id, body.current);
    return () => { logBodies.delete(log.id); };
  }, [log.id, log.state]);
  useDoorSwing(log, body);
  const seed = useMemo(() => (parseInt(log.id.replace(/\D/g, '').slice(-6) || '1', 10) % 997) / 97, [log.id]);
  const type = log.state !== 'placed' ? 'dynamic' : log.kind === 'door' ? 'kinematicPosition' : 'fixed';
  return (
    <RigidBody
      key={`${log.id}-${log.state}`}
      ref={body}
      type={type}
      position={log.position}
      quaternion={log.rotation}
      colliders={false}
      userData={{ type: 'log', id: log.id }}
      linearDamping={0.6}
      angularDamping={1.2}
      friction={1.2}
      restitution={0.05}
    >
      <PieceCollider log={log} />
      <PieceMesh piece={log} seed={seed} />
    </RigidBody>
  );
};

/** A worked bench: two holdfast pegs and a few curls of shavings on the top. */
const BenchDressing: React.FC<{ bench: Bench; top: LogData }> = ({ bench, top }) => {
  const q = useMemo(() => new THREE.Quaternion(top.rotation[0], top.rotation[1], top.rotation[2], top.rotation[3]), [top.rotation]);
  const axis = useMemo(() => new THREE.Vector3(0, 1, 0).applyQuaternion(q), [q]);
  const width = useMemo(() => new THREE.Vector3(1, 0, 0).applyQuaternion(q), [q]);
  const at = (along: number, across: number, lift: number): [number, number, number] => [
    bench.top[0] + axis.x * along + width.x * across,
    bench.top[1] + lift,
    bench.top[2] + axis.z * along + width.z * across,
  ];
  const L = top.length / 2, W = top.radius;
  return (
    <group>
      {[0.8, -0.8].map((k) => (
        <mesh key={k} position={at(k * L, W * 0.55, 0.03)} castShadow>
          <cylinderGeometry args={[0.018, 0.022, 0.06, 8]} />
          <meshStandardMaterial color="#6b5236" roughness={0.9} />
        </mesh>
      ))}
      {[[-0.3, -0.5], [0.15, -0.65], [0.4, -0.35]].map(([a, b], i) => (
        <mesh key={i} position={at(a * L, b * W, 0.012)} rotation={[Math.PI / 2, 0, i * 1.7]}>
          <torusGeometry args={[0.028, 0.006, 5, 10, Math.PI * 1.4]} />
          <meshStandardMaterial color="#d8bb8a" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
};

const PLACED_PREFIX = 'vc-logs-v1-';

/** Every loose and placed piece (the carried one is drawn in the player's hands). */
export const LogsLayer: React.FC = () => {
  const logs = useLogStore((s) => s.logs);
  const seed = useGroveStore((s) => s.seed);

  // Pieces persist per world seed: placed ones (builds) and loose ones (sawn
  // logs and planks lying about, at wherever physics left them). A piece
  // being carried is saved as set down at the player's feet.
  useEffect(() => {
    if (seed == null) return;
    // A different world: its own logs only.
    useLogStore.setState({ logs: {}, carried: [], carriedId: null });
    try {
      const raw = window.localStorage.getItem(PLACED_PREFIX + seed);
      const parsed = raw ? (JSON.parse(raw) as LogData[] | { gen: number; logs: LogData[] }) : [];
      // Saved as { gen, logs }; older saves are a bare array (terrain version unknown).
      const savedGen = Array.isArray(parsed) ? -1 : parsed.gen;
      let saved: LogData[] = (Array.isArray(parsed) ? parsed : parsed.logs).map((l) => ({ ...l, state: l.state === 'placed' ? 'placed' as const : 'loose' as const }));
      // The ground was regenerated since these were saved: re-seat builds on it.
      if (saved.length && savedGen !== GEN_VERSION) {
        saved = settleLogs(saved, (x, z) => TerrainService.getHeightAt(x, z));
      }
      if (saved.length) useLogStore.getState().addLogs(saved);
    } catch { /* storage unavailable or corrupt: start empty */ }
    let last = '';
    const save = () => {
      const st = useLogStore.getState();
      const list = Object.values(st.logs).map((l): LogData => {
        if (l.state === 'carried') {
          // The load is saved as a pile at the player's feet.
          const k = Math.max(0, st.carried.indexOf(l.id));
          return { ...l, state: 'loose', onBench: undefined, position: [playerState.x, playerState.y + 0.6 + k * 0.2, playerState.z] };
        }
        if (l.state === 'loose') {
          const body = logBodies.get(l.id);
          if (body && body.isValid()) {
            const t = body.translation(), r = body.rotation();
            return { ...l, position: [t.x, t.y, t.z], rotation: [r.x, r.y, r.z, r.w] };
          }
        }
        return l;
      });
      const json = JSON.stringify({ gen: GEN_VERSION, logs: list });
      if (json === last) return;
      last = json;
      try { window.localStorage.setItem(PLACED_PREFIX + seed, json); } catch { /* ignore */ }
    };
    const unsubscribe = useLogStore.subscribe(save);
    // Loose logs roll and settle without touching the store: snapshot them now and then.
    const timer = window.setInterval(save, 8000);
    window.addEventListener('beforeunload', save);
    return () => { unsubscribe(); window.clearInterval(timer); window.removeEventListener('beforeunload', save); save(); };
  }, [seed]);

  // The builder's pouch (copper, hinges) belongs to the same world.
  useEffect(() => {
    if (seed == null) return;
    const key = MATERIALS_PREFIX + seed;
    try {
      const raw = window.localStorage.getItem(key);
      useMaterialsStore.getState().load(raw ? JSON.parse(raw) : null);
    } catch { useMaterialsStore.getState().load(null); }
    const save = () => {
      const { copper, hinges } = useMaterialsStore.getState();
      try { window.localStorage.setItem(key, JSON.stringify({ copper, hinges })); } catch { /* ignore */ }
    };
    const unsubscribe = useMaterialsStore.subscribe(save);
    return () => { unsubscribe(); save(); };
  }, [seed]);

  // Benches are read from the placed planks. One the player has just
  // completed (its last plank placed a moment ago) is announced.
  const benches = useMemo(() => findBenches(Object.values(logs)), [logs]);
  const known = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = benches.find((b) => !known.current.has(b.id)
      && (b.id === lastPlaced.id || b.legIds.includes(lastPlaced.id))
      && performance.now() - lastPlaced.at < 1500);
    if (fresh) {
      useGroveStore.getState().announce({ kind: 'discovery', title: 'A workbench', detail: 'Set a log or plank on it to shape it' });
      window.dispatchEvent(new CustomEvent('vc-audio-woodwork', { detail: { kind: 'splitDone' } }));
    }
    known.current = new Set(benches.map((b) => b.id));
    // A piece left on a bench that has been taken apart drops where it was.
    const ids = new Set(benches.map((b) => b.id));
    const orphans = Object.values(useLogStore.getState().logs).filter((l) => l.onBench && !ids.has(l.onBench));
    for (const l of orphans) useLogStore.getState().updateLog(l.id, { onBench: undefined, state: 'loose' });
  }, [benches]);

  return (
    <>
      {Object.values(logs).filter((l) => l.state !== 'carried').map((l) => <Log key={`${l.id}-${l.state}`} log={l} />)}
      {benches.map((b) => logs[b.id] && <BenchDressing key={b.id} bench={b} top={logs[b.id]} />)}
      <BuildPreview benches={benches} />
    </>
  );
};
