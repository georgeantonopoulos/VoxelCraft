import * as THREE from 'three';
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useEnvironmentStore } from '@state/EnvironmentStore';

/**
 * DynamicEnvironmentIBL
 *
 * Creates a lightweight, time-of-day aware environment map (IBL) using a procedural Sky.
 * This improves PBR specular response (sand/stone/obsidian/ice) without adding per-fragment shader cost.
 *
 * Notes:
 * - We intentionally update infrequently (quantized sun height + time interval) because PMREM is expensive.
 * - When the player is deep underground we switch to a neutral "room" environment to avoid bright sky
 *   reflections in caves (a cheap approximation of occluded sky lighting).
 */
export const DynamicEnvironmentIBL: React.FC<{
  /** Mutable sun direction vector (updated by SunFollower). */
  sunDirection: THREE.Vector3;
  /** Cube resolution for the captured sky map (before PMREM). */
  resolution?: number;
  /** Minimum seconds between PMREM refreshes. */
  minUpdateSeconds?: number;
  /** Global environment intensity multiplier applied to PBR materials. */
  intensity?: number;
  /** Allow disabling IBL entirely (debug sliders). */
  enabled?: boolean;
}> = ({ sunDirection, resolution = 96, minUpdateSeconds = 6, intensity = 1.0, enabled = true }) => {
  const { gl, scene } = useThree();
  const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
  const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);
  const skyVisibility = useEnvironmentStore((s) => s.skyVisibility);

  const envScene = useMemo(() => new THREE.Scene(), []);
  const sky = useMemo(() => {
    const s = new Sky();
    // Big enough that CubeCamera rays always hit sky.
    s.scale.setScalar(1000);
    return s;
  }, []);
  const cubeRT = useMemo(
    () =>
      new THREE.WebGLCubeRenderTarget(resolution, {
        // Half-float improves banding on sky gradients without big VRAM cost.
        type: THREE.HalfFloatType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
      }),
    [resolution]
  );
  const cubeCam = useMemo(() => new THREE.CubeCamera(0.1, 2000, cubeRT), [cubeRT]);

  const pmrem = useMemo(() => new THREE.PMREMGenerator(gl), [gl]);
  const roomEnv = useMemo(() => new RoomEnvironment(), []);
  const roomPMREM = useRef<THREE.Texture | null>(null);
  const lastPMREMRT = useRef<THREE.WebGLRenderTarget | null>(null);

  const lastUpdateAt = useRef(0);
  const lastKey = useRef<string>('');

  // Shared temp vectors to avoid allocations in the frame loop.
  const tmpSun = useRef(new THREE.Vector3());

  const applyEnvIntensity = (mul: number) => {
    // Apply a global multiplier to all materials that support envMapIntensity.
    // We store each material's "base" intensity once so we can re-apply safely.
    scene.traverse((obj) => {
      // @ts-expect-error - Three Object3D may have material.
      const mat = obj.material as any;
      if (!mat) return;
      const applyToMaterial = (m: any) => {
        if (typeof m?.envMapIntensity !== 'number') return;
        m.userData = m.userData || {};
        if (typeof m.userData.vcEnvMapIntensityBase !== 'number') {
          m.userData.vcEnvMapIntensityBase = m.envMapIntensity;
        }
        m.envMapIntensity = m.userData.vcEnvMapIntensityBase * mul;
      };
      if (Array.isArray(mat)) mat.forEach(applyToMaterial);
      else applyToMaterial(mat);
    });
  };

  useEffect(() => {
    envScene.add(sky);
    // Precompute a neutral indoor environment once.
    const rt = pmrem.fromScene(roomEnv, 0.04);
    roomPMREM.current = rt.texture;
    return () => {
      // Clean up GPU resources on unmount.
      lastPMREMRT.current?.dispose();
      cubeRT.dispose();
      pmrem.dispose();
      rt.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }) => {
    if (!enabled) {
      // Disable IBL: clear environment and force envMapIntensity to 0 once.
      if (lastKey.current !== 'off') {
        lastKey.current = 'off';
        scene.userData.vcEnvIntensity = 0;
        applyEnvIntensity(0);
        scene.environment = null;
      }
      return;
    }

    // Quantize sun elevation so we don't rebuild PMREM every frame.
    tmpSun.current.copy(sunDirection).normalize();
    const sunY = THREE.MathUtils.clamp(tmpSun.current.y, -1, 1);
    const sunKey = Math.round((sunY + 1) * 20) / 20; // ~5% steps

    // Environmental condition: if the sky is not meaningfully visible (or we're underwater),
    // avoid reflecting a bright blue sky into caves/underwater interiors.
    const caveKey = (undergroundBlend > 0.65 || underwaterBlend > 0.2 || skyVisibility < 0.25) ? 'cave' : 'sky';

    // Global env intensity: keep it *very* conservative.
    // Env maps act like broad ambient light when roughness is high, so even small values can wash out terrain.
    const day01 = THREE.MathUtils.smoothstep(sunY, -0.05, 0.35);
    const baseIntensity = THREE.MathUtils.lerp(0.012, 0.045, day01) * intensity;
    const caveIntensity = 0.01 * intensity;
    const envIntensity = caveKey === 'cave' ? caveIntensity : baseIntensity;
    scene.userData.vcEnvIntensity = envIntensity;
    applyEnvIntensity(envIntensity);

    const key = `${caveKey}:${sunKey}`;
    const now = clock.getElapsedTime();
    const due = now - lastUpdateAt.current > minUpdateSeconds;
    const changed = key !== lastKey.current;
    if (!due && !changed) return;
    lastUpdateAt.current = now;
    lastKey.current = key;

    if (caveKey === 'cave') {
      // Switch to a neutral environment (still gives some spec response, but not "blue sky" in caves).
      if (roomPMREM.current) scene.environment = roomPMREM.current;
      return;
    }

    // Tune sky parameters based on sun height for a simple time-of-day response.
    // We keep it conservative to avoid drastic exposure pumping.
    const s = sky.material.uniforms;
    s['turbidity'].value = THREE.MathUtils.lerp(12, 2.5, day01);
    s['rayleigh'].value = THREE.MathUtils.lerp(0.1, 1.5, day01);
    s['mieCoefficient'].value = THREE.MathUtils.lerp(0.02, 0.005, day01);
    s['mieDirectionalG'].value = 0.8;
    s['sunPosition'].value.copy(tmpSun.current).multiplyScalar(500);

    // Capture sky into a cube map then convert to a specular-convolution PMREM.
    cubeCam.update(gl, envScene);
    const rt = pmrem.fromCubemap(cubeRT.texture);
    // Swap + dispose old to avoid VRAM leaks.
    lastPMREMRT.current?.dispose();
    lastPMREMRT.current = rt;
    scene.environment = rt.texture;
  });

  return null;
};
