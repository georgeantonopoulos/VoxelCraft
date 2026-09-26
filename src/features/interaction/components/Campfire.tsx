import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createGroundStickGeometry, createStoneGeometry } from '@core/items/ItemGeometry';
import { PooledPointLight, type VirtualPointLight } from '@core/graphics/PointLightPool';
import { TorchFlame } from './TorchFlame';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

/**
 * A Keeper's campfire: a ring of stones, a tepee of charred branches over a
 * bed of glowing coals, layered flames, a thin wisp of smoke and a few embers
 * drifting up. The light breathes with the flames. Replaces three salmon
 * cylinders over an orange ball.
 */

const STONES = 8;
const BRANCHES = 5;
const EMBERS = 14;
const SMOKE = 10;

const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#6f6b63', roughness: 0.95 });
const charMaterial = new THREE.MeshStandardMaterial({ color: '#2a221c', roughness: 0.95 });
const coalMaterial = new THREE.MeshStandardMaterial({ color: '#1c1512', roughness: 0.8, emissive: new THREE.Color('#ff6a1f'), emissiveIntensity: 1.6, toneMapped: false });

const hash = (n: number) => { const x = Math.sin(n * 91.3458) * 47453.5453; return x - Math.floor(x); };

const EMBER_VERT = /* glsl */ `
  attribute vec4 aSeed; // phase, speed, drift, size
  uniform float uTime;
  uniform float uViewScale;
  varying float vA;
  void main() {
    float life = 2.2;
    float t = mod(uTime * aSeed.y + aSeed.x * life, life);
    float k = t / life;
    vec3 p = position;
    p.y += t * 0.55;
    p.x += sin(t * 3.0 + aSeed.x * 20.0) * aSeed.z * k;
    p.z += cos(t * 2.3 + aSeed.x * 11.0) * aSeed.z * k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSeed.w * uViewScale / max(-mv.z, 0.1);
    vA = (1.0 - k) * smoothstep(0.0, 0.1, k) * (0.6 + 0.4 * sin(uTime * 17.0 + aSeed.x * 40.0));
  }
`;
const EMBER_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 5.0) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * a * 2.0, a);
  }
`;
const SMOKE_VERT = /* glsl */ `
  attribute vec2 aSeed; // phase, drift
  uniform float uTime;
  uniform float uViewScale;
  uniform float uLight;
  varying float vA;
  void main() {
    float life = 6.0;
    float t = mod(uTime + aSeed.x * life, life);
    float k = t / life;
    vec3 p = position;
    p.y += 0.5 + t * 0.45;
    p.x += sin(t * 0.6 + aSeed.x * 6.0) * 0.25 * k + aSeed.y * k;
    p.z += cos(t * 0.5 + aSeed.x * 4.0) * 0.2 * k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.3 + 0.9 * k) * uViewScale / max(-mv.z, 0.1);
    vA = 0.09 * smoothstep(0.0, 0.15, k) * (1.0 - smoothstep(0.45, 1.0, k));
  }
`;
const SMOKE_FRAG = /* glsl */ `
  uniform float uLight;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    // Falls to zero at the sprite edge (the plain Gaussian left square edges).
    float a = exp(-d * d * 2.5) * (1.0 - smoothstep(0.6, 1.0, d)) * vA;
    if (a < 0.004) discard;
    // Smoke is only as bright as its surroundings (it glowed white at night).
    gl_FragColor = vec4(vec3(0.62, 0.62, 0.6) * uLight, a);
  }
`;

export const Campfire: React.FC<{ intensity?: number; color?: string }> = ({ intensity = 2.5, color = '#ffaa55' }) => {
  const lightRef = useRef<VirtualPointLight>(null);

  const stones = useMemo(() => Array.from({ length: STONES }, (_, i) => {
    const a = (i / STONES) * Math.PI * 2 + hash(i) * 0.3;
    const r = 0.36 + hash(i + 9) * 0.05;
    return {
      geo: createStoneGeometry(false, i % 4),
      pos: [Math.cos(a) * r, -0.12, Math.sin(a) * r] as [number, number, number],
      rot: [hash(i + 3) * 0.6, hash(i + 5) * 6.28, hash(i + 7) * 0.4] as [number, number, number],
      s: 0.34 + hash(i + 11) * 0.12,
    };
  }), []);

  const branch = useMemo(() => createGroundStickGeometry(), []);
  const branches = useMemo(() => Array.from({ length: BRANCHES }, (_, i) => {
    const a = (i / BRANCHES) * Math.PI * 2 + hash(i + 20) * 0.4;
    // Base outside the coals, leaning in so the tips cross over the fire (tepee).
    const lean = 0.5 + hash(i + 21) * 0.15;
    const inward = new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
    const dir = inward.multiplyScalar(Math.sin(lean)).setY(Math.cos(lean)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const base = new THREE.Vector3(Math.cos(a) * 0.24, -0.12, Math.sin(a) * 0.24);
    return { q, base, len: 0.5 + hash(i + 22) * 0.12 };
  }), []);

  const embers = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(EMBERS * 3);
    const seed = new Float32Array(EMBERS * 4);
    for (let i = 0; i < EMBERS; i++) {
      pos.set([(hash(i + 40) - 0.5) * 0.2, 0.05, (hash(i + 41) - 0.5) * 0.2], i * 3);
      seed.set([hash(i + 42), 0.6 + hash(i + 43) * 0.7, 0.05 + hash(i + 44) * 0.12, 0.02 + hash(i + 45) * 0.02], i * 4);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG,
      uniforms: { uTime: { value: 0 }, uViewScale: { value: 800 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
  }, []);

  const smoke = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(SMOKE * 3);
    const seed = new Float32Array(SMOKE * 2);
    for (let i = 0; i < SMOKE; i++) {
      pos.set([(hash(i + 60) - 0.5) * 0.1, 0, (hash(i + 61) - 0.5) * 0.1], i * 3);
      seed.set([i / SMOKE, (hash(i + 62) - 0.5) * 0.3], i * 2);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    const m = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      uniforms: { uTime: { value: 0 }, uViewScale: { value: 800 }, uLight: { value: 1 } },
      transparent: true, depthWrite: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const cam = state.camera as THREE.PerspectiveCamera;
    const viewScale = (state.size.height * state.gl.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov ?? 60) / 2));
    for (const pts of [embers, smoke]) {
      const u = (pts.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = t;
      u.uViewScale.value = viewScale;
    }
    const fc = sharedUniforms.uFogColor.value as THREE.Color;
    (smoke.material as THREE.ShaderMaterial).uniforms.uLight.value =
      THREE.MathUtils.clamp((fc.r * 0.2126 + fc.g * 0.7152 + fc.b * 0.0722) * 1.5, 0.08, 1);
    // The light and the coals breathe with the flames.
    const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1.3) + 0.04 * Math.sin(t * 23.7);
    if (lightRef.current) lightRef.current.intensity = intensity * flicker;
    coalMaterial.emissiveIntensity = 1.3 + 0.5 * flicker;
  });

  return (
    <group position={[0, 0.1, 0]}>
      {stones.map((s, i) => (
        <mesh key={`s${i}`} geometry={s.geo} material={stoneMaterial} position={s.pos} rotation={s.rot} scale={s.s} castShadow receiveShadow />
      ))}
      {/* Coal bed */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <mesh key={`c${i}`} geometry={stones[i].geo} material={coalMaterial}
          position={[(hash(i + 80) - 0.5) * 0.22, -0.13, (hash(i + 81) - 0.5) * 0.22]} scale={0.16 + hash(i + 82) * 0.08} />
      ))}
      {branches.map((b, i) => (
        <group key={`b${i}`} position={b.base} quaternion={b.q}>
          <mesh geometry={branch} material={charMaterial} position={[0, b.len * 0.5, 0]} scale={[0.036, b.len, 0.036]} castShadow />
        </group>
      ))}
      <TorchFlame position={[0, 0.2, 0]} scale={2.4} />
      <TorchFlame position={[0.06, 0.14, 0.04]} scale={1.7} />
      <TorchFlame position={[-0.07, 0.12, -0.03]} scale={1.5} />
      <primitive object={embers} />
      <primitive object={smoke} />
      <PooledPointLight ref={lightRef} position={[0, 1.5, 0]} intensity={intensity} distance={10} color={color} decay={2} />
    </group>
  );
};
