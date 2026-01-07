import { create } from 'zustand';
import * as THREE from 'three';

export interface CarriedLog {
    id: string;
    treeType: number;
    seed: number;
}

interface CarryingState {
    /** The log currently being carried, or null if not carrying */
    carriedLog: CarriedLog | null;

    /** Start carrying a log */
    pickUp: (log: CarriedLog) => void;

    /** Drop the currently carried log */
    drop: () => CarriedLog | null;

    /** Check if player is carrying a log */
    isCarrying: () => boolean;
}

export const useCarryingStore = create<CarryingState>((set, get) => ({
    carriedLog: null,

    pickUp: (log: CarriedLog) => {
        set({ carriedLog: log });
    },

    drop: () => {
        const log = get().carriedLog;
        set({ carriedLog: null });
        return log;
    },

    isCarrying: () => {
        return get().carriedLog !== null;
    },
}));
