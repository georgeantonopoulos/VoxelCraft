import { create } from 'zustand';
import { ItemType } from '@/types';

interface CraftingState {
  isOpen: boolean;
  baseItem: ItemType | null;
  attachedItems: Record<string, ItemType>; // slotId -> itemType
  draggedItem: ItemType | null;

  openCrafting: (base: ItemType) => void;
  closeCrafting: () => void;
  attach: (slotId: string, item: ItemType) => void;
  clearAttachments: () => void;
  setDraggedItem: (item: ItemType | null) => void;
}

export const useCraftingStore = create<CraftingState>((set) => ({
  isOpen: false,
  baseItem: null,
  attachedItems: {},
  draggedItem: null,

  openCrafting: (base) => set({ isOpen: true, baseItem: base, attachedItems: {}, draggedItem: null }),
  closeCrafting: () => set({ isOpen: false, baseItem: null, attachedItems: {}, draggedItem: null }),

  attach: (slotId, item) => set((state) => ({
    attachedItems: { ...state.attachedItems, [slotId]: item }
  })),

  clearAttachments: () => set({ attachedItems: {} }),
  setDraggedItem: (item) => set({ draggedItem: item })
}));
