import { create } from 'zustand';

export type InventoryItemId = 'pickaxe' | 'axe' | 'torch' | 'flora' | null;

// Stackables: items that exist as counts and can appear/disappear from slots based on count.
export type StackableInventoryItemId = Exclude<InventoryItemId, 'pickaxe' | 'axe' | null>;
export type AnyNonNullInventoryItemId = Exclude<InventoryItemId, null>;

const SLOT_COUNT = 5;
// Stable slot layout:
// 1: empty/none
// 2: torch (if torchCount > 0)
// 3: flora (if inventoryCount > 0)
// 4..5: reserved
const TORCH_SLOT_INDEX = 1;
const FLORA_SLOT_INDEX = 2;

const computeSlots = (state: Pick<GameState, 'inventoryCount' | 'torchCount'>): InventoryItemId[] => {
  const slots: InventoryItemId[] = new Array(SLOT_COUNT).fill(null);
  if (state.torchCount > 0) slots[TORCH_SLOT_INDEX] = 'torch';
  if (state.inventoryCount > 0) slots[FLORA_SLOT_INDEX] = 'flora';
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
  inventoryCount: 0,
  torchCount: 1, // Start with one torch.
  luminousFloraCount: 0,
  hasAxe: true,
  currentTool: 'pickaxe',
  // New Inventory System
  // Slots are stable; unlocks (like `hasAxe`) control whether some items are usable.
  inventorySlots: computeSlots({ inventoryCount: 0, torchCount: 1 }),
  // Start on slot 1 (index 0). Torch stays in slot 2 (index 1).
  selectedSlotIndex: 0,

  addItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;
    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
    };
    if (item === 'flora') nextCounts.inventoryCount += amt;
    if (item === 'torch') nextCounts.torchCount += amt;
    const inventorySlots = computeSlots(nextCounts);
    return { ...nextCounts, inventorySlots };
  }),
  removeItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;
    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
    };
    if (item === 'flora') nextCounts.inventoryCount = Math.max(0, nextCounts.inventoryCount - amt);
    if (item === 'torch') nextCounts.torchCount = Math.max(0, nextCounts.torchCount - amt);
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
