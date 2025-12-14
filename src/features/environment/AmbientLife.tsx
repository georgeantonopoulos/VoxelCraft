import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BiomeManager, BiomeType } from '@features/terrain/logic/BiomeManager';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { FogDeer } from '@features/creatures/FogDeer';
import { forEachChunkFireflies, getFireflyRegistryVersion } from '@features/environment/fireflyRegistry';

export type PlayerMovedDetail = {
  x: number;
  y: number;
  z: number;
  rotation: number;
};

export type PlayerMovedRef = {
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** True after we've received at least one `player-moved` event. */
  hasSignal: boolean;
};

function biomeFireflyFactor(biome: BiomeType): number {
  switch (biome) {
    case 'THE_GROVE':
      return 1.0;
    case 'JUNGLE':
      return 0.85;
    case 'BEACH':
      return 0.25;
    case 'PLAINS':
      return 0.35;
    case 'MOUNTAINS':
      return 0.1;
    case 'DESERT':
    case 'RED_DESERT':
    case 'SNOW':
    case 'ICE_SPIKES':
    case 'SKY_ISLANDS':
    default:
      return 0.0;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * FirefliesField
 * Lightweight instanced "motes" that feel like ambient life.
 *
 * - Firefly positions are chosen during terrain generation and persist per chunk.
 * - This renderer queries the set of currently loaded chunks and renders nearby motes.
 * - Avoids React state churn: instance data is rebuilt only when the player crosses a small cell
 *   boundary or when new chunk firefly data arrives.
 */
const FirefliesField: React.FC<{
  enabled: boolean;
  playerRef: React.MutableRefObject<PlayerMovedRef>;
}> = ({ enabled, playerRef }) => {
  const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
  const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Tunables: cap the visible motes to keep CPU and draw cost predictable.
  const MAX_VISIBLE = 700;
  const REFRESH_CELL_SIZE = 10; // Rebuild instance list after moving ~10m in world space.
  const QUERY_RADIUS = 58; // Only render motes near the player for a tighter "swarm pocket" feel.
  const BASE_RADIUS_MIN = 0.012;
  const BASE_RADIUS_MAX = 0.026;

  const seedsRef = useRef<Float32Array>(new Float32Array(MAX_VISIBLE));
  const lastRefreshRef = useRef<{ ax: number; az: number; version: number } | null>(null);

  const material = useMemo(() => {
    // NOTE: Keep this shader tiny and stable. No GLSL version forcing.
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: 1 },
        uColor: { value: new THREE.Color('#d9ff7a') },
        uDriftAmp: { value: 0.35 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uIntensity;
        uniform float uDriftAmp;
        attribute float aSeed;
        varying float vBlink;

        float hash01(float x) {
          return fract(sin(x) * 43758.5453);
        }

        void main() {
          // Blink: smooth pulse with stable per-instance seed.
          float phase = aSeed * 6.28318530718;
          float speed = mix(1.2, 2.1, hash01(aSeed * 13.7));
          float blink = 0.45 + 0.55 * sin(uTime * speed + phase);
          vBlink = blink * uIntensity;

          // Drift: tiny local wobble to keep them alive without per-frame CPU updates.
          vec3 drift = vec3(
            sin(uTime * 0.7 + aSeed * 12.3),
            sin(uTime * 0.9 + aSeed * 5.1),
            cos(uTime * 0.6 + aSeed * 9.7)
          ) * uDriftAmp;

          // Scale geometry by blink, but keep a minimum to avoid degenerate transforms.
          float s = max(0.08, 0.45 + 0.75 * blink);
          vec3 pos = position * s;

          mat4 im = instanceMatrix;
          im[3].xyz += drift;
          gl_Position = projectionMatrix * modelViewMatrix * im * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vBlink;

        void main() {
          // Soft alpha falloff; additive blending makes this read as a glow mote.
          float a = clamp(vBlink, 0.0, 1.0) * 0.95;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    // Per-instance seed attribute (used by the shader for blink/drift).
    const attr = new THREE.InstancedBufferAttribute(seedsRef.current, 1);
    mesh.geometry.setAttribute('aSeed', attr);
    // Default to rendering 0 instances until we get a player signal + chunk data.
    mesh.count = 0;
  }, []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!enabled || !mesh) return;
    if (!playerRef.current.hasSignal) return;

    // Global intensity gates (cheap, avoids doing extra work underwater/underground).
    const biomeAtPlayer = BiomeManager.getBiomeAt(playerRef.current.x, playerRef.current.z);
    const biomeFactor = biomeFireflyFactor(biomeAtPlayer);
    const underwaterSuppression = 1.0 - smoothstep(0.05, 0.45, underwaterBlend);
    const undergroundSuppression = 1.0 - smoothstep(0.25, 0.85, undergroundBlend);
    const globalIntensity = biomeFactor * underwaterSuppression * undergroundSuppression;

    const px = playerRef.current.x;
    const pz = playerRef.current.z;
    // Rebuild the visible instance list only when needed:
    // - Player moved far enough (cell boundary)
    // - Chunk fireflies changed (new chunk loaded/unloaded)
    const ax = Math.floor(px / REFRESH_CELL_SIZE) * REFRESH_CELL_SIZE;
    const az = Math.floor(pz / REFRESH_CELL_SIZE) * REFRESH_CELL_SIZE;
    const version = getFireflyRegistryVersion();

    if (!lastRefreshRef.current || lastRefreshRef.current.ax !== ax || lastRefreshRef.current.az !== az || lastRefreshRef.current.version !== version) {
      lastRefreshRef.current = { ax, az, version };

      const r2 = QUERY_RADIUS * QUERY_RADIUS;
      let write = 0;

      forEachChunkFireflies((_key, data) => {
        void _key;
        for (let i = 0; i < data.length && write < MAX_VISIBLE; i += 4) {
          const x = data[i + 0];
          const y = data[i + 1];
          const z = data[i + 2];
          const seed = data[i + 3];

          const dx = x - px;
          const dz = z - pz;
          if (dx * dx + dz * dz > r2) continue;

          // Smaller motes; scale is stored in the instance matrix and animated in shader.
          const h = Math.abs(Math.sin(seed * 437.58)) % 1;
          const baseScale = THREE.MathUtils.lerp(BASE_RADIUS_MIN, BASE_RADIUS_MAX, h);

          dummy.position.set(x, y, z);
          dummy.scale.setScalar(baseScale);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(write, dummy.matrix);
          seedsRef.current[write] = seed;
          write++;
        }
      });

      // Render only the visible instances.
      mesh.count = write;
      mesh.instanceMatrix.needsUpdate = true;
      const seedAttr = mesh.geometry.getAttribute('aSeed') as THREE.InstancedBufferAttribute | undefined;
      if (seedAttr) seedAttr.needsUpdate = true;
    }

    // Keep shader uniforms up to date (cheap).
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;
    material.uniforms.uIntensity.value = THREE.MathUtils.clamp(globalIntensity, 0, 1);
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined as any, undefined as any, MAX_VISIBLE]} frustumCulled={false}>
      {/* Small icosahedrons read as "motes" and avoid looking like UI points. */}
      <icosahedronGeometry args={[1, 0]} />
      <primitive object={material} attach="material" />
    </instancedMesh>
  );
};

/**
 * AmbientLife
 * Entry point for cheap, always-on "early life" ambience: fireflies + distant fog creatures.
 *
 * IMPORTANT:
 * - Uses the existing `player-moved` event as the data source to avoid tight coupling to Player.
 * - Avoids React state updates inside `useFrame()` to keep GC and rerenders low.
 */
export const AmbientLife: React.FC<{ enabled?: boolean }> = ({ enabled = true }) => {
  const playerRef = useRef<PlayerMovedRef>({ x: 0, y: 0, z: 0, rotation: 0, hasSignal: false });

  useEffect(() => {
    if (!enabled) return;

    const handlePlayerMoved = (e: Event) => {
      const ce = e as CustomEvent<PlayerMovedDetail>;
      if (!ce.detail) return;
      playerRef.current.x = ce.detail.x;
      playerRef.current.y = ce.detail.y;
      playerRef.current.z = ce.detail.z;
      playerRef.current.rotation = ce.detail.rotation;
      playerRef.current.hasSignal = true;
    };

    window.addEventListener('player-moved', handlePlayerMoved as EventListener);
    return () => window.removeEventListener('player-moved', handlePlayerMoved as EventListener);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <>
      <FirefliesField enabled={enabled} playerRef={playerRef} />
      <FogDeer enabled={enabled} playerRef={playerRef} />
    </>
  );
};
