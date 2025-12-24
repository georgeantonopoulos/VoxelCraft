import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type QualityPreset = 'low' | 'medium' | 'high' | 'custom';
export type InputMode = 'mouse' | 'touch';

interface SettingsState {
  // Graphics
  resolutionScale: number; // 0.5 to 1.0
  qualityPreset: QualityPreset;
  shadows: boolean;
  ao: boolean;
  bloom: boolean;
  viewDistance: number; // multiplier for fog far

  // Controls
  inputMode: InputMode;

  // UI State (not persisted ideally, but putting it here for simplicity of access)
  isSettingsOpen: boolean;

  // Actions
  setResolutionScale: (scale: number) => void;
  setQualityPreset: (preset: QualityPreset) => void;
  setShadows: (enabled: boolean) => void;
  setAo: (enabled: boolean) => void;
  setBloom: (enabled: boolean) => void;
  setInputMode: (mode: InputMode) => void;
  toggleSettings: () => void;

  // Apply a preset (sets individual flags)
  applyPreset: (preset: QualityPreset) => void;
}

// Detect initial input mode
const getInitialInputMode = (): InputMode => {
  if (typeof window === 'undefined') return 'mouse';
  // Check for common mobile UA strings in addition to touch points
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const hasTouch = navigator.maxTouchPoints > 0;

  // Only default to touch if it's a mobile device and has touch points.
  // This prevents touchscreens on desktops from forcing touch mode.
  return (isMobile && hasTouch) ? 'touch' : 'mouse';
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      resolutionScale: 1.0,
      qualityPreset: 'high',
      shadows: true,
      ao: false,
      bloom: true,
      viewDistance: 1.0,
      inputMode: getInitialInputMode(),
      isSettingsOpen: false,

      setResolutionScale: (scale) => set({ resolutionScale: scale }),

      setQualityPreset: (preset) => {
        set({ qualityPreset: preset });
        get().applyPreset(preset);
      },

      setShadows: (enabled) => set({ shadows: enabled, qualityPreset: 'custom' }),
      setAo: (enabled) => set({ ao: enabled, qualityPreset: 'custom' }),
      setBloom: (enabled) => set({ bloom: enabled, qualityPreset: 'custom' }),

      setInputMode: (mode) => set({ inputMode: mode }),

      toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

      applyPreset: (preset) => {
        switch (preset) {
          case 'low':
            set({
              shadows: false,
              ao: false,
              bloom: false,
              viewDistance: 0.6,
            });
            break;
          case 'medium':
            set({
              shadows: true,
              ao: false,
              bloom: true,
              viewDistance: 0.8,
            });
            break;
          case 'high':
            set({
              shadows: true,
              ao: false, // AO is expensive - keep off by default even on high
              bloom: true,
              viewDistance: 1.0,
            });
            break;
          case 'custom':
            // Do nothing, keep current values
            break;
        }
      },
    }),
    {
      name: 'voxel-settings-storage', // name of the item in the storage (must be unique)
      partialize: (state) => ({
        // Persist these fields
        resolutionScale: state.resolutionScale,
        qualityPreset: state.qualityPreset,
        shadows: state.shadows,
        ao: state.ao,
        bloom: state.bloom,
        viewDistance: state.viewDistance,
        inputMode: state.inputMode,
      }),
    }
  )
);
