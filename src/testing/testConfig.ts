import { calculateOrbitAngle } from '@core/graphics/celestial';
import { WorldType } from '@features/terrain/logic/BiomeManager';
import type { WeatherPhase } from '@/state/WeatherStore';

/**
 * Test mode: `?test` or `?test=<scenario>` boots straight into a world (no
 * title, no loading screen, no "click to begin"), on a fixed seed, at a fixed
 * time and weather, with the mouse virtually captured, and exposes
 * `window.__vcTest` for scripted checks. See src/testing/README.md.
 *
 * Everything here is pure (parsed from a query string) so it can be unit tested.
 */
export type HudMode = 'normal' | 'awake' | 'hidden';

export interface TestParams {
  scenario: string;
  world?: WorldType;
  seed?: number;
  /** Explicit spawn column (overrides the scenario's). */
  at?: { x: number; z: number };
  /** Degrees; 0 looks down -Z. */
  yaw?: number;
  pitch?: number;
  /** Hour of day (6 sunrise, 12 noon, 18 sunset, 24 midnight), or 'live' to let the sun move. */
  time?: number | 'live';
  weather?: WeatherPhase;
  hud?: HudMode;
  /** Keep what earlier runs saved for this world (default: erase it before boot). */
  keep: boolean;
  /** Extra items, e.g. ['saw', 'stick:5']. */
  give: string[];
}

const WEATHER: readonly WeatherPhase[] = ['clear', 'gathering', 'rain', 'clearing'];
const HUD_MODES: readonly HudMode[] = ['normal', 'awake', 'hidden'];

const num = (v: string | null): number | undefined => {
  if (v == null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Null when the page is not in test mode. */
export function parseTestParams(search: string): TestParams | null {
  const p = new URLSearchParams(search);
  if (!p.has('test')) return null;
  const worldRaw = p.get('world')?.toUpperCase();
  const world = worldRaw && (Object.values(WorldType) as string[]).includes(worldRaw) ? (worldRaw as WorldType) : undefined;
  const seed = num(p.get('seed'));
  const atParts = p.get('at')?.split(',').map((s) => Number(s));
  const at = atParts && atParts.length === 2 && atParts.every(Number.isFinite) ? { x: atParts[0], z: atParts[1] } : undefined;
  const timeRaw = p.get('time');
  const time = timeRaw === 'live' ? 'live' : num(timeRaw);
  const weather = WEATHER.find((w) => w === p.get('weather'));
  const hud = HUD_MODES.find((h) => h === p.get('hud'));
  const give = (p.get('give') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    scenario: p.get('test') || 'meadow',
    world,
    seed: seed != null && seed > 0 ? Math.floor(seed) : undefined,
    at,
    yaw: num(p.get('yaw')),
    pitch: num(p.get('pitch')),
    time,
    weather,
    hud,
    keep: p.has('keep'),
    give,
  };
}

/**
 * Orbit angle for an hour of day: -PI/2 at sunrise (6), 0 at noon, PI/2 at
 * sunset (18), PI at midnight. Days and nights are each mapped evenly.
 */
export function orbitAngleForHour(hour: number): number {
  const h = ((((hour - 6) % 24) + 24) % 24) + 6; // 6..30
  return h <= 18
    ? -Math.PI / 2 + ((h - 6) / 12) * Math.PI
    : Math.PI / 2 + ((h - 18) / 12) * Math.PI;
}

/** The orbit offset that, with the orbit speed at 0, holds the sun at this hour. */
export function orbitOffsetForHour(hour: number): number {
  return orbitAngleForHour(hour) - calculateOrbitAngle(0, 0, 0);
}
