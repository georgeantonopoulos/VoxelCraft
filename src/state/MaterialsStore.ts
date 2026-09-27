import { create } from 'zustand';

/**
 * The builder's pouch: small things that are never held in the hand, only
 * used at the workbench. Copper nuggets come out of veins in the rock when
 * digging; hinge pairs are carved at the bench (a plank and copper pins) and
 * hung on doors. Saved per world seed (`vc-materials-v1-<seed>`), bound by
 * LogsLayer alongside the logs.
 */
export interface Materials {
  copper: number;
  hinges: number;
}

export type MaterialId = keyof Materials;

interface MaterialsState extends Materials {
  add: (id: MaterialId, amount?: number) => void;
  /** Takes `amount` if there is enough; returns whether it did. */
  spend: (id: MaterialId, amount?: number) => boolean;
  load: (saved: Partial<Materials> | null) => void;
}

const EMPTY: Materials = { copper: 0, hinges: 0 };

export const MATERIALS_PREFIX = 'vc-materials-v1-';

export const useMaterialsStore = create<MaterialsState>((set, get) => ({
  ...EMPTY,
  add: (id, amount = 1) => set({ [id]: get()[id] + Math.max(0, Math.floor(amount)) } as Pick<Materials, MaterialId>),
  spend: (id, amount = 1) => {
    if (get()[id] < amount) return false;
    set({ [id]: get()[id] - amount } as Pick<Materials, MaterialId>);
    return true;
  },
  load: (saved) => set({
    copper: Math.max(0, Math.floor(saved?.copper ?? 0)),
    hinges: Math.max(0, Math.floor(saved?.hinges ?? 0)),
  }),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __materials?: typeof useMaterialsStore }).__materials = useMaterialsStore;
}
