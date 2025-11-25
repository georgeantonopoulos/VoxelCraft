import { create } from 'zustand';
import * as THREE from 'three';

interface GameState {
  inventoryCount: number;
  placedFloras: Array<{ id: string; position: THREE.Vector3 }>;
  addFlora: () => void;
  removeFlora: () => void;
  placeFlora: (position: THREE.Vector3) => void;
}

export const useGameStore = create<GameState>((set) => ({
  inventoryCount: 0,
  placedFloras: [],
  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  placeFlora: (position) =>
    set((state) => ({
      placedFloras: [
        ...state.placedFloras,
        { id: Math.random().toString(36).substr(2, 9), position },
      ],
      inventoryCount: state.inventoryCount - 1,
    })),
}));
