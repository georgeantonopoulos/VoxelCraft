import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useControls } from 'leva';
import * as THREE from 'three';

/**
 * TorchTool
 * A lightweight first-person torch that sits in the player's left hand.
 * - Procedural mesh (no assets) to keep load fast.
 * - Procedural camera-facing flame card (FLAME_FRAG) plus tiny instanced embers.
 * - Warm point light with subtle flicker.
 *
 * Keep particle count low and avoid allocations per-frame for performance.
 */
export interface TorchToolProps {
  /**
   * Whether the torch is held. The spotlight stays mounted and visible either
   * way (dimmed to 0): three.js compiles every lit shader for the current
   * light count, so hiding it recompiled all materials on each equip.
   */
  active: boolean;
}

const FLAME_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Procedural teardrop flame: flickering width, upward-scrolling turbulence,
// white-gold core to orange to deep red at the edges. Additive.
const FLAME_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    float y = vUv.y;
    float t = uTime;
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

export const TorchTool: React.FC<TorchToolProps> = ({ active }) => {
  const flameRef = useRef<THREE.Mesh>(null);
  const flameMaterial = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  }), []);
  const parentQuat = useMemo(() => new THREE.Quaternion(), []);
  const torchRef = useRef<THREE.Group>(null);
  const flameLightRef = useRef<THREE.SpotLight>(null);
  const lightTargetRef = useRef<THREE.Object3D>(null);
  const particlesRef = useRef<THREE.InstancedMesh>(null);

  // Preallocated helpers for spotlight aiming (avoid per-frame allocs)
  const forwardWorld = useRef(new THREE.Vector3());
  const lightPosWorld = useRef(new THREE.Vector3());
  const targetWorld = useRef(new THREE.Vector3());
  const downWorld = useRef(new THREE.Vector3(0, -0.35, 0));

  // Debug UI: enable with ?debug in URL (same switch as App).
  const debugMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  }, []);

  // Live-tweak spotlight properties in debug mode.
  const torchLightDebug = useControls(
    'Torch Spotlight',
    {
      enabled: true,
      color: '#ffdbb1',
      baseIntensity: { value: 2.1, min: 0.2, max: 12.0, step: 0.1 },
      distance: { value: 28, min: 4, max: 120, step: 1 },
      decay: { value: 0.4, min: 0, max: 4, step: 0.1 },
      // Three.js spotlight angles effectively cap near 90deg (PI/2).
      angleDeg: { value: 89, min: 5, max: 89, step: 1 },
      penumbra: { value: 1.0, min: 0, max: 1, step: 0.05 },
      targetDistance: { value: 12.0, min: 1.5, max: 12, step: 0.1 },
      downBias: { value: 0.35, min: 0, max: 1.5, step: 0.05 },
      flickerAmount: { value: 0.24, min: 0, max: 0.4, step: 0.01 },
    },
    { hidden: !debugMode, collapsed: true } as any
  );

  // Stable helper objects
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const count = 14;
  const lifetimes = useRef<number[]>(Array.from({ length: count }, () => 0));
  const velocities = useRef<THREE.Vector3[]>(
    Array.from({ length: count }, () => new THREE.Vector3())
  );
  const offsets = useRef<THREE.Vector3[]>(
    Array.from({ length: count }, () => new THREE.Vector3())
  );

  // Seed particles once.
  useEffect(() => {
    for (let i = 0; i < count; i++) {
      lifetimes.current[i] = Math.random() * 0.6;
      velocities.current[i].set(
        (Math.random() - 0.5) * 0.12,
        0.25 + Math.random() * 0.25,
        (Math.random() - 0.5) * 0.12
      );
      offsets.current[i].set(
        (Math.random() - 0.5) * 0.03,
        Math.random() * 0.05,
        (Math.random() - 0.5) * 0.03
      );
    }
  }, []);

  // Wire spotlight target once refs are mounted.
  useEffect(() => {
    if (flameLightRef.current && lightTargetRef.current) {
      flameLightRef.current.target = lightTargetRef.current;
      flameLightRef.current.updateMatrixWorld();
    }
  }, []);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    // Subtle idle sway for the torch itself.
    // Note: Major rotation is now handled by TORCH_POSE in FirstPersonTools.
    // We only apply subtle sway here, not the base orientation.
    if (torchRef.current) {
      torchRef.current.rotation.z = Math.sin(t * 1.8) * 0.015;
      torchRef.current.rotation.x = Math.cos(t * 1.2) * 0.01;
    }

    // Light flicker (small amplitude so it doesn't distract).
    if (flameLightRef.current) {
      const flicker = 1.0 + Math.sin(t * 14.0) * 0.08 + Math.sin(t * 7.0) * 0.04;
      const baseIntensity = debugMode ? torchLightDebug.baseIntensity : 2.1;
      const flickerAmt = debugMode ? torchLightDebug.flickerAmount : 0.24;
      // Scale flicker amount relative to default 0.12.
      const enabled = active && (!debugMode || torchLightDebug.enabled);
      flameLightRef.current.intensity = enabled ? baseIntensity * (1.0 + (flicker - 1.0) * (flickerAmt / 0.12)) : 0;
    }

    // Aim spotlight forward in world space, with a slight downward bias.
    // The FPS rig rotates the torch via TORCH_POSE, so we derive forward from the camera.
    if (torchRef.current && flameLightRef.current && lightTargetRef.current) {
      // Get the camera's forward direction (where player is looking)
      const camera = state.camera;
      forwardWorld.current.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      flameLightRef.current.getWorldPosition(lightPosWorld.current);

      const targetDist = debugMode ? torchLightDebug.targetDistance : 12.0;
      const downBias = debugMode ? torchLightDebug.downBias : 0.35;
      downWorld.current.set(0, -downBias, 0);

      targetWorld.current
        .copy(lightPosWorld.current)
        .addScaledVector(forwardWorld.current, targetDist)
        .add(downWorld.current);

      // Convert to torch local space for the target object.
      torchRef.current.worldToLocal(targetWorld.current);
      lightTargetRef.current.position.copy(targetWorld.current);
      lightTargetRef.current.updateMatrixWorld();
    }

    // Apply debug spotlight properties live.
    if (debugMode && flameLightRef.current) {
      flameLightRef.current.color.set(torchLightDebug.color);
      flameLightRef.current.distance = torchLightDebug.distance;
      flameLightRef.current.decay = torchLightDebug.decay;
      flameLightRef.current.angle = THREE.MathUtils.degToRad(torchLightDebug.angleDeg);
      flameLightRef.current.penumbra = torchLightDebug.penumbra;
    }

    // Flame card faces the camera; time drives the flicker.
    flameMaterial.uniforms.uTime.value += delta;
    const flame = flameRef.current;
    if (flame && flame.parent) {
      flame.parent.getWorldQuaternion(parentQuat);
      flame.quaternion.copy(parentQuat.invert()).multiply(state.camera.quaternion);
    }

    // Particle update: drift upward and respawn in place.
    const mesh = particlesRef.current;
    if (!mesh || !active) return;

    for (let i = 0; i < count; i++) {
      lifetimes.current[i] -= delta;
      if (lifetimes.current[i] <= 0) {
        lifetimes.current[i] = 0.5 + Math.random() * 0.6;
        velocities.current[i].set(
          (Math.random() - 0.5) * 0.12,
          0.25 + Math.random() * 0.25,
          (Math.random() - 0.5) * 0.12
        );
        offsets.current[i].set(
          (Math.random() - 0.5) * 0.03,
          Math.random() * 0.05,
          (Math.random() - 0.5) * 0.03
        );
      }

      // Flame origin relative to torch local space (top).
      dummy.position.set(
        offsets.current[i].x,
        0.66 + offsets.current[i].y,
        offsets.current[i].z
      );
      dummy.position.addScaledVector(velocities.current[i], (0.6 - lifetimes.current[i]) * delta * 60);

      // Soft fade and slight growth.
      const life01 = THREE.MathUtils.clamp(lifetimes.current[i] / 1.1, 0, 1);
      const scale = THREE.MathUtils.lerp(0.004, 0.009, life01); // tiny sparks, shrinking as they rise
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={torchRef}>
      <group visible={active}>
      {/* Torch handle */}
      <mesh position={[0, 0.0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.8, 8]} />
        <meshStandardMaterial color="#6b4a2f" roughness={0.9} metalness={0.0} />
      </mesh>

      {/* Metal collar */}
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.055, 0.055, 0.06, 10]} />
        <meshStandardMaterial color="#3a3a44" roughness={0.4} metalness={0.6} />
      </mesh>

      {/* Flame: a camera-facing procedural card rising from the collar. */}
      <mesh ref={flameRef} position={[0, 0.58, 0]} material={flameMaterial} renderOrder={2}>
        <planeGeometry args={[0.2, 0.34]} />
      </mesh>
      </group>

      {/* Spotlight for forward cave visibility (outside the visibility toggle; see TorchToolProps) */}
      <spotLight
        ref={flameLightRef}
        position={[0, 0.60, 0.0]}
        color="#ffdbb1"
        intensity={2.1}
        distance={28}
        decay={0.4}
        // Wider cone to cover most of player's FOV.
        angle={THREE.MathUtils.degToRad(89)}
        penumbra={1.0}
        castShadow={false} // Keep performance stable
      />
      {/* Spotlight target is aimed each frame in world space. */}
      <group ref={lightTargetRef} position={[0, 0.60, -2.5]} />

      {/* Fire particles (embers) */}
      <instancedMesh visible={active} ref={particlesRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshStandardMaterial
          color="#ffb36b"
          emissive="#ff6b1a"
          emissiveIntensity={1.6}
          transparent
          opacity={0.7}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
};
