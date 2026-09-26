import { ItemType } from '@/types';

export interface AttachmentSlot {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  allowedItems: ItemType[];
  /** Size of what is bound here, relative to a head slot (saw teeth are small). */
  scale?: number;
}

export interface CraftingRecipe {
  result: ItemType;
  ingredients: string[];
}

export const STICK_SLOTS: AttachmentSlot[] = [
  // Left Side (for Pickaxe/Axe)
  {
    id: 'side_left',
    position: [-0.12, 0.35, 0],
    rotation: [0, 0, Math.PI / 3],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  },
  // Right Side (for Pickaxe)
  {
    id: 'side_right',
    position: [0.12, 0.35, 0],
    rotation: [0, 0, -Math.PI / 3],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  },
  // Top Tip (for Spear/Axe)
  {
    id: 'tip_center',
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  },
  // Saw edge: three small flakes set edge-out along one side of the shaft.
  { id: 'edge_1', position: [-0.075, 0.15, 0], rotation: [0, 0, 0.15], allowedItems: [ItemType.SHARD], scale: 0.7 },
  { id: 'edge_2', position: [-0.075, 0.01, 0], rotation: [0, 0, 0.15], allowedItems: [ItemType.SHARD], scale: 0.7 },
  { id: 'edge_3', position: [-0.075, -0.13, 0], rotation: [0, 0, 0.15], allowedItems: [ItemType.SHARD], scale: 0.7 },
];

export const SAW_EDGE_SLOTS = ['edge_1', 'edge_2', 'edge_3'] as const;

export const RECIPES: CraftingRecipe[] = [
  {
    result: ItemType.PICKAXE,
    ingredients: ['side_left', 'side_right'] // T-Shape
  },
  {
    result: ItemType.AXE,
    ingredients: ['side_left', 'tip_center'] // L-Shape
  }
];
