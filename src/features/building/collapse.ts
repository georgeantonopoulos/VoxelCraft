import * as THREE from 'three';
import { useLogStore } from '@/state/LogStore';
import { unsupportedNear, type GroundAt } from './logic/support';

/**
 * A piece of a build was taken away: whatever it held up (and whatever those
 * held) lets go and falls under gravity as loose pieces. Only pieces near the
 * change are checked, so an old build elsewhere is never dropped by it.
 */
export const collapseUnsupportedNear = (probe: GroundAt, near: THREE.Vector3): number => {
  const st = useLogStore.getState();
  const placed = Object.values(st.logs).filter((l) => l.state === 'placed' && !l.onBench);
  const falling = unsupportedNear(placed, probe, near);
  for (const l of falling) st.updateLog(l.id, { state: 'loose', open: undefined });
  if (falling.length) {
    window.dispatchEvent(new CustomEvent('vc-audio-woodwork', { detail: { kind: 'splitDone', loudness: Math.min(1.2, 0.6 + falling.length * 0.1) } }));
  }
  return falling.length;
};
