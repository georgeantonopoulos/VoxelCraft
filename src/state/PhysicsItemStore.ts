import { create } from 'zustand';
import { ItemType, ActivePhysicsItem } from '@/types';

interface PhysicsItemState {
  items: ActivePhysicsItem[];
  spawnItem: (type: ItemType, pos: [number, number, number], velocity: [number, number, number]) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<ActivePhysicsItem>) => void;
}

export const usePhysicsItemStore = create<PhysicsItemState>((set) => ({
  items: [],
  spawnItem: (type, pos, velocity) => set((state) => ({
    items: [
      ...state.items,
      {
        id: Math.random().toString(36).substr(2, 9),
        type,
        position: pos,
        velocity: velocity,
      }
    ]
  })),
  removeItem: (id) => set((state) => ({
    items: state.items.filter((item) => item.id !== id)
  })),
  updateItem: (id, updates) => set((state) => ({
    items: state.items.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    )
  }))
}));
