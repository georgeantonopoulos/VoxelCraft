import { create } from 'zustand';
import { ItemType, CustomTool } from '@/types';
import { ITEM_REGISTRY } from '@features/interaction/logic/ItemRegistry';

export type InventoryItemId = ItemType | string | null;

// Stackables: items that exist as counts and can appear/disappear from slots based on count.
export type StackableInventoryItemId = Exclude<InventoryItemId, 'pickaxe' | 'axe' | string | null>;
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
// 9+: Custom Tools
const FIXED_SLOT_COUNT = 8;
const PICKAXE_SLOT_INDEX = 1;
const AXE_SLOT_INDEX = 2;
const TORCH_SLOT_INDEX = 3;
const FLORA_SLOT_INDEX = 4;
const STICK_SLOT_INDEX = 5;
const STONE_SLOT_INDEX = 6;
const SHARD_SLOT_INDEX = 7;

const getDebugModeEnabled = (): boolean => {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
  } catch {
    return false;
  }
};

const INITIAL_FLORA_COUNT = getDebugModeEnabled() ? 10 : 0;

// Pre-crafted tools for debug mode testing
const getDebugModeTools = (): { tools: Record<string, CustomTool>; ids: string[] } => {
  if (!getDebugModeEnabled()) return { tools: {}, ids: [] };

  // Create pre-crafted AXE: blade_1 + blade_2 + side_right (shards)
  const debugAxe: CustomTool = {
    id: 'tool_debug_axe',
    baseType: ItemType.STICK,
    attachments: {
      blade_1: ItemType.SHARD,
      blade_2: ItemType.SHARD,
      side_right: ItemType.SHARD,
    }
  };

  // Create pre-crafted SAW: blade_1 + blade_2 + blade_3 (shards)
  const debugSaw: CustomTool = {
    id: 'tool_debug_saw',
    baseType: ItemType.STICK,
    attachments: {
      blade_1: ItemType.SHARD,
      blade_2: ItemType.SHARD,
      blade_3: ItemType.SHARD,
    }
  };

  return {
    tools: {
      [debugAxe.id]: debugAxe,
      [debugSaw.id]: debugSaw,
    },
    ids: [debugAxe.id, debugSaw.id]
  };
};

const DEBUG_TOOLS = getDebugModeTools();

const computeSlots = (state: {
  inventoryCount: number;
  torchCount: number;
  stickCount: number;
  stoneCount: number;
  shardCount: number;
  hasPickaxe: boolean;
  hasAxe: boolean;
  customToolIds: string[];
}): InventoryItemId[] => {
  const slots: InventoryItemId[] = new Array(FIXED_SLOT_COUNT).fill(null);
  if (state.hasPickaxe) slots[PICKAXE_SLOT_INDEX] = ItemType.PICKAXE;
  if (state.hasAxe) slots[AXE_SLOT_INDEX] = ItemType.AXE;
  if (state.torchCount > 0) slots[TORCH_SLOT_INDEX] = ItemType.TORCH;
  if (state.inventoryCount > 0) slots[FLORA_SLOT_INDEX] = ItemType.FLORA;
  if (state.stickCount > 0) slots[STICK_SLOT_INDEX] = ItemType.STICK;
  if (state.stoneCount > 0) slots[STONE_SLOT_INDEX] = ItemType.STONE;
  if (state.shardCount > 0) slots[SHARD_SLOT_INDEX] = ItemType.SHARD;

  // Fill remaining slots among the first 8 with custom tools
  let toolIdx = 0;
  for (let i = 0; i < FIXED_SLOT_COUNT; i++) {
    if (slots[i] === null && toolIdx < state.customToolIds.length) {
      slots[i] = state.customToolIds[toolIdx];
      toolIdx++;
    }
  }

  // Append any tools that didn't fit in the first 8 slots
  return [...slots, ...state.customToolIds.slice(toolIdx)];
};

const isSlotSelectable = (index: number, item: InventoryItemId | undefined): boolean => {
  if (index === 0) return true;
  return item != null;
};

interface GameState {
  inventoryCount: number;
  torchCount: number;
  stickCount: number;
  stoneCount: number;
  shardCount: number;
  luminousFloraCount: number;
  hasPickaxe: boolean;
  hasAxe: boolean;
  currentTool: ItemType.PICKAXE | ItemType.AXE;

  // Custom Tools
  customTools: Record<string, CustomTool>;
  customToolIds: string[];

  // Slots
  inventorySlots: InventoryItemId[];
  selectedSlotIndex: number;

  addItem: (item: ItemType, amount?: number) => void;
  removeItem: (item: ItemType, amount?: number) => void;
  addCustomTool: (tool: CustomTool) => void;
  updateCustomTool: (id: string, updates: Partial<CustomTool>) => void;
  removeCustomTool: (id: string) => void;
  getItemCount: (item: InventoryItemId) => number;

  addFlora: () => void;
  removeFlora: () => void;
  harvestFlora: () => void;
  setHasPickaxe: (has: boolean) => void;
  setHasAxe: (has: boolean) => void;
  setCurrentTool: (tool: ItemType.PICKAXE | ItemType.AXE) => void;

  setSelectedSlotIndex: (index: number) => void;
  cycleSlot: (direction: 1 | -1) => void;
}

export const useInventoryStore = create<GameState>((set, get) => ({
  inventoryCount: INITIAL_FLORA_COUNT,
  torchCount: 0,
  stickCount: 0,
  stoneCount: 0,
  shardCount: 0,
  luminousFloraCount: 0,
  hasPickaxe: false,
  hasAxe: false,
  currentTool: ItemType.PICKAXE,

  // Initialize with debug tools if in debug mode
  customTools: DEBUG_TOOLS.tools,
  customToolIds: DEBUG_TOOLS.ids,

  inventorySlots: computeSlots({
    inventoryCount: INITIAL_FLORA_COUNT,
    torchCount: 0,
    stickCount: 0,
    stoneCount: 0,
    shardCount: 0,
    hasPickaxe: false,
    hasAxe: false,
    customToolIds: DEBUG_TOOLS.ids
  }),
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

    const inventorySlots = computeSlots({
      ...nextCounts,
      hasPickaxe: state.hasPickaxe,
      hasAxe: state.hasAxe,
      customToolIds: state.customToolIds
    });
    return { ...nextCounts, inventorySlots };
  }),

  removeItem: (item, amount = 1) => set((state) => {
    const amt = Math.max(0, Math.floor(amount));
    if (amt === 0) return state;

    const metadata = ITEM_REGISTRY[item as ItemType];
    if (!metadata?.stateKey) return state;

    const nextCounts = {
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
    };

    (nextCounts as any)[metadata.stateKey] = Math.max(0, (nextCounts as any)[metadata.stateKey] - amt);

    const inventorySlots = computeSlots({
      ...nextCounts,
      hasPickaxe: state.hasPickaxe,
      hasAxe: state.hasAxe,
      customToolIds: state.customToolIds
    });

    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;

    return { ...nextCounts, inventorySlots, selectedSlotIndex };
  }),

  addCustomTool: (tool: CustomTool) => set((state) => {
    const customTools = { ...state.customTools, [tool.id]: tool };
    const customToolIds = [...state.customToolIds, tool.id];
    const inventorySlots = computeSlots({
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
      hasPickaxe: state.hasPickaxe,
      hasAxe: state.hasAxe,
      customToolIds
    });
    const selectedSlotIndex = inventorySlots.findIndex(s => s === tool.id);
    return { customTools, customToolIds, inventorySlots, selectedSlotIndex: selectedSlotIndex !== -1 ? selectedSlotIndex : state.selectedSlotIndex };
  }),

  updateCustomTool: (id: string, updates: Partial<CustomTool>) => set((state) => {
    if (!state.customTools[id]) return state;
    const customTools = {
      ...state.customTools,
      [id]: { ...state.customTools[id], ...updates }
    };
    return { customTools };
  }),

  removeCustomTool: (id: string) => set((state) => {
    const { [id]: _, ...customTools } = state.customTools;
    const customToolIds = state.customToolIds.filter(cid => cid !== id);
    const inventorySlots = computeSlots({
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
      hasPickaxe: state.hasPickaxe,
      hasAxe: state.hasAxe,
      customToolIds
    });

    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;

    return { customTools, customToolIds, inventorySlots, selectedSlotIndex };
  }),

  getItemCount: (item: InventoryItemId) => {
    if (!item) return 0;
    const state = get();
    if (typeof item === 'string' && state.customTools[item]) return 1;

    if (item === ItemType.STICK) return state.stickCount;
    if (item === ItemType.STONE) return state.stoneCount;
    if (item === ItemType.SHARD) return state.shardCount;
    if (item === ItemType.FLORA) return state.inventoryCount;
    if (item === ItemType.TORCH) return state.torchCount;

    return 0;
  },

  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  harvestFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),

  setHasPickaxe: (has: boolean) => set((state) => {
    const inventorySlots = computeSlots({
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
      hasPickaxe: has,
      hasAxe: state.hasAxe,
      customToolIds: state.customToolIds
    });
    const currentItem = inventorySlots[state.selectedSlotIndex];
    const selectedSlotIndex = isSlotSelectable(state.selectedSlotIndex, currentItem) ? state.selectedSlotIndex : 0;
    return { hasPickaxe: has, inventorySlots, selectedSlotIndex };
  }),

  setHasAxe: (has: boolean) => set((state) => {
    const nextTool = !has && state.currentTool === ItemType.AXE ? ItemType.PICKAXE : state.currentTool;
    const inventorySlots = computeSlots({
      inventoryCount: state.inventoryCount,
      torchCount: state.torchCount,
      stickCount: state.stickCount,
      stoneCount: state.stoneCount,
      shardCount: state.shardCount,
      hasPickaxe: state.hasPickaxe,
      hasAxe: has,
      customToolIds: state.customToolIds
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

    const nextTool: GameState['currentTool'] =
      selectedItem === ItemType.AXE && state.hasAxe ? ItemType.AXE : ItemType.PICKAXE;

    return { selectedSlotIndex: nextIndex, currentTool: nextTool };
  }),

  cycleSlot: (direction) => set((state) => {
    const total = state.inventorySlots.length;
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
