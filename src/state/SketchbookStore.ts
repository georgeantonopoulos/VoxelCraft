import { create } from 'zustand';

/** The Keeper's worn building sketches (J, or the pause screen). */
interface SketchbookState {
  open: boolean;
  page: number;
  setOpen: (open: boolean) => void;
  setPage: (page: number) => void;
}

export const useSketchbookStore = create<SketchbookState>((set) => ({
  open: false,
  page: 0,
  setOpen: (open) => set({ open }),
  setPage: (page) => set({ page }),
}));

export const isSketchbookOpen = (): boolean => useSketchbookStore.getState().open;
