import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider, CuboidCollider, type RapierRigidBody } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { useLogStore, PLANK_THICKNESS, type LogData } from '@/state/LogStore';
import { useGroveStore } from '@/state/GroveStore';
import { BuildPreview } from './BuildPreview';
import { playerState } from '@core/player/PlayerState';
import { GEN_VERSION } from '@/constants';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { settleLogs } from '../logic/settleLogs';

/**
 * A sawn log: a bark cylinder (the stick bark shader, so logs and sticks read
 * as the same wood) with fresh cut ends showing growth rings. Loose logs are
 * dynamic bodies; placed logs are fixed. Live bodies are registered so the
 * player can pick up the one they are looking at.
 */

export const logBodies = new Map<string, RapierRigidBody>();

let ringTexture: THREE.CanvasTexture | null = null;
export const getRingTexture = (): THREE.CanvasTexture => {
  if (ringTexture) return ringTexture;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  // Pale fresh-cut heartwood, darker sapwood rim, fine growth rings.
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, '#b08a5a');
  grad.addColorStop(0.75, '#d8bb8a');
  grad.addColorStop(0.9, '#c9a574');
  grad.addColorStop(1, '#5b4a38');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  g.strokeStyle = 'rgba(110, 80, 45, 0.35)';
  for (let r = 4; r < n / 2 - 4; r += 3 + Math.random() * 3) {
    g.lineWidth = 0.6 + Math.random() * 0.8;
    g.beginPath();
    g.ellipse(n / 2 + (Math.random() - 0.5), n / 2 + (Math.random() - 0.5), r, r * (0.96 + Math.random() * 0.06), 0, 0, Math.PI * 2);
    g.stroke();
  }
  // A radial check crack.
  g.strokeStyle = 'rgba(60, 40, 25, 0.5)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(n / 2, n / 2);
  g.lineTo(n * 0.9, n * 0.62);
  g.stroke();
  ringTexture = new THREE.CanvasTexture(c);
  ringTexture.colorSpace = THREE.SRGBColorSpace;
  return ringTexture;
};

export const LogMesh: React.FC<{ length: number; radius: number; bark: string; seed?: number }> = ({ length, radius, bark, seed = 1 }) => {
  const side = useMemo(() => new THREE.CylinderGeometry(radius * 0.93, radius, length, 16, 4, true), [length, radius]);
  const cap = useMemo(() => new THREE.CircleGeometry(radius * 0.99, 18), [radius]);
  const capMaterial = useMemo(() => new THREE.MeshStandardMaterial({ map: getRingTexture(), roughness: 0.9 }), []);
  const uniforms = useMemo(() => ({
    uInstancing: { value: false },
    uSeed: { value: seed },
    uHeight: { value: length },
    uNoiseTexture: { value: getNoiseTexture() },
    uColor: { value: new THREE.Color(bark) },
  }), [seed, length, bark]);
  useEffect(() => () => { side.dispose(); cap.dispose(); capMaterial.dispose(); }, [side, cap, capMaterial]);
  return (
    <group>
      <mesh geometry={side} castShadow receiveShadow>
        <CustomShaderMaterial
          baseMaterial={THREE.MeshStandardMaterial}
          vertexShader={STICK_SHADER.vertex}
          fragmentShader={STICK_SHADER.fragment}
          uniforms={uniforms}
          color={bark}
          roughness={0.95}
          metalness={0}
        />
      </mesh>
      <mesh geometry={cap} material={capMaterial} position={[0, length / 2, 0]} rotation={[-Math.PI / 2, 0, 0]} />
      <mesh geometry={cap} material={capMaterial} position={[0, -length / 2, 0]} rotation={[Math.PI / 2, 0, 0]} />
    </group>
  );
};

/** A split plank: a pale board, grain along its length, a strip of bark on one edge. */
export const PlankMesh: React.FC<{ length: number; halfWidth: number; bark: string; seed?: number }> = ({ length, halfWidth, bark, seed = 1 }) => {
  const board = useMemo(() => new THREE.BoxGeometry(halfWidth * 2, length, PLANK_THICKNESS, 2, 6, 1), [length, halfWidth]);
  const edge = useMemo(() => new THREE.BoxGeometry(0.012, length * 0.98, PLANK_THICKNESS * 0.9), [length]);
  const uniforms = useMemo(() => ({
    uInstancing: { value: false },
    uSeed: { value: seed },
    uHeight: { value: length },
    uNoiseTexture: { value: getNoiseTexture() },
    uColor: { value: new THREE.Color('#b89a70') },
  }), [seed, length]);
  const barkMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: bark, roughness: 0.95 }), [bark]);
  useEffect(() => () => { board.dispose(); edge.dispose(); barkMaterial.dispose(); }, [board, edge, barkMaterial]);
  return (
    <group>
      <mesh geometry={board} castShadow receiveShadow>
        <CustomShaderMaterial
          baseMaterial={THREE.MeshStandardMaterial}
          vertexShader={STICK_SHADER.vertex}
          fragmentShader={STICK_SHADER.fragment}
          uniforms={uniforms}
          color="#b89a70"
          roughness={0.9}
          metalness={0}
        />
      </mesh>
      <mesh geometry={edge} material={barkMaterial} position={[halfWidth + 0.004, 0, 0]} castShadow />
    </group>
  );
};

const Log: React.FC<{ log: LogData }> = ({ log }) => {
  const body = useRef<RapierRigidBody>(null);
  useEffect(() => {
    if (body.current) logBodies.set(log.id, body.current);
    return () => { logBodies.delete(log.id); };
  }, [log.id, log.state]);
  const seed = useMemo(() => (parseInt(log.id.replace(/\D/g, '').slice(-6) || '1', 10) % 997) / 97, [log.id]);
  return (
    <RigidBody
      key={`${log.id}-${log.state}`}
      ref={body}
      type={log.state === 'placed' ? 'fixed' : 'dynamic'}
      position={log.position}
      quaternion={log.rotation}
      colliders={false}
      userData={{ type: 'log', id: log.id }}
      linearDamping={0.6}
      angularDamping={1.2}
      friction={1.2}
      restitution={0.05}
    >
      {log.kind === 'plank' ? (
        <>
          <CuboidCollider args={[log.radius, log.length / 2, PLANK_THICKNESS / 2]} />
          <PlankMesh length={log.length} halfWidth={log.radius} bark={log.bark} seed={seed} />
        </>
      ) : (
        <>
          <CylinderCollider args={[log.length / 2, log.radius]} />
          <LogMesh length={log.length} radius={log.radius} bark={log.bark} seed={seed} />
        </>
      )}
    </RigidBody>
  );
};

const PLACED_PREFIX = 'vc-logs-v1-';

/** Every loose and placed log (carried ones are drawn in the player's hands). */
export const LogsLayer: React.FC = () => {
  const logs = useLogStore((s) => s.logs);
  const seed = useGroveStore((s) => s.seed);

  // Logs persist per world seed: placed ones (builds) and loose ones (sawn
  // logs and planks lying about, at wherever physics left them). A log being
  // carried is saved as set down at the player's feet.
  useEffect(() => {
    if (seed == null) return;
    // A different world: its own logs only.
    useLogStore.setState({ logs: {}, carriedId: null });
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
          return { ...l, state: 'loose', position: [playerState.x, playerState.y + 0.6, playerState.z] };
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

  return (
    <>
      {Object.values(logs).filter((l) => l.state !== 'carried').map((l) => <Log key={`${l.id}-${l.state}`} log={l} />)}
      <BuildPreview />
    </>
  );
};
