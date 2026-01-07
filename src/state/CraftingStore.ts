import { create } from 'zustand';
import { ItemType } from '@/types';

interface CraftingState {
  isOpen: boolean;
  baseItem: ItemType | null;
  attachedItems: Record<string, ItemType>; // slotId -> itemType
  editingToolId: string | null;
  draggedItem: ItemType | null;

  openCrafting: (base: ItemType, existingToolId?: string, attachments?: Record<string, ItemType>) => void;
  closeCrafting: () => void;
  attach: (slotId: string, item: ItemType) => void;
  detach: (slotId: string) => void;
  clearAttachments: () => void;
  setDraggedItem: (item: ItemType | null) => void;
}

export const useCraftingStore = create<CraftingState>((set) => ({
  isOpen: false,
  baseItem: null,
  attachedItems: {},
  editingToolId: null,
  draggedItem: null,

  openCrafting: (base, existingToolId, attachments) => set({
    isOpen: true,
    baseItem: base,
    editingToolId: existingToolId || null,
    attachedItems: attachments || {},
    draggedItem: null
  }),

  closeCrafting: () => set({
    isOpen: false,
    baseItem: null,
    editingToolId: null,
    attachedItems: {},
    draggedItem: null
  }),

  attach: (slotId, item) => set((state) => ({
    attachedItems: { ...state.attachedItems, [slotId]: item }
  })),

  detach: (slotId) => set((state) => {
    const next = { ...state.attachedItems };
    delete next[slotId];
    return { attachedItems: next };
  }),

  clearAttachments: () => set({ attachedItems: {} }),
  setDraggedItem: (item) => set({ draggedItem: item })
}));
