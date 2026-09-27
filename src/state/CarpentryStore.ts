import { create } from 'zustand';

/** The carpentry menu at a workbench (open while `benchId` is set). */
interface CarpentryState {
  benchId: string | null;
  open: (benchId: string) => void;
  close: () => void;
}

export const useCarpentryStore = create<CarpentryState>((set) => ({
  benchId: null,
  open: (benchId) => set({ benchId }),
  close: () => set({ benchId: null }),
}));

/** Is a full-screen menu that owns the mouse and keyboard open (tool bench or carpentry)? */
export const isCarpentryOpen = (): boolean => useCarpentryStore.getState().benchId !== null;
