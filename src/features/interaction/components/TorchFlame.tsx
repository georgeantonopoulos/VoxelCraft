import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vPhase;
  void main() {
    vUv = uv;
    // Per-torch phase from its world position, so torches don't flicker in sync.
    vec3 o = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vPhase = fract(sin(dot(o.xz, vec2(12.9898, 78.233))) * 43758.5453) * 50.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Procedural teardrop flame: flickering width, upward-scrolling turbulence,
// white-gold core to orange to deep red at the edges. Additive.
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vPhase;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float y = vUv.y;
    float t = uTime + vPhase;
    // Turbulence rises with the flame and sways the tip more than the base.
    float turb = n2(vec2(vUv.x * 4.0, y * 3.0 - t * 2.6)) * 0.6 + n2(vec2(vUv.x * 9.0, y * 6.0 - t * 4.1)) * 0.4;
    float sway = (n2(vec2(t * 0.9, 1.7)) - 0.5) * 0.18 * y * y;
    float x = vUv.x - 0.5 - sway - (turb - 0.5) * 0.12 * y;
    float width = 0.38 * pow(max(1.0 - y, 0.0), 0.7) * smoothstep(0.0, 0.18, y) * (0.85 + 0.3 * turb);
    float body = 1.0 - smoothstep(width * 0.35, max(width, 1e-3), abs(x));
    body *= 1.0 - smoothstep(0.55, 1.0, y + (turb - 0.5) * 0.25);
    float core = (1.0 - smoothstep(0.0, max(width * 0.45, 1e-3), abs(x))) * (1.0 - smoothstep(0.1, 0.55, y));
    vec3 col = mix(vec3(0.75, 0.16, 0.03), vec3(1.0, 0.55, 0.14), body);
    col = mix(col, vec3(1.0, 0.93, 0.72), core);
    float a = clamp(body * 0.9 + core * 0.5, 0.0, 1.0);
    if (a < 0.01) discard;
    gl_FragColor = vec4(col * a * 1.6, a);
  }
`;

/** One shared material for every torch flame (time is set from the clock). */
const flameMaterial = new THREE.ShaderMaterial({
  vertexShader: FLAME_VERT,
  fragmentShader: FLAME_FRAG,
  uniforms: { uTime: { value: 0 } },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
  side: THREE.DoubleSide,
});
const flameGeometry = new THREE.PlaneGeometry(0.2, 0.34);
const tmpQuat = new THREE.Quaternion();

/**
 * TorchFlame: a camera-facing procedural flame card. The card's base sits at
 * `position` minus half its height, so place it just above the torch collar.
 */
export const TorchFlame: React.FC<{ position: [number, number, number]; scale?: number }> = ({ position, scale = 1 }) => {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    flameMaterial.uniforms.uTime.value = state.clock.elapsedTime;
    const m = ref.current;
    if (m && m.parent) {
      m.parent.getWorldQuaternion(tmpQuat);
      m.quaternion.copy(tmpQuat.invert()).multiply(state.camera.quaternion);
    }
  });
  return <mesh ref={ref} position={position} scale={scale} geometry={flameGeometry} material={flameMaterial} renderOrder={2} />;
};
