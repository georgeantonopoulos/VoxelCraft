import { create } from 'zustand';

export interface EntityHealth {
    id: string;
    maxHealth: number;
    health: number;
    lastHitTime: number;
    label: string;
}

export const DEAD_ENTITY_RETENTION_MS = 5000;

interface EntityHistoryState {
    entities: Record<string, EntityHealth>;
    targetEntityId: string | null;
    damageEntity: (id: string, damage: number, maxHealth: number, label: string) => number; // returns new health
    setTargetEntity: (id: string | null) => void;
    clearDeadEntities: () => void;
    reset: () => void;
}

export const useEntityHistoryStore = create<EntityHistoryState>((set, get) => ({
    entities: {},
    targetEntityId: null,

    damageEntity: (id, damage, maxHealth, label) => {
        const now = Date.now();
        const entities = { ...get().entities };
        const current = entities[id] ?? { id, maxHealth, health: maxHealth, lastHitTime: now, label };

        // Replace the entry instead of mutating its nested object so selectors can
        // reliably observe every damage event.
        entities[id] = {
            ...current,
            health: Math.max(0, current.health - damage),
            lastHitTime: now,
        };

        set({ entities, targetEntityId: id });

        return entities[id].health;
    },

    setTargetEntity: (id) => set({ targetEntityId: id }),

    reset: () => set({ entities: {}, targetEntityId: null }),

    clearDeadEntities: () => {
        const state = get();
        const now = Date.now();
        const expiredIds = Object.keys(state.entities).filter((id) => {
            const entity = state.entities[id];
            return entity.health <= 0 && now - entity.lastHitTime >= DEAD_ENTITY_RETENTION_MS;
        });

        // Avoid notifying every health-bar subscriber once per second when there
        // is no lifecycle work to do.
        if (expiredIds.length === 0) return;

        const entities = { ...state.entities };
        expiredIds.forEach((id) => delete entities[id]);
        const targetEntityId = state.targetEntityId && !entities[state.targetEntityId]
            ? null
            : state.targetEntityId;

        set({ entities, targetEntityId });
    }
}));
