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
  // Left Side - Multi-slot for Saw/Axe
  {
    id: 'blade_1', // Top Left
    position: [-0.12, 0.42, 0],
    rotation: [0, 0, Math.PI / 3],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  },
  {
    id: 'blade_2', // Mid Left
    position: [-0.12, 0.35, 0],
    rotation: [0, 0, Math.PI / 3],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  },
  {
    id: 'blade_3', // Bottom Left
    position: [-0.12, 0.28, 0],
    rotation: [0, 0, Math.PI / 3],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  },
  // Right Side (for Pickaxe/Axe)
  {
    id: 'side_right',
    position: [0.12, 0.35, 0],
    rotation: [0, 0, -Math.PI / 3],
    allowedItems: [ItemType.SHARD, ItemType.STONE, ItemType.STICK, ItemType.FLORA]
  }
];

export const RECIPES: CraftingRecipe[] = [
  {
    result: ItemType.PICKAXE,
    ingredients: ['blade_2', 'side_right'] // Classic T-Shape
  },
  {
    result: ItemType.AXE,
    ingredients: ['blade_1', 'blade_2', 'side_right'] // Heavy head
  },
  {
    result: ItemType.SAW,
    ingredients: ['blade_1', 'blade_2', 'blade_3'] // Long blade on one side
  }
];
