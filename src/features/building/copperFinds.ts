import * as THREE from 'three';
import { useMaterialsStore } from '@/state/MaterialsStore';
import { useGroveStore } from '@/state/GroveStore';
import { emitImpact } from '@features/interaction/components/ImpactFX';
import { COPPER_COLOR, COPPER_TRACE_COLOR, type CopperFind } from './logic/copperVeins';

/**
 * A dig turned up copper (copperVeins.copperFind): flecks of green in the
 * chips near a vein; a nugget knocked out of vein rock goes into the pouch.
 * The first nugget in a world is announced with what it is for.
 */
export const revealCopper = (find: CopperFind, at: THREE.Vector3, dir: THREE.Vector3): void => {
  if (find === 'none') return;
  if (find === 'trace') {
    emitImpact({ position: at, direction: dir, kind: 'stone', color: COPPER_TRACE_COLOR, strength: 0.7, floorY: at.y - 0.6 });
    return;
  }
  emitImpact({ position: at, direction: dir, kind: 'stone', color: COPPER_COLOR, strength: 1.3, floorY: at.y - 0.6 });
  window.dispatchEvent(new CustomEvent('vc-audio-play', { detail: { soundId: 'rock_hit', options: { pitch: 1.7, volume: 0.7 } } }));
  const mats = useMaterialsStore.getState();
  const first = mats.copper === 0 && mats.hinges === 0;
  mats.add('copper', 1);
  if (first) {
    useGroveStore.getState().announce({ kind: 'discovery', title: 'Copper', detail: 'Soft metal in the rock · hinge pins for a door' });
  }
  window.dispatchEvent(new CustomEvent('vc-hud-note', { detail: { text: `Copper nugget · ${useMaterialsStore.getState().copper} in your pouch` } }));
};
