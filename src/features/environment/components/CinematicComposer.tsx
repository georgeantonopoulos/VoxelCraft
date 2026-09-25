import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { EffectComposer, Bloom, N8AO, ChromaticAberration, SMAA } from '@react-three/postprocessing';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { useGroveStore } from '@state/GroveStore';
import { GroveGradeEffect, SunShaftsEffect } from '@features/environment/effects/GroveEffects';

/** Seconds the restoration pulse takes to sweep across the screen. */
const PULSE_DURATION = 3.5;

const scratchSun = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const UNDERWATER_CA_OFFSET = new THREE.Vector2(0.0035, 0.0035);

export interface CinematicComposerProps {
  aoEnabled: boolean;
  aoIntensity: number;
  /** 'performance' renders AO at half resolution; 'high' runs full-res medium quality. */
  aoQuality?: 'performance' | 'high';
  bloomEnabled: boolean;
  bloomThreshold: number;
  bloomIntensity: number;
  exposureSurface: number;
  exposureCaveMax: number;
  exposureUnderwater: number;
  caOffset: number;
  vignetteDarkness: number;
  /** Direction toward the sun (shared, mutated by AtmosphereManager). */
  sunDirection?: THREE.Vector3;
  godRays?: boolean;
  godRaysIntensity?: number;
  antialias?: boolean;
  filmGrain?: number;
  skipPost?: boolean;
}

/**
 * CinematicComposer — the Grove's post stack.
 *
 * Pass layout (postprocessing merges adjacent non-convolution effects):
 *   SunShafts (convolution) → N8AO → Bloom + Grove Grade (merged) → [CA] → SMAA
 *
 * SunShafts must precede N8AO: sampling the depth buffer after N8AO's pass
 * forms a framebuffer feedback loop (GL_INVALID_OPERATION).
 *
 * Every per-frame value (exposure, vitality, sun position, restoration pulse)
 * is written straight into effect uniforms, so environment transitions never
 * trigger React re-renders or shader recompiles.
 */
export const CinematicComposer: React.FC<CinematicComposerProps> = (props) => {
  const {
    aoEnabled, aoIntensity, aoQuality = 'performance',
    bloomEnabled, bloomThreshold, bloomIntensity,
    exposureSurface, exposureCaveMax, exposureUnderwater,
    caOffset, vignetteDarkness, sunDirection,
    godRays = false, godRaysIntensity = 0.55,
    antialias = true, filmGrain = 0.025, skipPost,
  } = props;

  // Only a boolean crosses into React; the blend itself goes to uniforms.
  const underwater = useEnvironmentStore((s) => s.underwaterBlend > 0.05);

  const grade = useMemo(() => new GroveGradeEffect(), []);
  const shafts = useMemo(() => (godRays ? new SunShaftsEffect(24) : null), [godRays]);

  useEffect(() => () => grade.dispose(), [grade]);
  useEffect(() => () => shafts?.dispose(), [shafts]);

  const smoothed = useMemo(() => ({ vitality: useGroveStore.getState().vitality, exposure: exposureSurface }), [grade]);

  useFrame((state, delta) => {
    const env = useEnvironmentStore.getState();
    const grove = useGroveStore.getState();
    const dt = Math.min(delta, 0.1);
    const aspect = state.size.width / Math.max(1, state.size.height);

    // Eye adaptation: brighter in caves, slightly darker underwater.
    const caveExposure = THREE.MathUtils.lerp(exposureSurface, exposureCaveMax, env.undergroundBlend);
    const targetExposure = THREE.MathUtils.lerp(caveExposure, exposureUnderwater, env.underwaterBlend);
    smoothed.exposure = THREE.MathUtils.damp(smoothed.exposure, targetExposure, 2.5, dt);
    smoothed.vitality = THREE.MathUtils.damp(smoothed.vitality, grove.vitality, 0.6, dt);

    const sunY = sunDirection ? sunDirection.y : 1;
    const night = THREE.MathUtils.smoothstep(-sunY, -0.05, 0.25);

    const sinceRestore = (performance.now() - grove.lastRestoreAt) / 1000;
    let pulse = 0;
    let pulseRadius = 0;
    if (sinceRestore >= 0 && sinceRestore < PULSE_DURATION) {
      const t = sinceRestore / PULSE_DURATION;
      pulse = Math.min(1, sinceRestore * 6) * (1 - t) * (1 - t);
      pulseRadius = t * 1.4;
    }

    grade.setUniform('uExposure', smoothed.exposure);
    grade.setUniform('uVitality', smoothed.vitality);
    grade.setUniform('uUnderwater', env.underwaterBlend);
    grade.setUniform('uNight', night);
    grade.setUniform('uPulse', pulse);
    grade.setUniform('uPulseRadius', pulseRadius);
    grade.setUniform('uVignette', vignetteDarkness + env.underwaterBlend * 0.35 + env.undergroundBlend * 0.15);
    grade.setUniform('uGrain', filmGrain);
    grade.setUniform('uAspect', aspect);
    grade.setUniform('uSeed', (state.clock.elapsedTime * 60) % 1000);

    if (shafts && sunDirection) {
      const cam = state.camera;
      scratchSun.copy(cam.position).addScaledVector(sunDirection, 1000).project(cam);
      cam.getWorldDirection(scratchForward);
      const facing = THREE.MathUtils.smoothstep(scratchForward.dot(sunDirection), 0.05, 0.45);
      const onScreen = 1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(scratchSun.x), Math.abs(scratchSun.y)), 1.1, 1.8);
      const daylight = THREE.MathUtils.smoothstep(sunY, -0.02, 0.12);
      const occluded = (1 - env.underwaterBlend) * THREE.MathUtils.lerp(1, 0.35, env.undergroundBlend);
      shafts.sunUv.set(scratchSun.x * 0.5 + 0.5, scratchSun.y * 0.5 + 0.5);
      shafts.strength = godRaysIntensity * facing * onScreen * daylight * occluded;
      shafts.aspect = aspect;
      // Low sun → warmer, deeper shafts.
      const golden = 1 - THREE.MathUtils.smoothstep(sunY, 0.05, 0.45);
      shafts.shaftColor.setRGB(1.0, 0.88 - golden * 0.2, 0.68 - golden * 0.3);
    }
  });

  if (skipPost) return null;

  return (
    <EffectComposer multisampling={0}>
      <>
        {shafts && <primitive object={shafts} />}
        {aoEnabled && (
          <N8AO
            halfRes={aoQuality === 'performance'}
            quality={aoQuality === 'performance' ? 'performance' : 'medium'}
            intensity={aoIntensity}
            color="black"
            aoRadius={2.0}
            distanceFalloff={200}
            screenSpaceRadius={false}
          />
        )}
        {bloomEnabled && (
          <Bloom luminanceThreshold={bloomThreshold} mipmapBlur intensity={bloomIntensity} radius={0.75} />
        )}
        <primitive object={grade} />
        {(underwater || Math.abs(caOffset) > 0.0001) && (
          <ChromaticAberration
            offset={underwater ? UNDERWATER_CA_OFFSET : new THREE.Vector2(caOffset * 0.1, caOffset * 0.1)}
            radialModulation
            modulationOffset={0}
          />
        )}
        {antialias && <SMAA />}
      </>
    </EffectComposer>
  );
};
