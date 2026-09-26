import { create } from 'zustand';

/**
 * Weather: long clear spells, then clouds gather and a slow rain falls for a
 * few minutes before clearing. `overcast` and `rain` are smooth 0..1 levels
 * read every frame (sky, light, ground wetness, rain streaks, audio) and by
 * the fire/torch dousing logic. Phases advance in WeatherDirector.
 */
export type WeatherPhase = 'clear' | 'gathering' | 'rain' | 'clearing';

interface WeatherState {
  phase: WeatherPhase;
  /** Seconds left in the current phase. */
  remaining: number;
  overcast: number;
  rain: number;
  /** The player has cover overhead (RainFX checks a few times a second). */
  sheltered: boolean;
  setPhase: (phase: WeatherPhase, seconds: number) => void;
  setLevels: (overcast: number, rain: number) => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
  phase: 'clear',
  remaining: 360,
  overcast: 0,
  rain: 0,
  sheltered: false,
  setPhase: (phase, seconds) => set({ phase, remaining: seconds }),
  setLevels: (overcast, rain) => set({ overcast, rain }),
}));

/** Phase lengths in seconds [min, max]. */
export const WEATHER_PHASES: Record<WeatherPhase, [number, number]> = {
  clear: [420, 900],
  gathering: [50, 80],
  rain: [150, 260],
  clearing: [60, 90],
};

export const NEXT_PHASE: Record<WeatherPhase, WeatherPhase> = {
  clear: 'gathering',
  gathering: 'rain',
  rain: 'clearing',
  clearing: 'clear',
};

/** Target overcast / rain levels a phase eases toward. */
export const PHASE_TARGETS: Record<WeatherPhase, { overcast: number; rain: number }> = {
  clear: { overcast: 0, rain: 0 },
  gathering: { overcast: 0.85, rain: 0 },
  rain: { overcast: 1, rain: 1 },
  clearing: { overcast: 0.35, rain: 0 },
};
