import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BiomeManager, BiomeType } from '@features/terrain/logic/BiomeManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import type { PlayerMovedRef } from '@features/environment/AmbientLife';

function biomeDeerFactor(biome: BiomeType): number {
  // Keep deer rare and limited to "calm" biomes for v1.
  switch (biome) {
    case 'PLAINS':
      return 1.0;
    case 'THE_GROVE':
      return 0.7;
    case 'JUNGLE':
      return 0.25;
    case 'MOUNTAINS':
      return 0.12;
    case 'BEACH':
    case 'DESERT':
    case 'RED_DESERT':
    case 'SNOW':
    case 'ICE_SPIKES':
    case 'SKY_ISLANDS':
    default:
      return 0.0;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * FogDeer
 * Distant, fog-band silhouettes that flee when approached.
 *
 * Rendering: instanced planes + procedural SDF silhouette shader (no new textures/assets).
 * Simulation: low-frequency tick (15–30 Hz), state in refs (no per-frame React state).
 */
export const FogDeer: React.FC<{
  enabled: boolean;
  playerRef: React.MutableRefObject<PlayerMovedRef>;
}> = ({ enabled, playerRef }) => {
  const { scene, camera } = useThree();
  const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
  const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

  const debugConfig = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      // Useful for headless verification: keep at least one deer in front of the camera so it shows in screenshots.
      spawnFront: params.has('vcDeerFront'),
      // Debug: spawn deer much closer to the player so you can verify the silhouette quickly.
      // Normal gameplay should keep deer as distant fog-band glimpses.
      // Alias `vcDeerNeer` exists because it's easy to typo and we still want a useful debug toggle.
      spawnNear: params.has('vcDeerNear') || params.has('vcDeerNeer'),
      // Debug: force a single, always-visible "inspection" deer near the camera.
      // This makes it obvious what the silhouette looks like without relying on biome gates/spawn chance.
      staticInspect: params.has('vcDeerStatic'),
      // Useful for headless verification: force a flee cycle without player movement.
      autoScare: params.has('vcDeerAutoScare'),
    };
  }, []);

  // Keep count low: the goal is glimpses, not herds.
  // Increased from 3 to 5 for better visibility.
  const COUNT = 5;

  // Simulation params.
  const SCARE_RADIUS = 32;
  const RUN_SPEED = 12.0;
  const IDLE_SPEED = 0.45;
  const TICK_HZ = 20;
  // Increased size for better visibility in fog
  const DEER_HEIGHT = 3.0;
  const DEER_WIDTH = 4.0;
  const DEER_HALF_HEIGHT = DEER_HEIGHT * 0.5;

  // Deer state is stored in typed arrays to avoid GC churn.
  const px = useRef<Float32Array>(new Float32Array(COUNT));
  const py = useRef<Float32Array>(new Float32Array(COUNT));
  const pz = useRef<Float32Array>(new Float32Array(COUNT));
  const vx = useRef<Float32Array>(new Float32Array(COUNT));
  const vz = useRef<Float32Array>(new Float32Array(COUNT));
  const opacity = useRef<Float32Array>(new Float32Array(COUNT));
  const targetOpacity = useRef<Float32Array>(new Float32Array(COUNT));
  const phase = useRef<Float32Array>(new Float32Array(COUNT));
  const seed = useRef<Float32Array>(new Float32Array(COUNT));
  const mode = useRef<Uint8Array>(new Uint8Array(COUNT)); // 0 idle, 1 flee, 2 cooldown
  const cooldown = useRef<Float32Array>(new Float32Array(COUNT));
  const aliveFor = useRef<Float32Array>(new Float32Array(COUNT)); // seconds since last respawn

  // Rendering.
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);

  // Attribute refs (so we can flag needsUpdate without poking into mesh internals).
  const aOpacityRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Fixed-step sim.
  const accumulator = useRef(0);

  const material = useMemo(() => {
    // IMPORTANT: When `fog: true` on a ShaderMaterial, we must provide the fog uniforms.
    // Otherwise Three will try to update `fogColor/fogNear/fogFar` and crash with
    // `refreshFogUniforms -> Cannot read properties of undefined (reading 'value')`.
    // NOTE: Clone fog uniforms explicitly (instead of relying on merge) so we always get
    // `fogColor/fogNear/fogFar` (and `fogDensity`) as proper `{ value: ... }` uniforms.
    const uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#1a1b1c') }, // Slightly brighter for visibility
    } satisfies Record<string, THREE.IUniform>;

    // NOTE: No GLSL version pragma here; the repo mixes shader versions and we must not force it.
    const vertexShader = `
      varying vec2 vUv;
      varying float vPhase;
      varying float vOpacity;
      varying float vSeed;

      attribute float aPhase;
      attribute float aOpacity;
      attribute float aSeed;

      #include <common>
      #include <fog_pars_vertex>

      void main() {
        vUv = uv;
        vPhase = aPhase;
        vOpacity = aOpacity;
        vSeed = aSeed;

        vec4 worldPos = instanceMatrix * vec4(position, 1.0);
        vec4 mvPosition = modelViewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform vec3 uColor;

      varying vec2 vUv;
      varying float vPhase;
      varying float vOpacity;
      varying float vSeed;

      #include <common>
      #include <fog_pars_fragment>

      float hash21(vec2 p) {
        // Tiny hash for dithering/noise. Keeps the silhouette from looking "too perfect".
        p = fract(p * vec2(123.34, 345.45));
        p += dot(p, p + 34.345);
        return fract(p.x * p.y);
      }

      float sdEllipse(vec2 p, vec2 r) {
        // Approx ellipse SDF: scale-space circle distance.
        p /= r;
        return length(p) - 1.0;
      }

      float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
        vec2 pa = p - a;
        vec2 ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h) - r;
      }

      float deerSdf(vec2 p, float gait) {
        // Coordinate space: p in roughly [-1..1], with deer centered slightly above midline.
        // A deer-ish silhouette from unions of ellipses/capsules.

        // Body
        float d = sdEllipse(p - vec2(-0.10, -0.10), vec2(0.62, 0.25));

        // Chest / rump bulge
        d = min(d, sdEllipse(p - vec2(-0.42, -0.08), vec2(0.26, 0.22)));
        d = min(d, sdEllipse(p - vec2(0.10, -0.12), vec2(0.30, 0.23)));

        // Neck and head
        d = min(d, sdCapsule(p, vec2(0.22, 0.02), vec2(0.52, 0.18), 0.10));
        d = min(d, sdEllipse(p - vec2(0.62, 0.20), vec2(0.18, 0.14)));

        // Ear hint (tiny triangle-ish using capsule)
        d = min(d, sdCapsule(p, vec2(0.68, 0.33), vec2(0.62, 0.24), 0.05));

        // Legs: animate with a simple gait (front/back alternating).
        float legSwingA = gait * 0.18;
        float legSwingB = -gait * 0.18;

        // Rear legs
        d = min(d, sdCapsule(p, vec2(-0.38 + legSwingA, -0.25), vec2(-0.40, -0.85), 0.07));
        d = min(d, sdCapsule(p, vec2(-0.16 + legSwingB, -0.25), vec2(-0.18, -0.88), 0.07));

        // Front legs
        d = min(d, sdCapsule(p, vec2(0.06 + legSwingB, -0.25), vec2(0.04, -0.86), 0.065));
        d = min(d, sdCapsule(p, vec2(0.26 + legSwingA, -0.22), vec2(0.24, -0.80), 0.06));

        // Tail hint
        d = min(d, sdEllipse(p - vec2(-0.62, 0.02), vec2(0.10, 0.08)));

        return d;
      }

      void main() {
        // Map UV to a more deer-friendly space.
        vec2 p = (vUv - 0.5) * 2.0;
        p.x *= 1.25;
        p.y = (p.y + 0.15) * 1.05;

        // Slight bob during gait so "running away" doesn't read like a sliding sticker.
        float gait = sin(uTime * 6.0 + vPhase * 6.2831853);
        p.y += gait * 0.03;

        float d = deerSdf(p, gait);
        float aa = fwidth(d) * 1.35 + 0.01;
        float alpha = smoothstep(aa, -aa, d);

        // Soft edge dissolve (helps hide respawns and reduces popping).
        float n = hash21(vUv * 64.0 + vSeed * 10.0);
        alpha *= smoothstep(0.15, 0.95, vOpacity);
        alpha *= smoothstep(0.05, 0.65, alpha + (n - 0.5) * 0.05);

        if (alpha < 0.01) discard;

        vec3 col = uColor;
        gl_FragColor = vec4(col, alpha);

        #include <fog_fragment>
      }
    `;

    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      fog: true,
    });

    // Keep silhouette stable in postprocessing; we want it to read as a distant dark shape.
    mat.toneMapped = false;
    return mat;
  }, []);
  const ensuredFogUniformsRef = useRef(false);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(DEER_WIDTH, DEER_HEIGHT, 1, 1);

    // Instanced attributes are created once and then updated by reference.
    const aPhase = new THREE.InstancedBufferAttribute(phase.current, 1);
    const aOpacity = new THREE.InstancedBufferAttribute(opacity.current, 1);
    const aSeed = new THREE.InstancedBufferAttribute(seed.current, 1);
    aOpacityRef.current = aOpacity;

    geo.setAttribute('aPhase', aPhase);
    geo.setAttribute('aOpacity', aOpacity);
    geo.setAttribute('aSeed', aSeed);

    return geo;
  }, []);

  useEffect(() => {
    // Seed initial state (no allocations in the render loop).
    const rand = (() => {
      let s = 424242;
      return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return (s & 0xfffffff) / 0xfffffff;
      };
    })();

    for (let i = 0; i < COUNT; i++) {
      phase.current[i] = rand() * Math.PI * 2;
      seed.current[i] = rand();
      opacity.current[i] = 0;
      targetOpacity.current[i] = 0;
      mode.current[i] = 2; // cooldown until we have a player signal
      // Default: stagger initial spawns slightly.
      // Debug (`?vcDeerNear`): spawn immediately after the first player signal.
      cooldown.current[i] = debugConfig.spawnNear ? 0.0 : 0.5 + rand() * 1.0;
      aliveFor.current[i] = 0;
      px.current[i] = 0;
      py.current[i] = 0;
      pz.current[i] = 0;
      vx.current[i] = 0;
      vz.current[i] = 0;
    }

    const attr = aOpacityRef.current;
    if (attr) attr.needsUpdate = true;
  }, []);

  const getFogFar = (): number => {
    const fog = scene.fog as THREE.Fog | undefined;
    if (!fog) return 90;
    if (typeof fog.far === 'number') return fog.far;
    return 90;
  };

  const isSuppressed = (): boolean => {
    // Do not spawn deer underground/underwater; it should be a distant surface glimpse.
    if (undergroundBlend > 0.2) return true;
    if (underwaterBlend > 0.1) return true;
    return false;
  };

  /**
   * Attempts to respawn a deer inside the fog annulus near the player.
   * Returns true if successful.
   */
  const respawnDeer = (i: number): boolean => {
    if (!playerRef.current.hasSignal) return false;

    const fogFar = Math.max(30, getFogFar());
    // Normal: keep deer in a far fog annulus.
    // Debug (`?vcDeerNear`): pull them close so they’re easy to spot immediately.
    const innerR = debugConfig.spawnNear ? 7.0 : fogFar * 0.40;
    const outerR = debugConfig.spawnNear ? 14.0 : fogFar * 0.70;

    const baseBiome = BiomeManager.getBiomeAt(playerRef.current.x, playerRef.current.z);
    // If the player's biome doesn't support deer, keep the whole system quiet.
    if (biomeDeerFactor(baseBiome) <= 0.01) return false;

    // Try a handful of random spots; if none match, we skip this deer for now.
    for (let attempt = 0; attempt < 8; attempt++) {
      // Default: pseudo-random angle derived from seed.
      let a = (seed.current[i] * 1000.0 + attempt * 13.37) % (Math.PI * 2);
      if (debugConfig.spawnFront) {
        // `playerRef.rotation` is a minimap-friendly angle; convert to world polar angle where 0 rad is +X.
        // This keeps one deer roughly "in front" at spawn for screenshot verification.
        const forwardAngle = -playerRef.current.rotation - Math.PI / 2;
        a = forwardAngle + (i - 1) * 0.45 + attempt * 0.18;
      }
      const t = ((seed.current[i] * 997.0 + attempt * 0.73) % 1.0);
      const r = THREE.MathUtils.lerp(innerR, outerR, t);

      const wx = playerRef.current.x + Math.cos(a) * r;
      const wz = playerRef.current.z + Math.sin(a) * r;
      const biome = BiomeManager.getBiomeAt(wx, wz);
      if (biomeDeerFactor(biome) <= 0.05) continue;

      const surfaceY = TerrainService.getHeightAt(wx, wz);

      px.current[i] = wx;
      pz.current[i] = wz;
      // Store "feet Y" so render can place the plane with its bottom at the surface.
      py.current[i] = surfaceY;

      // Idle tangential drift around the player.
      const tangentX = -Math.sin(a);
      const tangentZ = Math.cos(a);
      vx.current[i] = tangentX * IDLE_SPEED;
      vz.current[i] = tangentZ * IDLE_SPEED;

      opacity.current[i] = 0.0;
      targetOpacity.current[i] = 1.0;
      mode.current[i] = 0;
      cooldown.current[i] = 0;
      aliveFor.current[i] = 0;
      return true;
    }

    return false;
  };

  const tickSim = (dt: number) => {
    if (!enabled) return;
    if (!playerRef.current.hasSignal) return;

    // Suppression: fade out quickly and stay cooldown until back on surface.
    if (isSuppressed()) {
      for (let i = 0; i < COUNT; i++) {
        targetOpacity.current[i] = 0;
        mode.current[i] = 2;
        cooldown.current[i] = Math.max(cooldown.current[i], 0.5);
        vx.current[i] = 0;
        vz.current[i] = 0;
      }
      return;
    }

    const fogFar = Math.max(30, getFogFar());
    // Match the closer spawn range
    const innerR = fogFar * 0.40;
    const outerR = fogFar * 0.70;

    const playerX = playerRef.current.x;
    const playerZ = playerRef.current.z;

    for (let i = 0; i < COUNT; i++) {
      // Cooldown / spawn management.
      if (mode.current[i] === 2) {
        cooldown.current[i] -= dt;
        targetOpacity.current[i] = 0;
        if (cooldown.current[i] <= 0) {
          const ok = respawnDeer(i);
          if (!ok) {
            // Try again later.
            cooldown.current[i] = 1.0;
          }
        }
        continue;
      }

      aliveFor.current[i] += dt;

      const dx = px.current[i] - playerX;
      const dz = pz.current[i] - playerZ;
      const dist = Math.hypot(dx, dz);

      // If it gets too close to the player (or fog band shrinks), fade out and respawn.
      if (dist < innerR * 0.85) {
        targetOpacity.current[i] = 0;
        if (opacity.current[i] < 0.08) {
          mode.current[i] = 2;
          cooldown.current[i] = 1.0;
        }
        continue;
      }

      // If it runs out too far, fade and respawn.
      if (dist > outerR * 1.25) {
        targetOpacity.current[i] = 0;
        if (opacity.current[i] < 0.08) {
          mode.current[i] = 2;
          cooldown.current[i] = 0.6;
        }
        continue;
      }

      // Scare trigger (plus optional debug auto-scare for headless verification).
      const shouldScare =
        (mode.current[i] === 0 && dist < SCARE_RADIUS) ||
        (debugConfig.autoScare && i === 0 && mode.current[i] === 0 && aliveFor.current[i] > 2.0);

      if (shouldScare) {
        mode.current[i] = 1;
        // Flee directly away, with small lateral noise so it doesn't look robotic.
        const safeDist = Math.max(0.001, dist);
        const inv = 1.0 / safeDist;
        const awayX = dx * inv;
        const awayZ = dz * inv;
        const lateral = (seed.current[i] * 2 - 1) * 0.35;
        const fleeX = awayX + -awayZ * lateral;
        const fleeZ = awayZ + awayX * lateral;
        const inv2 = 1.0 / Math.max(0.001, Math.hypot(fleeX, fleeZ));
        vx.current[i] = fleeX * inv2 * RUN_SPEED;
        vz.current[i] = fleeZ * inv2 * RUN_SPEED;
      }

      // Keep deer within the fog annulus: if too near the outer edge while fleeing, curve tangentially.
      if (mode.current[i] === 1 && dist > outerR * 0.98) {
        const inv = 1.0 / Math.max(0.001, dist);
        const nx = dx * inv;
        const nz = dz * inv;
        // Tangent around the player to stay inside the band.
        const tx = -nz;
        const tz = nx;
        const dirT = seed.current[i] < 0.5 ? 1 : -1;
        vx.current[i] = tx * RUN_SPEED * 0.65 * dirT;
        vz.current[i] = tz * RUN_SPEED * 0.65 * dirT;
      }

      // Integrate (ghost movement; far silhouettes don't need collision).
      px.current[i] += vx.current[i] * dt;
      pz.current[i] += vz.current[i] * dt;

      // Height: update occasionally (cheap enough at low tick rate).
      const surfaceY = TerrainService.getHeightAt(px.current[i], pz.current[i]);
      py.current[i] = surfaceY;

      // Biome gating: if it wanders into a "no deer" biome, fade and respawn.
      const biome = BiomeManager.getBiomeAt(px.current[i], pz.current[i]);
      if (biomeDeerFactor(biome) <= 0.01) {
        targetOpacity.current[i] = 0;
        if (opacity.current[i] < 0.08) {
          mode.current[i] = 2;
          cooldown.current[i] = 1.2;
        }
        continue;
      }

      targetOpacity.current[i] = 1.0;

      // When fleeing, slowly decay back to idle drift over time (keeps behavior from being "forever running").
      if (mode.current[i] === 1 && dist > SCARE_RADIUS * 1.75) {
        mode.current[i] = 0;
        // Recompute a mild tangential drift at the current angle.
        const a = Math.atan2(pz.current[i] - playerZ, px.current[i] - playerX);
        vx.current[i] = -Math.sin(a) * IDLE_SPEED;
        vz.current[i] = Math.cos(a) * IDLE_SPEED;
      }
    }
  };

  useFrame((state, dt) => {
    if (!enabled) return;
    if (!meshRef.current) return;

    // Defensive: ensure fog uniforms exist before the first program compile.
    // Some Three paths will blindly call `refreshFogUniforms()` when `material.fog === true`.
    if (!ensuredFogUniformsRef.current) {
      const u = material.uniforms as unknown as Record<string, THREE.IUniform | undefined>;
      if (!u.fogColor) u.fogColor = { value: new THREE.Color('#87CEEB') };
      if (!u.fogNear) u.fogNear = { value: 1 };
      if (!u.fogFar) u.fogFar = { value: 2000 };
      if (!u.fogDensity) u.fogDensity = { value: 0.00025 };
      ensuredFogUniformsRef.current = true;
    }

    // Keep uniforms in sync.
    (material.uniforms as any).uTime.value = state.clock.elapsedTime;

    // Debug: render a single deer near the camera for easy inspection.
    // This bypasses biome gating/spawn logic entirely and keeps the deer "always on".
    if (debugConfig.staticInspect) {
      camera.getWorldDirection(tmpDir);
      tmpPos.copy(camera.position).addScaledVector(tmpDir, 6.0);
      // Keep the inspection deer planted on the terrain (not "sinking" through it).
      tmpPos.y = TerrainService.getHeightAt(tmpPos.x, tmpPos.z);

      px.current[0] = tmpPos.x;
      py.current[0] = tmpPos.y;
      pz.current[0] = tmpPos.z;
      opacity.current[0] = 1.0;
      targetOpacity.current[0] = 1.0;

      // Hide all other instances so only one deer is visible.
      for (let i = 1; i < COUNT; i++) {
        opacity.current[i] = 0.0;
        targetOpacity.current[i] = 0.0;
      }
      const opacityAttr = aOpacityRef.current;
      if (opacityAttr) opacityAttr.needsUpdate = true;

      // Place instance 0 facing the camera.
      const yawToCamera = Math.atan2(camera.position.x - px.current[0], camera.position.z - pz.current[0]);
      dummy.position.set(px.current[0], py.current[0] + DEER_HALF_HEIGHT, pz.current[0]);
      dummy.rotation.set(0, yawToCamera, 0);
      dummy.scale.setScalar(2.0);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(0, dummy.matrix);

      // Force-hide the remaining instance transforms (so we don't depend on prior frame state).
      for (let i = 1; i < COUNT; i++) {
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }

      meshRef.current.instanceMatrix.needsUpdate = true;
      return;
    }

    // Fixed-step sim (keeps behavior stable across frame rate).
    accumulator.current += dt;
    const step = 1 / TICK_HZ;
    while (accumulator.current >= step) {
      tickSim(step);
      accumulator.current -= step;
    }

    // Smooth opacity (runs every frame for nice fades).
    for (let i = 0; i < COUNT; i++) {
      const o = opacity.current[i];
      const to = targetOpacity.current[i];
      opacity.current[i] = THREE.MathUtils.lerp(o, to, 1 - Math.pow(0.0001, dt)); // frame-rate independent-ish
    }
    const opacityAttr = aOpacityRef.current;
    if (opacityAttr) opacityAttr.needsUpdate = true;

    // Billboard around Y so the silhouette stays readable in the fog.
    // The deer never comes close, so this reads as a distant "shape" rather than a 3D rig.
    for (let i = 0; i < COUNT; i++) {
      const o = opacity.current[i];
      if (o < 0.02) {
        // Keep it far below ground to ensure it won't flicker if opacity is tiny.
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0.0001);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        continue;
      }

      const yawToCamera = Math.atan2(camera.position.x - px.current[i], camera.position.z - pz.current[i]);
      // Position the instanced plane so its bottom edge sits on the sampled terrain height.
      dummy.position.set(px.current[i], py.current[i] + DEER_HALF_HEIGHT, pz.current[i]);
      dummy.rotation.set(0, yawToCamera, 0);

      // Slight scale variance per deer to avoid clones.
      const size = THREE.MathUtils.lerp(0.95, 1.15, seed.current[i]);
      dummy.scale.set(size, size, size);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, COUNT]} frustumCulled={false} />
  );
};
