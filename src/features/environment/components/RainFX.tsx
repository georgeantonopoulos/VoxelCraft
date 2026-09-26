import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { useEnvironmentStore } from '@/state/EnvironmentStore';
import { isSheltered } from '@features/environment/logic/shelter';
import { useWeatherStore } from '@/state/WeatherStore';

/**
 * Slow rain: thin streaks in a cylinder around the camera, falling and
 * wrapping in the shader (no per-frame CPU work). Faint and grey, thicker as
 * the rain builds. Under a roof the streaks clear from a circle around the
 * player; underground there is no rain at all. Also tells the rest of the
 * game whether the player is sheltered (window.__vcSheltered for audio).
 */

const COUNT = 1600;
const RADIUS = 13;
const HEIGHT = 16;
const FALL = 7.5; // m/s: a soft rain, not a storm

const VERT = /* glsl */ `
  attribute vec4 aDrop; // x, z offset, phase, length
  uniform float uTime;
  uniform vec3 uCam;
  uniform float uClear;
  uniform float uRain;
  varying float vA;
  varying float vV;
  void main() {
    float h = ${HEIGHT.toFixed(1)};
    float y = mod(aDrop.z * h - uTime * ${FALL.toFixed(1)}, h) - h * 0.45;
    // Slight slant from a steady breeze.
    vec3 base = vec3(uCam.x + aDrop.x + y * 0.06, uCam.y + y, uCam.z + aDrop.y + y * 0.03);
    // Face the camera (billboard around the vertical axis).
    vec3 side = normalize(vec3(-(uCam.z - base.z), 0.0, uCam.x - base.x) + 1e-4);
    vec3 p = base + side * (position.x * 0.02) + vec3(0.0, position.y * aDrop.w, 0.0);
    float r = length(aDrop.xy);
    // Thin out with distance and clear the circle under a roof.
    float near = 1.0 - smoothstep(${(RADIUS * 0.6).toFixed(1)}, ${RADIUS.toFixed(1)}, r);
    float cleared = uClear * (1.0 - smoothstep(2.6, 3.6, r));
    // Each streak only shows while the rain is at least as heavy as its rank.
    float shown = step(fract(aDrop.z * 7.31), uRain);
    vA = near * (1.0 - cleared) * shown * 0.38;
    vV = position.y + 0.5;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vA;
  varying float vV;
  uniform vec3 uTint;
  void main() {
    float a = vA * smoothstep(0.0, 0.3, vV) * (1.0 - smoothstep(0.7, 1.0, vV));
    if (a < 0.004) discard;
    gl_FragColor = vec4(uTint, a);
  }
`;

export const RainFX: React.FC = () => {
  const { world, rapier } = useRapier();
  const sheltered = useRef(false);
  const clear = useRef(0);
  const nextCheck = useRef(0);

  const mesh = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    const drops = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * RADIUS;
      drops.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), 0.35 + Math.random() * 0.35], i * 4);
    }
    geo.setAttribute('aDrop', new THREE.InstancedBufferAttribute(drops, 4));
    geo.instanceCount = COUNT;
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uClear: { value: 0 },
        uRain: { value: 0 }, uTint: { value: new THREE.Color('#b8c2c8') },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 4;
    return m;
  }, []);

  useFrame((state, delta) => {
    const rain = sharedUniforms.uRain.value;
    const cave = useEnvironmentStore.getState().undergroundBlend;
    const u = (mesh.material as THREE.ShaderMaterial).uniforms;
    mesh.visible = rain > 0.01 && cave < 0.5;
    u.uRain.value = rain * (1 - THREE.MathUtils.smoothstep(cave, 0.2, 0.5));
    u.uTime.value = state.clock.elapsedTime;
    const cam = state.camera.position;
    u.uCam.value.copy(cam);
    // A roof overhead (a few checks a second): clear the rain around you.
    nextCheck.current -= delta;
    if (nextCheck.current <= 0) {
      nextCheck.current = 0.25;
      sheltered.current = isSheltered(world, rapier, cam.x, cam.y, cam.z, 10);
      (window as unknown as { __vcSheltered?: boolean }).__vcSheltered = sheltered.current;
      const w = useWeatherStore.getState();
      if (w.sheltered !== sheltered.current) useWeatherStore.setState({ sheltered: sheltered.current });
    }
    clear.current = THREE.MathUtils.lerp(clear.current, sheltered.current ? 1 : 0, Math.min(1, delta * 4));
    u.uClear.value = clear.current;
  });

  return <primitive object={mesh} />;
};
