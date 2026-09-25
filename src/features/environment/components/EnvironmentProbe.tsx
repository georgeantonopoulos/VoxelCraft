import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { useEnvironmentStore } from '@state/EnvironmentStore';

/** Sampling rate for the (ray-marched) sky visibility estimate. */
const PROBE_INTERVAL_S = 0.25;
/** Blend time constant: how quickly eyes/lighting adapt when entering a cave. */
const ADAPT_RATE = 1.6;
/** Hysteresis for the discrete underground flag. */
const ENTER_UNDERGROUND = 0.6;
const EXIT_UNDERGROUND = 0.4;

/**
 * EnvironmentProbe — measures how enclosed the camera is.
 *
 * Writes `skyVisibility` and `undergroundBlend` into EnvironmentStore, which
 * the sun/moon/ambient lights, the cinematic grade and ambient life read.
 * Nothing wrote these before, so caves never dimmed the sky lights or
 * triggered cave exposure.
 */
export const EnvironmentProbe: React.FC = () => {
  const timer = useRef(0);
  const target = useRef(1);
  const blend = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    timer.current += dt;
    if (timer.current >= PROBE_INTERVAL_S) {
      timer.current = 0;
      const p = state.camera.position;
      const vis = terrainRuntime.estimateSkyVisibility(p.x, p.y, p.z, { maxDistance: 48, step: 3 });
      // Unknown (chunk not loaded) keeps the previous estimate.
      if (vis != null) target.current = vis;
    }

    const underground = 1 - target.current;
    const next = THREE.MathUtils.damp(blend.current, underground, ADAPT_RATE, dt);
    // Only touch the store when the value moves visibly (avoids store churn).
    if (Math.abs(next - blend.current) > 0.002 || (next !== blend.current && (next < 0.002 || next > 0.998))) {
      blend.current = next;
      const env = useEnvironmentStore.getState();
      env.setUndergroundBlend(next);
      env.setSkyVisibility(1 - next);
      if (!env.isUnderground && next > ENTER_UNDERGROUND) env.setUndergroundState(true, state.clock.elapsedTime);
      else if (env.isUnderground && next < EXIT_UNDERGROUND) env.setUndergroundState(false, state.clock.elapsedTime);
    }
  });

  return null;
};
