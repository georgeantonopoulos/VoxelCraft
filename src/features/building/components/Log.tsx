import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RigidBody, CylinderCollider, type RapierRigidBody } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER } from '@core/graphics/GroundItemShaders';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { useLogStore, type LogData } from '@/state/LogStore';
import { useGroveStore } from '@/state/GroveStore';
import { BuildPreview } from './BuildPreview';

/**
 * A sawn log: a bark cylinder (the stick bark shader, so logs and sticks read
 * as the same wood) with fresh cut ends showing growth rings. Loose logs are
 * dynamic bodies; placed logs are fixed. Live bodies are registered so the
 * player can pick up the one they are looking at.
 */

export const logBodies = new Map<string, RapierRigidBody>();

let ringTexture: THREE.CanvasTexture | null = null;
const getRingTexture = (): THREE.CanvasTexture => {
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
      <CylinderCollider args={[log.length / 2, log.radius]} />
      <LogMesh length={log.length} radius={log.radius} bark={log.bark} seed={seed} />
    </RigidBody>
  );
};

const PLACED_PREFIX = 'vc-logs-v1-';

/** Every loose and placed log (carried ones are drawn in the player's hands). */
export const LogsLayer: React.FC = () => {
  const logs = useLogStore((s) => s.logs);
  const seed = useGroveStore((s) => s.seed);

  // Builds persist per world seed: placed logs load with the world and save
  // whenever the set of placed logs changes.
  useEffect(() => {
    if (seed == null) return;
    // A different world: its own logs only.
    useLogStore.setState({ logs: {}, carriedId: null });
    try {
      const raw = window.localStorage.getItem(PLACED_PREFIX + seed);
      const saved = raw ? (JSON.parse(raw) as LogData[]) : [];
      if (saved.length) useLogStore.getState().addLogs(saved.map((l) => ({ ...l, state: 'placed' as const })));
    } catch { /* storage unavailable or corrupt: start empty */ }
    let last = '';
    return useLogStore.subscribe((st) => {
      const placed = Object.values(st.logs).filter((l) => l.state === 'placed');
      const json = JSON.stringify(placed);
      if (json === last) return;
      last = json;
      try { window.localStorage.setItem(PLACED_PREFIX + seed, json); } catch { /* ignore */ }
    });
  }, [seed]);

  return (
    <>
      {Object.values(logs).filter((l) => l.state !== 'carried').map((l) => <Log key={`${l.id}-${l.state}`} log={l} />)}
      <BuildPreview />
    </>
  );
};
