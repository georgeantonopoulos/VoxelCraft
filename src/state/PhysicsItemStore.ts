import { create } from 'zustand';
import { ItemType, ActivePhysicsItem, CustomTool } from '@/types';

interface PhysicsItemState {
  items: ActivePhysicsItem[];
  spawnItem: (type: ItemType, pos: [number, number, number], velocity: [number, number, number], customToolData?: CustomTool, id?: string) => void;
  removeItem: (id: string) => void;
  bulkRemoveItems: (ids: string[]) => void;
  updateItem: (id: string, updates: Partial<ActivePhysicsItem>) => void;
}

export const usePhysicsItemStore = create<PhysicsItemState>((set) => ({
  items: [],
  spawnItem: (type, pos, velocity, customToolData, id) => set((state) => ({
    items: [
      ...state.items,
      {
        id: id || Math.random().toString(36).substr(2, 9),
        type,
        customToolData,
        position: pos,
        velocity: velocity,
      }
    ]
  })),
  removeItem: (id) => set((state) => ({
    items: state.items.filter((item) => item.id !== id)
  })),
  bulkRemoveItems: (ids) => set((state) => {
    const idSet = new Set(ids);
    return { items: state.items.filter((item) => !idSet.has(item.id)) };
  }),
  updateItem: (id, updates) => set((state) => ({
    items: state.items.map((item) =>
      item.id === id ? { ...item, ...updates } : item
    )
  }))
}));
