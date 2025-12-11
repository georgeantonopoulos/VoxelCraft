import { create } from 'zustand';

/**
 * EnvironmentStore
 * Central place for scene-wide environment state that multiple components need.
 *
 * Right now it only tracks how "underground" the player is, as a smooth blend
 * factor from 0 (surface) to 1 (deep cave). AtmosphereController updates it,
 * and lighting components (Sun/Moon/Ambient) read it to adjust visuals.
 */
interface EnvironmentState {
  undergroundBlend: number;
  setUndergroundBlend: (blend: number) => void;
  /**
   * Discrete underground state with a timestamp (seconds since start).
   * Used for timing one-off transitions like torch slide-in.
   */
  isUnderground: boolean;
  undergroundChangedAt: number;
  setUndergroundState: (isUnderground: boolean, changedAt: number) => void;
}

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  undergroundBlend: 0,
  setUndergroundBlend: (blend) =>
    set({
      undergroundBlend: Math.min(1, Math.max(0, blend)),
    }),
  isUnderground: false,
  undergroundChangedAt: 0,
  setUndergroundState: (isUnderground, changedAt) =>
    set((state) => {
      if (state.isUnderground === isUnderground) return state;
      return {
        isUnderground,
        undergroundChangedAt: changedAt,
      };
    }),
}));
