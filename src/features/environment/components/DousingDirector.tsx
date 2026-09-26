import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { useWeatherStore } from '@/state/WeatherStore';
import { usePhysicsItemStore } from '@/state/PhysicsItemStore';
import { useWorldStore } from '@/state/WorldStore';
import { useGroveStore } from '@/state/GroveStore';
import { ItemType } from '@/types';
import { isSheltered } from '@features/environment/logic/shelter';
import { emitImpact } from '@features/interaction/components/ImpactFX';
import { audioManager } from '@core/audio/AudioManager';

/**
 * Rain puts out fires and torches that have no cover.
 *
 * Once a second during rain, every campfire and placed torch without a roof
 * of logs/planks or rock above it gathers exposure; after EXPOSURE_TO_DOUSE
 * seconds in the open it goes out with a hiss and a puff of steam. A fire
 * leaves its sticks and stone (rebuild it under a roof); a torch leaves a
 * plain stick. Covered ones keep burning: that is what shelter is for.
 */
const EXPOSURE_TO_DOUSE = 25;
const RAIN_THRESHOLD = 0.5;
const RECHECK_COVER_S = 8;
const TELL_RADIUS = 30;

export const DousingDirector: React.FC = () => {
  const { world, rapier } = useRapier();
  const { camera } = useThree();
  const exposure = useRef(new Map<string, number>());
  const cover = useRef(new Map<string, { sheltered: boolean; at: number }>());
  const acc = useRef(0);
  const lastTold = useRef(-1e9);

  useEffect(() => () => { exposure.current.clear(); cover.current.clear(); }, []);

  useFrame((state, delta) => {
    acc.current += delta;
    if (acc.current < 1) return;
    const dt = acc.current;
    acc.current = 0;
    const raining = useWeatherStore.getState().rain >= RAIN_THRESHOLD;
    const now = state.clock.elapsedTime;

    const burning: { id: string; kind: 'fire' | 'torch'; p: THREE.Vector3 }[] = [];
    for (const it of usePhysicsItemStore.getState().items) {
      if (it.type === ItemType.FIRE) burning.push({ id: it.id, kind: 'fire', p: new THREE.Vector3(...it.position) });
    }
    for (const e of useWorldStore.getState().entities.values()) {
      if (e.type === ItemType.TORCH && e.position) burning.push({ id: e.id, kind: 'torch', p: e.position.clone() });
    }

    const alive = new Set(burning.map((b) => b.id));
    for (const id of exposure.current.keys()) if (!alive.has(id)) exposure.current.delete(id);

    for (const b of burning) {
      let c = cover.current.get(b.id);
      if (!c || now - c.at > RECHECK_COVER_S) {
        c = { sheltered: isSheltered(world, rapier, b.p.x, b.p.y + 0.4, b.p.z, 14), at: now };
        cover.current.set(b.id, c);
      }
      const prev = exposure.current.get(b.id) ?? 0;
      const next = raining && !c.sheltered ? prev + dt : Math.max(0, prev - dt * 0.5);
      exposure.current.set(b.id, next);
      if (next < EXPOSURE_TO_DOUSE) continue;

      // Doused.
      exposure.current.delete(b.id);
      cover.current.delete(b.id);
      const physics = usePhysicsItemStore.getState();
      if (b.kind === 'fire') {
        physics.removeItem(b.id);
        useWorldStore.getState().removeEntity(b.id);
        physics.spawnItem(ItemType.STICK, [b.p.x + 0.2, b.p.y + 0.4, b.p.z], [0, 0, 0]);
        physics.spawnItem(ItemType.STICK, [b.p.x - 0.2, b.p.y + 0.4, b.p.z + 0.1], [0, 0, 0]);
        physics.spawnItem(ItemType.STONE, [b.p.x, b.p.y + 0.5, b.p.z - 0.2], [0, 0, 0]);
      } else {
        useWorldStore.getState().removeEntity(b.id);
        physics.spawnItem(ItemType.STICK, [b.p.x, b.p.y + 0.3, b.p.z], [0, 0, 0]);
      }
      emitImpact({ position: b.p.clone().add(new THREE.Vector3(0, 0.3, 0)), direction: new THREE.Vector3(0, 1, 0), kind: 'sand', color: '#9a9690', strength: 2.2, floorY: b.p.y });
      const dist = camera.position.distanceTo(b.p);
      if (dist < TELL_RADIUS) {
        audioManager.ambience?.hiss(Math.max(0.3, 1 - dist / TELL_RADIUS));
        if (now - lastTold.current > 20) {
          lastTold.current = now;
          useGroveStore.getState().announce({ kind: 'discovery', title: b.kind === 'fire' ? 'The rain put out a fire' : 'The rain put out a torch', detail: 'A roof keeps a flame alive' });
        }
      }
    }
  });

  return null;
};
