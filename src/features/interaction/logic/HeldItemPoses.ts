import { ItemType } from '@/types';

export type HeldItemPose = {
  // X is taken from the pickaxe pose; these tune Y/Z and scale per item.
  xOffset?: number;
  y: number;
  z: number;
  scale: number;
  rotOffset?: { x: number; y: number; z: number };
};

export const RIGHT_HAND_HELD_ITEM_POSES: Partial<Record<ItemType, HeldItemPose>> = {
  // Reference: torch's comfortable Y/Z (but on the right hand).
  [ItemType.STICK]: { xOffset: 0.27, y: -0.457, z: -0.789, scale: 1.234, rotOffset: { x: -18.0, y: 89.0, z: -18.0 } },
  [ItemType.STONE]: { xOffset: 0.123, y: -0.457, z: -0.789, scale: 1.234, rotOffset: { x: 0.1111, y: 0.2222, z: 0.3333 } },
  // Flora is held like a stone (similar size / throw feel).
  [ItemType.FLORA]: { xOffset: 0.123, y: -0.457, z: -0.789, scale: 1.234, rotOffset: { x: 0.1111, y: 0.2222, z: 0.3333 } },
  [ItemType.SHARD]: { xOffset: 0.123, y: -0.457, z: -0.789, scale: 1.234, rotOffset: { x: 0.1111, y: 0.2222, z: 0.3333 } }
};
