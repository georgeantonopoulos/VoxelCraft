import { create } from 'zustand';

interface InputState {
  // Joystick vector (-1 to 1)
  moveVector: { x: number; y: number };

  // Look delta (accumulated pixels)
  lookDelta: { x: number; y: number };

  // Button states
  isJumping: boolean;
  isDigging: boolean;
  isBuilding: boolean;
  interactionAction: 'DIG' | 'BUILD' | null;

  // Actions
  setMoveVector: (x: number, y: number) => void;
  setLookDelta: (x: number, y: number) => void;
  setJumping: (v: boolean) => void;
  setDigging: (v: boolean) => void;
  setBuilding: (v: boolean) => void;
  setInteractionAction: (v: 'DIG' | 'BUILD' | null) => void;
  resetInput: () => void;
}

export const useInputStore = create<InputState>((set) => ({
  moveVector: { x: 0, y: 0 },
  lookDelta: { x: 0, y: 0 },
  isJumping: false,
  isDigging: false,
  isBuilding: false,
  interactionAction: null,

  setMoveVector: (x, y) => set({ moveVector: { x, y } }),
  setLookDelta: (x, y) => set({ lookDelta: { x, y } }),
  setJumping: (v) => set({ isJumping: v }),
  setDigging: (v) => set({ isDigging: v }),
  setBuilding: (v) => set({ isBuilding: v }),
  setInteractionAction: (v) => set({ interactionAction: v }),

  resetInput: () => set({
    moveVector: { x: 0, y: 0 },
    lookDelta: { x: 0, y: 0 },
    isJumping: false,
    isDigging: false,
    isBuilding: false,
    interactionAction: null,
  })
}));
