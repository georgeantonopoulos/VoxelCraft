import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';

/**
 * ImpactFX: what flies off when a tool meets the world.
 *
 * One event (`emitImpact`) serves knapping, mining, chopping and cutting:
 * - chips: small lit fragments (stone flakes, earth clods, wood splinters,
 *   leaf bits) that arc out, land on the ground, rest a moment and fade;
 * - dust: a soft puff that swells and thins (earth, sand, stone breaking).
 *
 * Everything runs on the GPU from per-particle launch data; the CPU only
 * writes a few attributes per burst. Times come from the render clock
 * (captured in useFrame): stamping bursts with page time put them seconds in
 * the future, so they never appeared.
 */

export type ImpactKind = 'stone' | 'earth' | 'sand' | 'wood' | 'leaf' | 'snow';

export interface ImpactOptions {
  position: THREE.Vector3;
  /** Rough direction chips leave in (away from the surface, toward the player). */
  direction?: THREE.Vector3;
  kind: ImpactKind;
  color: string;
  /** 0.5 = a light tap, 1 = a normal strike, 2 = something breaking. */
  strength?: number;
  /** Ground height chips settle on (defaults to a little below the impact). */
  floorY?: number;
}

export const emitImpact = (opts: ImpactOptions) => {
  window.dispatchEvent(new CustomEvent<ImpactOptions>('vc-impact', { detail: opts }));
};

const MAX_CHIPS = 384;
const MAX_DUST = 48;
const GRAVITY = 15.0;

interface KindProfile {
  chips: number;
  size: [number, number];
  /** Chip proportions (x, y, z) before the random spin. */
  shape: [number, number, number];
  speed: [number, number];
  life: [number, number];
  dust: number;
  dustTint: number; // how much lighter than the surface the dust is
  /** Fall acceleration; leaves drift. */
  gravity: number;
}

const PROFILES: Record<ImpactKind, KindProfile> = {
  stone: { chips: 7, size: [0.018, 0.04], shape: [1.0, 0.35, 0.8], speed: [2.2, 4.2], life: [1.6, 2.4], dust: 0.35, dustTint: 0.35, gravity: GRAVITY },
  earth: { chips: 8, size: [0.03, 0.06], shape: [1.0, 0.8, 0.9], speed: [1.6, 3.2], life: [1.2, 1.8], dust: 1, dustTint: 0.25, gravity: GRAVITY },
  sand: { chips: 5, size: [0.015, 0.03], shape: [1.0, 0.9, 1.0], speed: [1.4, 2.6], life: [0.8, 1.2], dust: 1.4, dustTint: 0.2, gravity: GRAVITY },
  wood: { chips: 7, size: [0.03, 0.06], shape: [0.35, 0.18, 1.6], speed: [2.4, 4.4], life: [1.8, 2.6], dust: 0, dustTint: 0, gravity: GRAVITY },
  leaf: { chips: 8, size: [0.035, 0.055], shape: [1.0, 0.06, 0.7], speed: [0.4, 1.2], life: [3.2, 4.4], dust: 0, dustTint: 0, gravity: 1.6 },
  snow: { chips: 6, size: [0.025, 0.05], shape: [1.0, 0.9, 1.0], speed: [1.2, 2.4], life: [0.8, 1.2], dust: 1, dustTint: 0.1, gravity: GRAVITY },
};

const CHIP_VERT = /* glsl */ `
  attribute vec4 aOrigin;   // xyz, gravity
  attribute vec4 aVel;      // velocity xyz, start time
  attribute vec4 aParams;   // life, size, floorY, spin
  attribute vec3 aShape;
  attribute vec3 aColor;
  uniform float uTime;
  varying vec3 vChipColor;

  mat3 axisAngle(vec3 axis, float a) {
    float s = sin(a), c = cos(a), oc = 1.0 - c;
    return mat3(
      oc * axis.x * axis.x + c,          oc * axis.x * axis.y + axis.z * s, oc * axis.z * axis.x - axis.y * s,
      oc * axis.x * axis.y - axis.z * s, oc * axis.y * axis.y + c,          oc * axis.y * axis.z + axis.x * s,
      oc * axis.z * axis.x + axis.y * s, oc * axis.y * axis.z - axis.x * s, oc * axis.z * axis.z + c
    );
  }

  void main() {
    vChipColor = aColor;
    float age = uTime - aVel.w;
    float life = aParams.x;
    if (age < 0.0 || age > life) {
      csm_Position = vec3(0.0, -9999.0, 0.0);
    } else {
      // Ballistic arc until it meets the floor, then it rests there.
      vec3 v = aVel.xyz;
      float g = aOrigin.w;
      float drop = max(aOrigin.y - aParams.z, 0.0);
      float tLand = (v.y + sqrt(v.y * v.y + 2.0 * g * drop)) / g;
      float t = min(age, tLand);
      vec3 p = aOrigin.xyz + v * t;
      p.y -= 0.5 * g * t * t;
      // Slow fallers (leaves) sway side to side as they drift down.
      float flutter = (1.0 - smoothstep(2.0, 6.0, g)) * sin(t * 3.1 + float(gl_InstanceID)) * 0.25 * min(t, 1.0);
      p.x += flutter;
      p.z += flutter * 0.6;
      if (age >= tLand) p.y = aParams.z;

      // Tumble while flying; landed chips lie still (a little settle roll).
      float fid = float(gl_InstanceID);
      vec3 axis = normalize(vec3(sin(fid * 1.7), cos(fid * 2.3), sin(fid * 0.9 + 1.0)) + 1e-3);
      mat3 rot = axisAngle(axis, aParams.w * t + fid);

      // Shrink away at the end of life.
      float s = aParams.y * (1.0 - smoothstep(life * 0.7, life, age));
      csm_Position = p + rot * (position * aShape * s);
      csm_Normal = rot * normalize(normal / aShape);
    }
  }
`;

const CHIP_FRAG = /* glsl */ `
  varying vec3 vChipColor;
  void main() {
    csm_DiffuseColor = vec4(vChipColor, 1.0);
  }
`;

const DUST_VERT = /* glsl */ `
  attribute vec4 aVel;      // velocity xyz, start time
  attribute vec3 aParams;   // life, size, alpha
  attribute vec3 aColor;
  uniform float uTime;
  uniform float uViewScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float age = uTime - aVel.w;
    float life = aParams.x;
    float k = clamp(age / life, 0.0, 1.0);
    bool live = age >= 0.0 && age <= life;
    // Drifts out and up, slowing as it spreads.
    vec3 p = position + aVel.xyz * (1.0 - exp(-2.2 * max(age, 0.0))) / 2.2;
    p.y += 0.25 * max(age, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aParams.y * (0.45 + 1.1 * sqrt(k));
    gl_PointSize = live ? size * uViewScale / max(-mv.z, 0.1) : 0.0;
    vAlpha = live ? aParams.z * (1.0 - k) * smoothstep(0.0, 0.08, k) : 0.0;
    vColor = aColor;
  }
`;

const DUST_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = exp(-d * d * 3.0) * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export const ImpactFX: React.FC = () => {
  const { size, camera } = useThree();
  const clock = useRef(0);
  const nextChip = useRef(0);
  const nextDust = useRef(0);

  const chips = useMemo(() => {
    const base = new THREE.IcosahedronGeometry(1, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    geo.instanceCount = MAX_CHIPS;
    const attr = (n: number) => new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHIPS * n), n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aOrigin', attr(4));
    geo.setAttribute('aVel', attr(4));
    geo.setAttribute('aParams', attr(4));
    geo.setAttribute('aShape', attr(3));
    geo.setAttribute('aColor', attr(3));
    // Start every slot expired.
    const vel = geo.getAttribute('aVel') as THREE.InstancedBufferAttribute;
    for (let i = 0; i < MAX_CHIPS; i++) vel.setW(i, -1000);
    const mat = new CustomShaderMaterial({
      baseMaterial: THREE.MeshStandardMaterial,
      vertexShader: CHIP_VERT,
      fragmentShader: CHIP_FRAG,
      uniforms: { uTime: { value: 0 } },
      roughness: 0.85,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    return mesh;
  }, []);

  const dust = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const attr = (n: number) => new THREE.BufferAttribute(new Float32Array(MAX_DUST * n), n).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr(3));
    geo.setAttribute('aVel', attr(4));
    geo.setAttribute('aParams', attr(3));
    geo.setAttribute('aColor', attr(3));
    const vel = geo.getAttribute('aVel') as THREE.BufferAttribute;
    for (let i = 0; i < MAX_DUST; i++) vel.setW(i, -1000);
    const mat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { uTime: { value: 0 }, uViewScale: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }, []);

  useEffect(() => () => {
    chips.geometry.dispose();
    (chips.material as THREE.Material).dispose();
    dust.geometry.dispose();
    (dust.material as THREE.Material).dispose();
  }, [chips, dust]);

  useEffect(() => {
    const color = new THREE.Color();
    const tint = new THREE.Color();
    const dir = new THREE.Vector3();
    const side = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    const onImpact = (e: Event) => {
      const o = (e as CustomEvent<ImpactOptions>).detail;
      if (!o?.position) return;
      const prof = PROFILES[o.kind] ?? PROFILES.stone;
      const strength = o.strength ?? 1;
      const now = clock.current;
      const floorY = o.floorY ?? o.position.y - 0.25;
      dir.copy(o.direction ?? up);
      if (dir.lengthSq() < 1e-6) dir.copy(up);
      dir.normalize();
      side.crossVectors(dir, up);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      color.set(o.color);

      // Chips
      const g = chips.geometry;
      const aOrigin = g.getAttribute('aOrigin') as THREE.InstancedBufferAttribute;
      const aVel = g.getAttribute('aVel') as THREE.InstancedBufferAttribute;
      const aParams = g.getAttribute('aParams') as THREE.InstancedBufferAttribute;
      const aShape = g.getAttribute('aShape') as THREE.InstancedBufferAttribute;
      const aColor = g.getAttribute('aColor') as THREE.InstancedBufferAttribute;
      const n = Math.round(prof.chips * strength);
      for (let i = 0; i < n; i++) {
        const idx = nextChip.current;
        nextChip.current = (nextChip.current + 1) % MAX_CHIPS;
        const jitter = o.kind === 'leaf' ? 0.6 : 0.04;
        aOrigin.setXYZW(idx, o.position.x + rand(-jitter, jitter), o.position.y + rand(-0.02, 0.05) + (o.kind === 'leaf' ? rand(-0.4, 0.4) : 0), o.position.z + rand(-jitter, jitter), prof.gravity);
        // A cone around the launch direction, always with some lift.
        const speed = rand(prof.speed[0], prof.speed[1]) * Math.sqrt(strength);
        const spread = 0.9;
        const vx = dir.x + side.x * rand(-spread, spread) + rand(-0.3, 0.3);
        const vy = Math.max(dir.y, 0.2) + rand(0.4, 1.1);
        const vz = dir.z + side.z * rand(-spread, spread) + rand(-0.3, 0.3);
        const len = Math.hypot(vx, vy, vz) || 1;
        aVel.setXYZW(idx, (vx / len) * speed, (vy / len) * speed, (vz / len) * speed, now);
        aParams.setXYZW(idx, rand(prof.life[0], prof.life[1]), rand(prof.size[0], prof.size[1]) * (strength > 1.5 ? 1.3 : 1), floorY + 0.01, rand(6, 14));
        aShape.setXYZ(idx, prof.shape[0] * rand(0.8, 1.2), prof.shape[1] * rand(0.8, 1.3), prof.shape[2] * rand(0.8, 1.2));
        tint.copy(color).multiplyScalar(rand(0.75, 1.15));
        aColor.setXYZ(idx, tint.r, tint.g, tint.b);
      }
      for (const a of [aOrigin, aVel, aParams, aShape, aColor]) a.needsUpdate = true;

      // Dust
      const puffs = Math.round(prof.dust * (strength > 1.5 ? 3 : 1.5));
      if (puffs > 0) {
        const dg = dust.geometry;
        const dPos = dg.getAttribute('position') as THREE.BufferAttribute;
        const dVel = dg.getAttribute('aVel') as THREE.BufferAttribute;
        const dParams = dg.getAttribute('aParams') as THREE.BufferAttribute;
        const dColor = dg.getAttribute('aColor') as THREE.BufferAttribute;
        tint.copy(color).lerp(new THREE.Color('#d8d2c2'), prof.dustTint);
        for (let i = 0; i < puffs; i++) {
          const idx = nextDust.current;
          nextDust.current = (nextDust.current + 1) % MAX_DUST;
          dPos.setXYZ(idx, o.position.x + rand(-0.1, 0.1), o.position.y + rand(0, 0.1), o.position.z + rand(-0.1, 0.1));
          dVel.setXYZW(idx, dir.x * 0.6 + rand(-0.5, 0.5), rand(0.2, 0.6), dir.z * 0.6 + rand(-0.5, 0.5), now);
          dParams.setXYZ(idx, rand(1.0, 1.6), rand(0.5, 0.9) * (strength > 1.5 ? 1.6 : 1), rand(0.22, 0.34));
          dColor.setXYZ(idx, tint.r, tint.g, tint.b);
        }
        for (const a of [dPos, dVel, dParams, dColor]) a.needsUpdate = true;
      }
    };

    window.addEventListener('vc-impact', onImpact);
    return () => window.removeEventListener('vc-impact', onImpact);
  }, [chips, dust]);

  useFrame((state) => {
    clock.current = state.clock.getElapsedTime();
    (chips.material as unknown as { uniforms: Record<string, { value: number }> }).uniforms.uTime.value = clock.current;
    const dm = dust.material as THREE.ShaderMaterial;
    dm.uniforms.uTime.value = clock.current;
    // Point size in world units: pixels per metre at distance 1.
    const persp = camera as THREE.PerspectiveCamera;
    const fov = THREE.MathUtils.degToRad(persp.fov ?? 60);
    dm.uniforms.uViewScale.value = (size.height * state.gl.getPixelRatio()) / (2 * Math.tan(fov / 2));
  });

  return (
    <>
      <primitive object={chips} />
      <primitive object={dust} />
    </>
  );
};
