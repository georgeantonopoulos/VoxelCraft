import { ItemType } from '@/types';
import * as THREE from 'three';

export type HeldItemPose = {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: { x: number; y: number; z: number }; // radians
  xOffset?: number; // relative to pickaxe base if applicable
  hiddenYOffset?: number;
};

/**
 * Poses are defined for a standard 16:9 aspect ratio.
 * FirstPersonTools.tsx applies a 'responsiveX' multiplier to the X positions
 * when the screen is in portrait mode (aspect < 1.1).
 */

export const PICKAXE_POSE: HeldItemPose = {
  x: 0.715,
  y: -0.22,
  z: -0.80,
  scale: 0.5,
  rot: { x: 1.15, y: -3.062, z: -1.45 }
};

// Torch uses the same pose as stick tools (right hand position), but flipped so flame points up
export const TORCH_POSE: HeldItemPose = {
  x: PICKAXE_POSE.x,
  xOffset: 0.27,
  y: -0.457,
  z: -0.789,
  scale: 1.234,
  rot: {
    x: THREE.MathUtils.degToRad(-18.0),
    y: THREE.MathUtils.degToRad(89.0),
    z: THREE.MathUtils.degToRad(-18.0) // Flipped from 162° to -18° so flame points up
  },
  hiddenYOffset: -0.8
};

export const RIGHT_HAND_HELD_ITEM_POSES: Partial<Record<ItemType, HeldItemPose>> = {
  [ItemType.PICKAXE]: PICKAXE_POSE,
  [ItemType.STICK]: {
    x: PICKAXE_POSE.x, // base
    xOffset: 0.27,
    y: -0.457,
    z: -0.789,
    scale: 1.234,
    rot: {
      x: THREE.MathUtils.degToRad(-18.0),
      y: THREE.MathUtils.degToRad(89.0),
      z: THREE.MathUtils.degToRad(162.0) // flipped 180° from -18° so custom tool attachments face correctly
    }
  },
  [ItemType.STONE]: { x: PICKAXE_POSE.x, xOffset: -0.3, y: -0.34, z: -0.74, scale: 0.5, rot: { x: 0.35, y: 0.6, z: 0.15 } },
  [ItemType.FLORA]: { x: PICKAXE_POSE.x, xOffset: -0.22, y: -0.3, z: -0.7, scale: 0.62, rot: { x: 3, y: 1.4, z: -0.12 } },
  [ItemType.SHARD]: { x: PICKAXE_POSE.x, xOffset: -0.32, y: -0.3, z: -0.7, scale: 1.25, rot: { x: -0.9, y: 0.35, z: 0.45 } },
};
