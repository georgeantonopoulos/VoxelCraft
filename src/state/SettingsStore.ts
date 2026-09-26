import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type InputMode = 'mouse' | 'touch';

interface SettingsState {
  // Graphics
  resolutionScale: number; // 0.25 to 2.0 (DPR - device pixel ratio)
  qualityPreset: QualityPreset;
  shadows: boolean;
  ao: boolean;
  bloom: boolean;
  viewDistance: number; // multiplier for fog far
  godRays: boolean; // screen-space sun shafts
  antialias: boolean; // SMAA post-process anti-aliasing
  dynamicResolution: boolean; // scale DPR down under load, back up with headroom
  aoQuality: 'performance' | 'high';
  grassDensity: number; // multiplier on blade grass instance counts (0.35..1.3)

  // Audio (0..1)
  masterVolume: number;
  ambienceVolume: number;
  musicVolume: number;

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
  setGodRays: (enabled: boolean) => void;
  setAntialias: (enabled: boolean) => void;
  setDynamicResolution: (enabled: boolean) => void;
  setInputMode: (mode: InputMode) => void;
  setMasterVolume: (v: number) => void;
  setAmbienceVolume: (v: number) => void;
  setMusicVolume: (v: number) => void;
  setViewDistance: (v: number) => void;
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
      resolutionScale: 1.0, // DPR 1.0 = CSS pixel resolution (good balance for most displays)
      qualityPreset: 'high',
      shadows: true,
      ao: false,
      bloom: true,
      viewDistance: 1.0,
      godRays: true,
      antialias: true,
      dynamicResolution: true,
      aoQuality: 'performance',
      grassDensity: 1.0,
      masterVolume: 0.8,
      ambienceVolume: 1.0,
      musicVolume: 0.6,
      inputMode: getInitialInputMode(),
      isSettingsOpen: false,
      setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
      setAmbienceVolume: (v) => set({ ambienceVolume: Math.max(0, Math.min(1, v)) }),
      setMusicVolume: (v) => set({ musicVolume: Math.max(0, Math.min(1, v)) }),
      setViewDistance: (v) => set({ viewDistance: Math.max(0.5, Math.min(1.5, v)), qualityPreset: 'custom' }),

      setResolutionScale: (scale) => set({ resolutionScale: scale }),

      setQualityPreset: (preset) => {
        set({ qualityPreset: preset });
        get().applyPreset(preset);
      },

      setShadows: (enabled) => set({ shadows: enabled, qualityPreset: 'custom' }),
      setAo: (enabled) => set({ ao: enabled, qualityPreset: 'custom' }),
      setBloom: (enabled) => set({ bloom: enabled, qualityPreset: 'custom' }),
      setGodRays: (enabled) => set({ godRays: enabled, qualityPreset: 'custom' }),
      setAntialias: (enabled) => set({ antialias: enabled, qualityPreset: 'custom' }),
      // Not a visual-quality knob, so it does not flip the preset to custom.
      setDynamicResolution: (enabled) => set({ dynamicResolution: enabled }),

      setInputMode: (mode) => set({ inputMode: mode }),

      toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),

      applyPreset: (preset) => {
        switch (preset) {
          case 'low':
            set({
              shadows: false,
              ao: false,
              bloom: false,
              godRays: false,
              antialias: false,
              aoQuality: 'performance',
              grassDensity: 0.35,
              viewDistance: 0.6,
            });
            break;
          case 'medium':
            set({
              shadows: true,
              ao: false,
              bloom: true,
              godRays: false,
              antialias: true,
              aoQuality: 'performance',
              grassDensity: 0.6,
              viewDistance: 0.8,
            });
            break;
          case 'high':
            set({
              shadows: true,
              ao: false, // AO is expensive - keep off by default even on high
              bloom: true,
              godRays: true,
              antialias: true,
              aoQuality: 'performance',
              grassDensity: 1.0,
              viewDistance: 1.0,
            });
            break;
          case 'ultra':
            // Full cinematic stack; dynamic resolution keeps it smooth under load.
            set({
              shadows: true,
              ao: true,
              bloom: true,
              godRays: true,
              antialias: true,
              aoQuality: 'high',
              grassDensity: 1.3,
              viewDistance: 1.25,
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
        godRays: state.godRays,
        antialias: state.antialias,
        dynamicResolution: state.dynamicResolution,
        aoQuality: state.aoQuality,
        grassDensity: state.grassDensity,
        inputMode: state.inputMode,
        masterVolume: state.masterVolume,
        ambienceVolume: state.ambienceVolume,
        musicVolume: state.musicVolume,
      }),
    }
  )
);
