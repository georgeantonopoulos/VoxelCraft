import { create } from 'zustand';

export type InventoryItemId = 'pickaxe' | 'axe' | 'torch' | 'flora' | 'stick' | 'stone' | 'shard' | null;

// Stackables: items that exist as counts and can appear/disappear from slots based on count.
export type StackableInventoryItemId = Exclude<InventoryItemId, 'pickaxe' | 'axe' | null>;
export type AnyNonNullInventoryItemId = Exclude<InventoryItemId, null>;

const SLOT_COUNT = 6;
// Stable slot layout:
// 1: empty/none
// 2: torch (if torchCount > 0)
// 3: flora (if inventoryCount > 0)
// 4: sticks (if stickCount > 0)
// 5: stones (if stoneCount > 0)
// 6: shards (if shardCount > 0)
const TORCH_SLOT_INDEX = 1;
const FLORA_SLOT_INDEX = 2;
const STICK_SLOT_INDEX = 3;
const STONE_SLOT_INDEX = 4;
const SHARD_SLOT_INDEX = 5;

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

const computeSlots = (state: Pick<GameState, 'inventoryCount' | 'torchCount' | 'stickCount' | 'stoneCount' | 'shardCount'>): InventoryItemId[] => {
  const slots: InventoryItemId[] = new Array(SLOT_COUNT).fill(null);
  if (state.torchCount > 0) slots[TORCH_SLOT_INDEX] = 'torch';
  if (state.inventoryCount > 0) slots[FLORA_SLOT_INDEX] = 'flora';
  if (state.stickCount > 0) slots[STICK_SLOT_INDEX] = 'stick';
  if (state.stoneCount > 0) slots[STONE_SLOT_INDEX] = 'stone';
  if (state.shardCount > 0) slots[SHARD_SLOT_INDEX] = 'shard';
  return slots;
};

const isSlotSelectable = (index: number, item: InventoryItemId | undefined): boolean => {
  // Slot 1 (index 0) is the always-available "empty/hands" slot.
  if (index === 0) return true;
  return item != null;
};

interface GameState {
  // "Flora" is a stackable item (picked up with Q, placed with E).
  inventoryCount: number;
  // Torches are stackable and are consumed when placed in-world.
  torchCount: number;
  // Sticks and stones are stackable pickups (collected with Q).
  stickCount: number;
  stoneCount: number;
  shardCount: number;
  luminousFloraCount: number;
  hasAxe: boolean;
  currentTool: 'pickaxe' | 'axe';
  // New Inventory System
  inventorySlots: InventoryItemId[];
  selectedSlotIndex: number;

  /**
   * General inventory helpers for stackable items.
   * Keep these small and predictable — game logic can build richer behavior on top.
   */
  addItem: (item: StackableInventoryItemId, amount?: number) => void;
  removeItem: (item: StackableInventoryItemId, amount?: number) => void;
  getItemCount: (item: StackableInventoryItemId) => number;

  addFlora: () => void;
  removeFlora: () => void;
  harvestFlora: () => void;
  addLuminousFlora: () => void;
  removeLuminousFlora: () => void;
  setHasAxe: (has: boolean) => void;
  setCurrentTool: (tool: 'pickaxe' | 'axe') => void;

  setSelectedSlotIndex: (index: number) => void;
  cycleSlot: (direction: 1 | -1) => void;
}

export const useInventoryStore = create<GameState>((set) => ({
  // "Flora" starts empty in normal play. In `?debug` mode, start with some for fast iteration.
  inventoryCount: INITIAL_FLORA_COUNT,
  torchCount: 1, // Start with one torch.
  stickCount: 0,
  stoneCount: 0,
  shardCount: 0,
  luminousFloraCount: 0,
  hasAxe: true,
  currentTool: 'pickaxe',
  // New Inventory System
  // Slots are stable; unlocks (like `hasAxe`) control whether some items are usable.
  inventorySlots: computeSlots({ inventoryCount: INITIAL_FLORA_COUNT, torchCount: 1, stickCount: 0, stoneCount: 0, shardCount: 0 }),
  // Start on slot 1 (index 0). Torch stays in slot 2 (index 1).
  selectedSlotIndex: 0,

  addItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;
    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
    };
    if (item === 'flora') nextCounts.inventoryCount += amt;
    if (item === 'torch') nextCounts.torchCount += amt;
    if (item === 'stick') nextCounts.stickCount += amt;
    if (item === 'stone') nextCounts.stoneCount += amt;
    if (item === 'shard') nextCounts.shardCount += amt;
    const inventorySlots = computeSlots(nextCounts);
    return { ...nextCounts, inventorySlots };
  }),
  removeItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;
    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
    };
    if (item === 'flora') nextCounts.inventoryCount = Math.max(0, nextCounts.inventoryCount - amt);
    if (item === 'torch') nextCounts.torchCount = Math.max(0, nextCounts.torchCount - amt);
    if (item === 'stick') nextCounts.stickCount = Math.max(0, nextCounts.stickCount - amt);
    if (item === 'stone') nextCounts.stoneCount = Math.max(0, nextCounts.stoneCount - amt);
    if (item === 'shard') nextCounts.shardCount = Math.max(0, nextCounts.shardCount - amt);
    const inventorySlots = computeSlots(nextCounts);

    // If the currently selected slot becomes unavailable, fall back to slot 1 (index 0).
    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;

    return { ...nextCounts, inventorySlots, selectedSlotIndex };
  }),
  getItemCount: (item) => {
    const state = useInventoryStore.getState();
    switch (item) {
      case 'flora':
        return state.inventoryCount;
      case 'torch':
        return state.torchCount;
      case 'stick':
        return state.stickCount;
      case 'stone':
        return state.stoneCount;
      case 'shard':
        return state.shardCount;
      default:
        return 0;
    }
  },

  // Back-compat convenience helpers (older codepaths). Prefer `addItem/removeItem` for new logic.
  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  harvestFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  addLuminousFlora: () => set((state) => ({ luminousFloraCount: state.luminousFloraCount + 1 })),
  removeLuminousFlora: () => set((state) => ({ luminousFloraCount: Math.max(0, state.luminousFloraCount - 1) })),
  setHasAxe: (has: boolean) => set((state) => {
    // If the player loses the axe, ensure gameplay doesn't stay in an invalid tool mode.
    const nextTool = !has && state.currentTool === 'axe' ? 'pickaxe' : state.currentTool;
    return { hasAxe: has, currentTool: nextTool };
  }),
  setCurrentTool: (tool) => set({ currentTool: tool }),

  setSelectedSlotIndex: (index) => set((state) => {
    const total = state.inventorySlots.length;
    const nextIndex = ((index % total) + total) % total;
    const selectedItem = state.inventorySlots[nextIndex];

    // Selecting the axe slot only equips it if it's unlocked; otherwise we fall back to pickaxe.
    const nextTool: GameState['currentTool'] =
      selectedItem === 'axe' && state.hasAxe ? 'axe' : 'pickaxe';

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
      selectedItem === 'axe' && state.hasAxe ? 'axe' : 'pickaxe';
    return { selectedSlotIndex: nextIndex, currentTool: nextTool };
  }),
}));
