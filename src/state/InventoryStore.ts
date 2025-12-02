import { create } from 'zustand';

interface GameState {
  inventoryCount: number;
  addFlora: () => void;
  removeFlora: () => void;
  harvestFlora: () => void;
}

export const useInventoryStore = create<GameState>((set) => ({
  inventoryCount: 0,
  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  harvestFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
}));
