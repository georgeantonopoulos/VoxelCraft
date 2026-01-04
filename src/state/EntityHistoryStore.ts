import { create } from 'zustand';

export interface EntityHealth {
    id: string;
    maxHealth: number;
    health: number;
    lastHitTime: number;
    label: string;
}

interface EntityHistoryState {
    entities: Record<string, EntityHealth>;
    targetEntityId: string | null;
    damageEntity: (id: string, damage: number, maxHealth: number, label: string) => number; // returns new health
    setTargetEntity: (id: string | null) => void;
    clearDeadEntities: () => void;
}

export const useEntityHistoryStore = create<EntityHistoryState>((set, get) => ({
    entities: {},
    targetEntityId: null,

    damageEntity: (id, damage, maxHealth, label) => {
        const now = Date.now();
        const entities = { ...get().entities };

        if (!entities[id]) {
            entities[id] = { id, maxHealth, health: maxHealth, lastHitTime: now, label };
        }

        entities[id].health = Math.max(0, entities[id].health - damage);
        entities[id].lastHitTime = now;

        set({ entities, targetEntityId: id });

        return entities[id].health;
    },

    setTargetEntity: (id) => set({ targetEntityId: id }),

    clearDeadEntities: () => {
        const entities = { ...get().entities };
        Object.keys(entities).forEach(id => {
            if (entities[id].health <= 0 && Date.now() - entities[id].lastHitTime > 5000) {
                delete entities[id];
            }
        });
        set({ entities });
    }
}));
