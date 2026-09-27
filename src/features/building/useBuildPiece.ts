import type * as THREE from 'three';
import type { World } from '@dimforge/rapier3d-compat';
import { useLogStore } from '@/state/LogStore';
import { useCarpentryStore } from '@/state/CarpentryStore';
import { findBenches, workpieceOn } from './logic/benches';

type RapierApi = { Ray: typeof import('@dimforge/rapier3d-compat').Ray };

/** Arm's reach for doors and benches. */
const REACH = 3.5;

/**
 * Right click with empty hands on a placed piece: swing a door, or go back
 * to a workbench that has a piece waiting on it. Returns true if used.
 */
export const tryUseBuildPiece = (world: World, rapier: RapierApi, origin: THREE.Vector3, dir: THREE.Vector3): boolean => {
  const store = useLogStore.getState();
  if (store.carriedId) return false;
  const hit = world.castRay(new rapier.Ray(origin, dir), REACH, true, undefined, undefined, undefined, undefined,
    (c: { parent: () => { userData?: unknown } | null }) => {
      const ud = c.parent()?.userData as { type?: string } | undefined;
      return ud?.type === 'log' || ud?.type === 'terrain';
    });
  const id = (hit?.collider.parent()?.userData as { type?: string; id?: string } | undefined)?.id;
  const piece = id ? store.logs[id] : undefined;
  if (!piece || piece.state !== 'placed') return false;

  if (piece.kind === 'door') {
    store.updateLog(piece.id, { open: !piece.open });
    window.dispatchEvent(new CustomEvent('vc-audio-play', { detail: { soundId: 'wood_hit', options: { pitch: piece.open ? 0.7 : 0.9, volume: 0.45 } } }));
    window.dispatchEvent(new CustomEvent('vc-audio-woodwork', { detail: { kind: 'split' } }));
    return true;
  }

  const all = Object.values(store.logs);
  const benchId = piece.onBench
    ?? findBenches(all).find((b) => b.id === piece.id || b.legIds.includes(piece.id))?.id;
  if (benchId && workpieceOn(benchId, all)) {
    document.exitPointerLock?.();
    useCarpentryStore.getState().open(benchId);
    return true;
  }
  return false;
};
