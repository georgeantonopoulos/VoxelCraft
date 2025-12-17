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
  stick: { xOffset: 0.123, y: -0.457, z: -0.789, scale: 1.234, rotOffset: { x: 0.1111, y: 0.2222, z: 0.3333 } },
  stone: { xOffset: 0.123, y: -0.457, z: -0.789, scale: 1.234, rotOffset: { x: 0.1111, y: 0.2222, z: 0.3333 } }
};
