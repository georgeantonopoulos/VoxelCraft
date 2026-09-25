import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/** FPS below which resolution steps down. */
const DOWNSCALE_FPS = 50;
/** FPS a window must sustain before resolution steps back up. */
const UPSCALE_FPS = 58;
/** Evaluation window in seconds. */
const WINDOW_SECONDS = 1.25;
/** Consecutive healthy windows needed before stepping up (hysteresis). */
const HEALTHY_WINDOWS_TO_UPSCALE = 3;
/** Lowest fraction of the user's chosen resolution we will fall back to. */
const MIN_FACTOR = 0.55;

export interface AdaptiveResolutionProps {
  /** User-selected DPR (Settings → Resolution). Acts as the ceiling. */
  baseDpr: number;
  enabled: boolean;
}

/**
 * AdaptiveResolution — dynamic resolution scaling.
 *
 * Keeps frame rate smooth on busy scenes (dense forests, chunk streaming,
 * restoration effects) by trading pixels for frames, then climbs back to the
 * user's chosen resolution once there is headroom. Changes are rate-limited so
 * render targets are resized at most once per evaluation window.
 */
export const AdaptiveResolution: React.FC<AdaptiveResolutionProps> = ({ baseDpr, enabled }) => {
  const setDpr = useThree((s) => s.setDpr);
  const factor = useRef(1);
  const acc = useRef({ time: 0, frames: 0, healthy: 0, warmup: 3 });

  // Reset whenever the ceiling changes or the feature toggles.
  useEffect(() => {
    factor.current = 1;
    acc.current = { time: 0, frames: 0, healthy: 0, warmup: 3 };
    setDpr(baseDpr);
    (window as unknown as { __vcDynamicResolution?: number }).__vcDynamicResolution = 1;
  }, [baseDpr, enabled, setDpr]);

  useFrame((_, delta) => {
    if (!enabled) return;
    // Ignore hitches from tab switches / breakpoints; they are not GPU load.
    if (delta > 0.25 || document.hidden) return;

    const a = acc.current;
    if (a.warmup > 0) {
      a.warmup -= delta;
      return;
    }

    a.time += delta;
    a.frames += 1;
    if (a.time < WINDOW_SECONDS) return;

    const fps = a.frames / a.time;
    a.time = 0;
    a.frames = 0;

    let next = factor.current;
    if (fps < DOWNSCALE_FPS) {
      // Step harder when far below target.
      next = Math.max(MIN_FACTOR, next - (fps < 35 ? 0.15 : 0.08));
      a.healthy = 0;
    } else if (fps >= UPSCALE_FPS) {
      a.healthy += 1;
      if (a.healthy >= HEALTHY_WINDOWS_TO_UPSCALE) {
        next = Math.min(1, next + 0.05);
        a.healthy = 0;
      }
    } else {
      a.healthy = 0;
    }

    if (Math.abs(next - factor.current) > 1e-3) {
      factor.current = next;
      setDpr(baseDpr * next);
      (window as unknown as { __vcDynamicResolution?: number }).__vcDynamicResolution = next;
    }
  });

  return null;
};
