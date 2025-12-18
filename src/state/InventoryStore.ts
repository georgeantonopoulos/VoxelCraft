import { create } from 'zustand';
import { ItemType } from '@/types';
import { ITEM_REGISTRY } from '@features/interaction/logic/ItemRegistry';

export type InventoryItemId = ItemType.PICKAXE | ItemType.AXE | ItemType.TORCH | ItemType.FLORA | ItemType.STICK | ItemType.STONE | ItemType.SHARD | null;

// Stackables: items that exist as counts and can appear/disappear from slots based on count.
export type StackableInventoryItemId = Exclude<InventoryItemId, 'pickaxe' | 'axe' | null>;
export type AnyNonNullInventoryItemId = Exclude<InventoryItemId, null>;

// Stable slot layout:
// 1: empty/none (hands)
// 2: pickaxe (if hasPickaxe)
// 3: axe (if hasAxe)
// 4: torch (if torchCount > 0)
// 5: flora (if inventoryCount > 0)
// 6: sticks (if stickCount > 0)
// 7: stones (if stoneCount > 0)
// 8: shards (if shardCount > 0)
const SLOT_COUNT = 8;
const PICKAXE_SLOT_INDEX = 1;
const AXE_SLOT_INDEX = 2;
const TORCH_SLOT_INDEX = 3;
const FLORA_SLOT_INDEX = 4;
const STICK_SLOT_INDEX = 5;
const STONE_SLOT_INDEX = 6;
const SHARD_SLOT_INDEX = 7;

const getDebugModeEnabled = (): boolean => {
  // In-game debug mode is enabled via `?debug` (see HUD/App).
  // Keep this guard so this store can be imported safely.
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
};

const INITIAL_FLORA_COUNT = getDebugModeEnabled() ? 10 : 0;

const computeSlots = (state: Pick<GameState, 'inventoryCount' | 'torchCount' | 'stickCount' | 'stoneCount' | 'shardCount' | 'hasPickaxe' | 'hasAxe'>): InventoryItemId[] => {
  const slots: InventoryItemId[] = new Array(SLOT_COUNT).fill(null);
  if (state.hasPickaxe) slots[PICKAXE_SLOT_INDEX] = ItemType.PICKAXE;
  if (state.hasAxe) slots[AXE_SLOT_INDEX] = ItemType.AXE;
  if (state.torchCount > 0) slots[TORCH_SLOT_INDEX] = ItemType.TORCH;
  if (state.inventoryCount > 0) slots[FLORA_SLOT_INDEX] = ItemType.FLORA;
  if (state.stickCount > 0) slots[STICK_SLOT_INDEX] = ItemType.STICK;
  if (state.stoneCount > 0) slots[STONE_SLOT_INDEX] = ItemType.STONE;
  if (state.shardCount > 0) slots[SHARD_SLOT_INDEX] = ItemType.SHARD;
  return slots;
};

const isSlotSelectable = (index: number, item: InventoryItemId | undefined): boolean => {
  // Slot 1 (index 0) is the always-available "empty/hands" slot.
  if (index === 0) return true;
  return item != null;
};

interface GameState {
  // "Flora" is a stackable item (picked up with Q, placed with RMB).
  inventoryCount: number;
  // Torches are stackable and are consumed when placed in-world.
  torchCount: number;
  // Sticks and stones are stackable pickups (collected with Q).
  stickCount: number;
  stoneCount: number;
  shardCount: number;
  luminousFloraCount: number;
  // Pickaxe is crafted via physics-item crafting; it should not exist by default.
  hasPickaxe: boolean;
  hasAxe: boolean;
  currentTool: ItemType.PICKAXE | ItemType.AXE;
  // New Inventory System
  inventorySlots: InventoryItemId[];
  selectedSlotIndex: number;

  /**
   * General inventory helpers for stackable items.
   * Keep these small and predictable — game logic can build richer behavior on top.
   */
  addItem: (item: InventoryItemId, amount?: number) => void;
  removeItem: (item: InventoryItemId, amount?: number) => void;
  getItemCount: (item: InventoryItemId) => number;

  addFlora: () => void;
  removeFlora: () => void;
  harvestFlora: () => void;
  addLuminousFlora: () => void;
  removeLuminousFlora: () => void;
  setHasPickaxe: (has: boolean) => void;
  setHasAxe: (has: boolean) => void;
  setCurrentTool: (tool: ItemType.PICKAXE | ItemType.AXE) => void;

  setSelectedSlotIndex: (index: number) => void;
  cycleSlot: (direction: 1 | -1) => void;
}

export const useInventoryStore = create<GameState>((set, get) => ({
  // "Flora" starts empty in normal play. In `?debug` mode, start with some for fast iteration.
  inventoryCount: INITIAL_FLORA_COUNT,
  torchCount: 0, // Start with zero torches.
  stickCount: 0,
  stoneCount: 0,
  shardCount: 0,
  luminousFloraCount: 0,
  hasPickaxe: false,
  hasAxe: false,
  currentTool: ItemType.PICKAXE,
  // New Inventory System
  // Slots are stable; unlocks (like `hasAxe`) control whether some items are usable.
  inventorySlots: computeSlots({ inventoryCount: INITIAL_FLORA_COUNT, torchCount: 0, stickCount: 0, stoneCount: 0, shardCount: 0, hasPickaxe: false, hasAxe: false }),
  // Start on slot 1 (index 0): hands/none.
  selectedSlotIndex: 0,

  addItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;

    const metadata = ITEM_REGISTRY[item];
    if (!metadata?.stateKey) return state;

    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
    };

    (nextCounts as any)[metadata.stateKey] += amt;

    const inventorySlots = computeSlots({ ...nextCounts, hasPickaxe: state.hasPickaxe, hasAxe: state.hasAxe });
    return { ...nextCounts, inventorySlots };
  }),
  removeItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;

    const metadata = ITEM_REGISTRY[item];
    if (!metadata?.stateKey) return state;

    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
    };

    (nextCounts as any)[metadata.stateKey] = Math.max(0, (nextCounts as any)[metadata.stateKey] - amt);

    const inventorySlots = computeSlots({ ...nextCounts, hasPickaxe: state.hasPickaxe, hasAxe: state.hasAxe });

    // If the currently selected slot becomes unavailable, fall back to slot 1 (index 0).
    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;

    return { ...nextCounts, inventorySlots, selectedSlotIndex };
  }),
  getItemCount: (item: InventoryItemId) => {
    if (!item) return 0;
    const state = get();
    const metadata = ITEM_REGISTRY[item as ItemType];
    return metadata?.stateKey ? (state as any)[metadata.stateKey] : 0;
  },

  // Back-compat convenience helpers (older codepaths). Prefer `addItem/removeItem` for new logic.
  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  harvestFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  addLuminousFlora: () => set((state) => ({ luminousFloraCount: state.luminousFloraCount + 1 })),
  removeLuminousFlora: () => set((state) => ({ luminousFloraCount: Math.max(0, state.luminousFloraCount - 1) })),
  setHasPickaxe: (has: boolean) => set((state) => {
    const inventorySlots = computeSlots({
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
      hasPickaxe: has,
      hasAxe: state.hasAxe
    });
    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;
    return { hasPickaxe: has, inventorySlots, selectedSlotIndex };
  }),
  setHasAxe: (has: boolean) => set((state) => {
    // If the player loses the axe, ensure gameplay doesn't stay in an invalid tool mode.
    const nextTool = !has && state.currentTool === ItemType.AXE ? ItemType.PICKAXE : state.currentTool;
    const inventorySlots = computeSlots({
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
      hasPickaxe: state.hasPickaxe,
      hasAxe: has
    });
    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;
    return { hasAxe: has, currentTool: nextTool, inventorySlots, selectedSlotIndex };
  }),
  setCurrentTool: (tool) => set({ currentTool: tool }),

  setSelectedSlotIndex: (index) => set((state) => {
    const total = state.inventorySlots.length;
    const nextIndex = ((index % total) + total) % total;
    const selectedItem = state.inventorySlots[nextIndex];

    // Selecting the axe slot only equips it if it's unlocked; otherwise we fall back to pickaxe.
    const nextTool: GameState['currentTool'] =
      selectedItem === ItemType.AXE && state.hasAxe ? ItemType.AXE : ItemType.PICKAXE;

    return { selectedSlotIndex: nextIndex, currentTool: nextTool };
  }),

  cycleSlot: (direction) => set((state) => {
    const total = state.inventorySlots.length;
    // Scroll should skip empty slots (except slot 1 / index 0 which is "hands/none").
    let nextIndex = state.selectedSlotIndex;
    for (let i = 0; i < total; i++) {
      nextIndex = (nextIndex + direction + total) % total;
      if (isSlotSelectable(nextIndex, state.inventorySlots[nextIndex])) break;
    }
    const selectedItem = state.inventorySlots[nextIndex];
    const nextTool: GameState['currentTool'] =
      selectedItem === ItemType.AXE && state.hasAxe ? ItemType.AXE : ItemType.PICKAXE;
    return { selectedSlotIndex: nextIndex, currentTool: nextTool };
  }),
}));
