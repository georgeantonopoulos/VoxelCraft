import { create } from 'zustand';

interface GameState {
  inventoryCount: number;
  luminousFloraCount: number;
  hasAxe: boolean;
  addFlora: () => void;
  removeFlora: () => void;
  harvestFlora: () => void;
  addLuminousFlora: () => void;
  removeLuminousFlora: () => void;
  setHasAxe: (has: boolean) => void;
}

export const useInventoryStore = create<GameState>((set) => ({
  inventoryCount: 0,
  luminousFloraCount: 0,
  hasAxe: true,
  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  harvestFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  addLuminousFlora: () => set((state) => ({ luminousFloraCount: state.luminousFloraCount + 1 })),
  removeLuminousFlora: () => set((state) => ({ luminousFloraCount: Math.max(0, state.luminousFloraCount - 1) })),
  setHasAxe: (has: boolean) => set({ hasAxe: has }),
}));
