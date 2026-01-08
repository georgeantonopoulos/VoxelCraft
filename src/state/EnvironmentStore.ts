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

  /**
   * Underwater blend factor from 0 (not underwater) to 1 (fully underwater).
   * AtmosphereController updates it based on camera position + voxel water queries,
   * and gameplay systems can optionally read it for effects.
   */
  underwaterBlend: number;
  setUnderwaterBlend: (blend: number) => void;
  /**
   * Discrete underwater state with a timestamp (seconds since start).
   * Used for timing effects or audio transitions.
   */
  isUnderwater: boolean;
  underwaterChangedAt: number;
  setUnderwaterState: (isUnderwater: boolean, changedAt: number) => void;

  /**
   * Estimated sky visibility from the camera area.
   * 1.0 = open sky, 0.0 = strongly occluded (deep cave/overhang).
   *
   * Updated by AtmosphereController using runtime voxel queries (TerrainRuntime.estimateSkyVisibility).
   */
  skyVisibility: number;
  setSkyVisibility: (v: number) => void;
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

  underwaterBlend: 0,
  setUnderwaterBlend: (blend) =>
    set({
      underwaterBlend: Math.min(1, Math.max(0, blend)),
    }),
  isUnderwater: false,
  underwaterChangedAt: 0,
  setUnderwaterState: (isUnderwater, changedAt) =>
    set((state) => {
      if (state.isUnderwater === isUnderwater) return state;
      return {
        isUnderwater,
        underwaterChangedAt: changedAt,
      };
    }),

  skyVisibility: 1,
  setSkyVisibility: (v) =>
    set({
      skyVisibility: Math.min(1, Math.max(0, v)),
    }),
}));
