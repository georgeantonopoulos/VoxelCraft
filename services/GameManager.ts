import { create } from 'zustand';
import * as THREE from 'three';
import React from 'react';

interface GameState {
  inventoryCount: number;
  placedFloras: Array<{ id: string; position: THREE.Vector3; bodyRef: React.RefObject<any> }>;
  addFlora: () => void;
  removeFlora: () => void;
  placeFlora: (position: THREE.Vector3, bodyRef: React.RefObject<any>) => void;
  harvestFlora: (id: string) => void;
  consumeFlora: (id: string) => void;
}

export const useGameStore = create<GameState>((set) => ({
  inventoryCount: 0,
  placedFloras: [],
  addFlora: () => set((state) => ({ inventoryCount: state.inventoryCount + 1 })),
  removeFlora: () => set((state) => ({ inventoryCount: Math.max(0, state.inventoryCount - 1) })),
  placeFlora: (position, bodyRef) =>
    set((state) => ({
      placedFloras: [
        ...state.placedFloras,
        { id: Math.random().toString(36).substr(2, 9), position, bodyRef },
      ],
      inventoryCount: state.inventoryCount - 1,
    })),
  harvestFlora: (id) =>
    set((state) => ({
      inventoryCount: state.inventoryCount + 1,
      placedFloras: state.placedFloras.filter((flora) => flora.id !== id),
    })),
  consumeFlora: (id) =>
    set((state) => ({
      placedFloras: state.placedFloras.filter((flora) => flora.id !== id),
    })),
}));
