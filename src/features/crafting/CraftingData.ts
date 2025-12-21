import { ItemType } from '@/types';

export interface AttachmentSlot {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  allowedItems: ItemType[];
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
  }
];

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
