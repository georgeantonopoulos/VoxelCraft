import { create } from 'zustand';
import { ItemType } from '@/types';

interface CraftingState {
  isOpen: boolean;
  baseItem: ItemType | null;
  attachedItems: Record<string, ItemType>; // slotId -> itemType

  openCrafting: (base: ItemType) => void;
  closeCrafting: () => void;
  attach: (slotId: string, item: ItemType) => void;
  clearAttachments: () => void;
}

export const useCraftingStore = create<CraftingState>((set) => ({
  isOpen: false,
  baseItem: null,
  attachedItems: {},

  openCrafting: (base) => set({ isOpen: true, baseItem: base, attachedItems: {} }),
  closeCrafting: () => set({ isOpen: false, baseItem: null, attachedItems: {} }),

  attach: (slotId, item) => set((state) => ({
    attachedItems: { ...state.attachedItems, [slotId]: item }
  })),

  clearAttachments: () => set({ attachedItems: {} })
}));
