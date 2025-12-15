import type { StackableInventoryItemId } from '@state/InventoryStore';

export type RightHandHeldItemId = Extract<StackableInventoryItemId, 'stick' | 'stone'>;

export type HeldItemPose = {
  // X is taken from the pickaxe pose; these tune Y/Z and scale per item.
  xOffset?: number;
  y: number;
  z: number;
  scale: number;
  rotOffset?: { x: number; y: number; z: number };
};

export const RIGHT_HAND_HELD_ITEM_POSES: Record<RightHandHeldItemId, HeldItemPose> = {
  // Reference: torch's comfortable Y/Z (but on the right hand).
  stick: { xOffset: 0, y: -0.3, z: -0.4, scale: 0.65, rotOffset: { x: 0.25, y: 0, z: 0.4 } },
  stone: { xOffset: 0, y: -0.3, z: -0.4, scale: 0.78, rotOffset: { x: 0.15, y: 0, z: 0 } }}}
};
