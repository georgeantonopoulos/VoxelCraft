import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import * as THREE from 'three';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { BiomeManager, BiomeType } from '@features/terrain/logic/BiomeManager';
import { WATER_LEVEL } from '@/constants';
import { playerState } from '@core/player/PlayerState';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { useGroveStore } from '@state/GroveStore';
import { PooledPointLight, VirtualPointLight } from '@core/graphics/PointLightPool';
import { frameProfiler } from '@core/utils/FrameProfiler';
import { createCreatureMaterial, getCreatureGeometry, CreatureKind } from './wildlifeMeshes';
import {
  Group, RootlingState, WildlifeWorld, makeAgent,
  updateBirds, updateDeer, updateFish, updateRootling,
} from './wildlifeSim';

/**
 * WildlifeManager: keeps the land around the player alive.
 *
 * Spawns bird flocks, deer herds and fish schools in a ring 35-80 m out, in
 * habitats that suit them, and despawns them beyond ~130 m. Populations grow
 * with world vitality: restoring Root Hollows visibly brings life back.
 * A rootling guide appears when the Lumina compass has a target and leads the
 * player there (reward: essence via the `creaturesGuided` stat).
 *
 * Rendering: one InstancedMesh per species; animation is procedural in the
 * vertex shader (wildlifeMeshes.ts), driven by a per-instance aAnim attribute.
 */

const CAPACITY: Record<CreatureKind, number> = { bird: 48, deer: 24, fish: 48, rootling: 1 };
const SPAWN_MIN = 35, SPAWN_MAX = 80, DESPAWN = 130;

const HABITAT: Record<'bird' | 'deer' | 'fish', Partial<Record<BiomeType, number>>> = {
  bird: { THE_GROVE: 1, JUNGLE: 1, PLAINS: 0.8, SAVANNA: 0.7, BEACH: 0.5, MOUNTAINS: 0.4, SKY_ISLANDS: 0.6 },
  deer: { THE_GROVE: 1, PLAINS: 1, SAVANNA: 0.6, MOUNTAINS: 0.3, JUNGLE: 0.3 },
  fish: {},
};

/** Terrain adapter with a 1 m height cache: creatures query the ground a lot. */
function createWorld(): WildlifeWorld & { clear: () => void } {
  const cache = new Map<number, number>();
  const key = (ix: number, iz: number) => ix * 100003 + iz;
  const groundAt = (x: number, z: number) => {
    const ix = Math.round(x), iz = Math.round(z);
    const k = key(ix, iz);
    let h = cache.get(k);
    if (h === undefined) {
      if (cache.size > 60000) cache.clear();
      h = TerrainService.getHeightAt(ix, iz);
      cache.set(k, h);
    }
    return h;
  };
  return {
    groundAt,
    waterAt: (x, z) => (groundAt(x, z) < WATER_LEVEL - 0.3 ? WATER_LEVEL : null),
    habitat: (kind, x, z) => {
      if (kind === 'fish') return groundAt(x, z) < WATER_LEVEL - 1.5 ? 1 : 0;
      if (groundAt(x, z) < WATER_LEVEL + 0.3) return 0;
      return HABITAT[kind][BiomeManager.getBiomeAt(x, z)] ?? 0;
    },
    clear: () => cache.clear(),
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function useSpeciesMesh(kind: CreatureKind) {
  return useMemo(() => {
    const geo = getCreatureGeometry(kind).clone();
    const anim = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY[kind] * 4), 4);
    anim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', anim);
    const mesh = new THREE.InstancedMesh(geo, createCreatureMaterial(kind), CAPACITY[kind]);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span a large area around the player
    mesh.castShadow = kind !== 'fish';
    mesh.receiveShadow = true;
    return { mesh, anim };
  }, [kind]);
}

const SCALE: Record<CreatureKind, number> = { bird: 1, deer: 1, fish: 1.3, rootling: 1 };

export const WildlifeManager: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const { world: physics, rapier } = useRapier();
  const world = useMemo(() => {
    const w = createWorld();
    // The rootling walks right beside the player: stand it on the real terrain
    // collider (digs included). The 1 m analytic grid sat it up to half a metre
    // into slopes. A hit far above the creature is a roof overhead: ignore it.
    const ray = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    w.surfaceAt = (x, z, yHint) => {
      ray.origin = { x, y: yHint + 1.5, z };
      const hit = physics.castRay(ray, 4, true, undefined, undefined, undefined, undefined,
        (c: { parent: () => { userData?: unknown } | null }) => (c.parent()?.userData as { type?: string } | undefined)?.type === 'terrain');
      if (!hit) return null;
      const y = yHint + 1.5 - hit.timeOfImpact;
      return y > yHint + 1.0 ? null : y;
    };
    return w;
  }, [physics, rapier]);
  const lastPlayer = useRef<{ x: number; z: number; speed: number } | null>(null);
  const rand = useMemo(() => mulberry32(0xa11ce), []);
  const groups = useRef<Group[]>([]);
  const spawnTimer = useRef(0);
  const rootling = useRef<RootlingState>({
    active: false, agent: makeAgent(0, 0, 0, 0, rand), mode: 'wait', targetX: 0, targetZ: 0, timer: 0,
  });
  const rootlingCooldown = useRef(8);
  const glowAnchor = useRef<THREE.Group>(null);
  const glowLight = useRef<VirtualPointLight>(null);

  const birds = useSpeciesMesh('bird');
  const deer = useSpeciesMesh('deer');
  const fish = useSpeciesMesh('fish');
  const roots = useSpeciesMesh('rootling');

  useEffect(() => () => {
    for (const s of [birds, deer, fish, roots]) { s.mesh.geometry.dispose(); (s.mesh.material as THREE.Material).dispose(); }
    world.clear();
  }, [birds, deer, fish, roots, world]);

  // Debug: window.__wildlife.summary() / .groups for locating creatures.
  useEffect(() => {
    const api = {
      groups: groups.current,
      summary: () => groups.current.map((g) => ({ kind: g.kind, state: g.state, n: g.members.length, x: Math.round(g.members[0].x), y: Math.round(g.members[0].y), z: Math.round(g.members[0].z) })),
      rootling: () => rootling.current,
    };
    Object.defineProperty(api, 'groups', { get: () => groups.current });
    (window as unknown as { __wildlife?: typeof api }).__wildlife = api;
    return () => { delete (window as unknown as { __wildlife?: typeof api }).__wildlife; };
  }, []);

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpE = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []);
  const tmpP = useMemo(() => new THREE.Vector3(), []);
  const tmpS = useMemo(() => new THREE.Vector3(), []);

  useFrame((_state, delta) => {
    if (!enabled) return;
    frameProfiler.begin('wildlife');
    const dt = Math.min(delta, 0.05);
    // Player's horizontal speed (smoothed) so the rootling can keep ahead of them.
    const lp = lastPlayer.current;
    const inst = lp && dt > 0 ? Math.min(40, Math.hypot(playerState.x - lp.x, playerState.z - lp.z) / dt) : 0;
    const playerSpeed = lp ? lp.speed + (inst - lp.speed) * Math.min(1, dt * 5) : 0;
    lastPlayer.current = { x: playerState.x, z: playerState.z, speed: playerSpeed };
    const player = { x: playerState.x, y: playerState.y, z: playerState.z, speed: playerSpeed };
    const daylight = THREE.MathUtils.smoothstep(sharedUniforms.uSunDir.value.y, -0.1, 0.15);
    const vitality = useGroveStore.getState().vitality;
    const life = 0.35 + 0.65 * vitality;

    // --- Population management (1 Hz) ---
    spawnTimer.current -= dt;
    if (spawnTimer.current <= 0) {
      spawnTimer.current = 1;
      // Despawn far groups (and birds at night: they roost out of sight).
      groups.current = groups.current.filter((g) => {
        const a = g.members[0];
        const far = Math.hypot(a.x - player.x, a.z - player.z) > DESPAWN;
        const roost = g.kind === 'bird' && daylight < 0.15 && Math.hypot(a.x - player.x, a.z - player.z) > 40;
        return !far && !roost;
      });
      const count = (k: Group['kind']) => groups.current.filter((g) => g.kind === k).length;
      const members = (k: Group['kind']) => groups.current.filter((g) => g.kind === k).reduce((n, g) => n + g.members.length, 0);
      const trySpawn = (kind: Group['kind'], size: [number, number]) => {
        const ang = rand() * Math.PI * 2, r = SPAWN_MIN + rand() * (SPAWN_MAX - SPAWN_MIN);
        const x = player.x + Math.cos(ang) * r, z = player.z + Math.sin(ang) * r;
        if (rand() > world.habitat(kind, x, z)) return;
        const n = size[0] + Math.floor(rand() * (size[1] - size[0] + 1));
        if (members(kind) + n > CAPACITY[kind]) return;
        const gy = world.groundAt(x, z);
        const g: Group = { kind, state: kind === 'bird' ? 'fly' : kind === 'deer' ? 'graze' : 'swim', timer: 2 + rand() * 6, tx: x, ty: gy + 15, tz: z, members: [] };
        for (let i = 0; i < n; i++) {
          const ox = (rand() - 0.5) * (kind === 'deer' ? 8 : 4), oz = (rand() - 0.5) * (kind === 'deer' ? 8 : 4);
          const y = kind === 'bird' ? gy + 12 + rand() * 4 : kind === 'fish' ? WATER_LEVEL - 1 : world.groundAt(x + ox, z + oz);
          g.members.push(makeAgent(x + ox, y, z + oz, groups.current.length, rand));
        }
        groups.current.push(g);
      };
      // Sightings stay rare and small so each one is noticed: a faded world
      // holds one small flock and a lone deer or pair; healing adds a little more.
      if (daylight > 0.2 && count('bird') < Math.max(1, Math.round(2 * life))) trySpawn('bird', [3, 6]);
      if (count('deer') < Math.max(1, Math.round(2 * life))) trySpawn('deer', [1, 3]);
      if (count('fish') < 3) trySpawn('fish', [3, 6]);

      // Rootling guide: appears when the Lumina compass has somewhere to go.
      const r = rootling.current;
      rootlingCooldown.current -= 1;
      const compass = useGroveStore.getState().compass;
      if (!r.active && compass && compass.distance > 30 && compass.distance < 400 && rootlingCooldown.current <= 0 && daylight > 0.1) {
        const dir = Math.atan2(compass.x - player.x, compass.z - player.z);
        const sx = player.x + Math.sin(dir) * 10, sz = player.z + Math.cos(dir) * 10;
        if (world.waterAt(sx, sz) === null) {
          r.agent = makeAgent(sx, world.groundAt(sx, sz), sz, -1, rand);
          r.agent.yaw = dir + Math.PI;
          r.active = true; r.mode = 'wait'; r.targetX = compass.x; r.targetZ = compass.z;
          rootlingCooldown.current = 90;
        }
      }
      if (r.active && compass) { r.targetX = compass.x; r.targetZ = compass.z; }
      if (r.active && Math.hypot(r.agent.x - player.x, r.agent.z - player.z) > DESPAWN) r.active = false;
    }

    // --- Behaviour ---
    for (const g of groups.current) {
      if (g.kind === 'bird') updateBirds(g, dt, player, world, rand);
      else if (g.kind === 'deer') updateDeer(g, dt, player, world, rand);
      else updateFish(g, dt, player, world, rand);
    }
    if (updateRootling(rootling.current, dt, player, world)) {
      const grove = useGroveStore.getState();
      grove.record('creaturesGuided');
      grove.announce({ kind: 'discovery', title: 'A rootling led you home', detail: 'The Lumina grows stronger' });
    }

    // --- Upload instances ---
    const write = (spec: ReturnType<typeof useSpeciesMesh>, kind: CreatureKind, list: Group['members'], glow = 0) => {
      let i = 0;
      const arr = spec.anim.array as Float32Array;
      for (const a of list) {
        if (i >= CAPACITY[kind]) break;
        tmpE.set(-a.pitch, a.yaw, 0);
        tmpQ.setFromEuler(tmpE);
        const s = SCALE[kind] * (0.85 + a.seed * 0.3);
        tmpM.compose(tmpP.set(a.x, a.y, a.z), tmpQ, tmpS.set(s, s, s));
        spec.mesh.setMatrixAt(i, tmpM);
        arr[i * 4] = a.phase; arr[i * 4 + 1] = a.amp; arr[i * 4 + 2] = a.head; arr[i * 4 + 3] = glow;
        i++;
      }
      spec.mesh.count = i;
      spec.mesh.instanceMatrix.needsUpdate = true;
      spec.anim.needsUpdate = true;
    };
    const byKind = (k: Group['kind']) => groups.current.filter((g) => g.kind === k).flatMap((g) => g.members);
    write(birds, 'bird', byKind('bird'));
    write(deer, 'deer', byKind('deer'));
    write(fish, 'fish', byKind('fish'));
    const r = rootling.current;
    write(roots, 'rootling', r.active ? [r.agent] : [], 0.6 + 0.4 * (1 - daylight));
    if (glowAnchor.current) glowAnchor.current.position.set(r.agent.x, r.agent.y + 0.8, r.agent.z);
    if (glowLight.current) glowLight.current.intensity = r.active ? 1.2 + 2.0 * (1 - daylight) : 0;
    frameProfiler.end('wildlife');
  });

  return (
    <>
      <primitive object={birds.mesh} />
      <primitive object={deer.mesh} />
      <primitive object={fish.mesh} />
      <primitive object={roots.mesh} />
      <group ref={glowAnchor}>
        {/* Constant light count (pooled): dimmed to 0 when no rootling is out. */}
        <PooledPointLight ref={glowLight} color="#8ff7ff" intensity={0} distance={7} decay={2} />
      </group>
    </>
  );
};
