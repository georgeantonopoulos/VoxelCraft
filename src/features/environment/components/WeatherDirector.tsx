import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useWeatherStore, WEATHER_PHASES, NEXT_PHASE, PHASE_TARGETS, type WeatherPhase } from '@/state/WeatherStore';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { useGroveStore } from '@/state/GroveStore';

/**
 * Headless: advances the weather phases and eases overcast/rain toward the
 * phase targets (clouds gather over about a minute; rain builds and fades
 * over about half a minute). Writes shared uniforms every frame and the store
 * a few times a second. The first rain in a world is announced once.
 * Debug: window.__weather.set('rain' | 'clear' | 'gathering' | 'clearing').
 */
const RAIN_TOLD_KEY = 'vc-rain-told-v1';

const pick = ([a, b]: [number, number]) => a + Math.random() * (b - a);

export const WeatherDirector: React.FC = () => {
  const levels = useRef({ overcast: 0, rain: 0, sync: 0 });

  useEffect(() => {
    const api = {
      set: (phase: WeatherPhase) => useWeatherStore.getState().setPhase(phase, pick(WEATHER_PHASES[phase])),
      get: () => useWeatherStore.getState(),
    };
    (window as unknown as { __weather?: typeof api }).__weather = api;
    return () => { delete (window as unknown as { __weather?: typeof api }).__weather; };
  }, []);

  // First rain in a world: say what it means, once.
  useEffect(() => useWeatherStore.subscribe((s, prev) => {
    if (s.phase !== 'rain' || prev.phase === 'rain') return;
    try {
      if (window.localStorage.getItem(RAIN_TOLD_KEY)) return;
      window.localStorage.setItem(RAIN_TOLD_KEY, '1');
    } catch { /* storage unavailable: tell anyway */ }
    useGroveStore.getState().announce({ kind: 'discovery', title: 'Rain', detail: 'Fires and torches in the open will go out' });
  }), []);

  // The countdown lives here (writing the store every frame would re-render
  // its subscribers); the store is synced a few times a second.
  const clock = useRef<{ phase: WeatherPhase; remaining: number }>({ phase: 'clear', remaining: pick(WEATHER_PHASES.clear) });

  useFrame((_st, delta) => {
    const dt = Math.min(delta, 0.1);
    const c = clock.current;
    const w = useWeatherStore.getState();
    if (w.phase !== c.phase && w.remaining !== c.remaining) { c.phase = w.phase; c.remaining = w.remaining; } // set externally (debug)
    c.remaining -= dt;
    if (c.remaining <= 0) {
      c.phase = NEXT_PHASE[c.phase];
      c.remaining = pick(WEATHER_PHASES[c.phase]);
    }
    const target = PHASE_TARGETS[c.phase];
    const l = levels.current;
    const step = (cur: number, to: number, perSecond: number) => cur + Math.sign(to - cur) * Math.min(Math.abs(to - cur), perSecond * dt);
    l.overcast = step(l.overcast, target.overcast, 1 / 40);
    l.rain = step(l.rain, target.rain, 1 / 25);
    sharedUniforms.uOvercast.value = l.overcast;
    sharedUniforms.uRain.value = l.rain;
    l.sync += dt;
    if (c.phase !== w.phase || l.sync > 0.25) {
      l.sync = 0;
      useWeatherStore.setState({ phase: c.phase, remaining: c.remaining, overcast: l.overcast, rain: l.rain });
    }
  });

  return null;
};
