import { WorldType } from '@features/terrain/logic/BiomeManager';
import type { WeatherPhase } from '@/state/WeatherStore';
import { eraseWorldData, listWorlds } from '@/state/savedWorlds';
import { setVirtualPointerCapture } from '@core/input/pointerCapture';
import { parseTestParams, type HudMode, type TestParams } from './testConfig';
import { DEFAULT_TEST_SEED, SCENARIOS, type Scenario, type SpawnSpot } from './scenarios';

/**
 * The resolved test-mode settings for this page load (null outside `?test`):
 * URL parameters over the scenario's defaults over the test defaults.
 */
export interface ResolvedTest {
  name: string;
  params: TestParams;
  scenario: Scenario;
  world: WorldType;
  seed: number;
  hour: number | 'live';
  weather: WeatherPhase;
  hud: HudMode;
  give: string[];
}

const DEFAULT_HOUR = 10.5;

/** Everything logged as an error since boot (console.error, uncaught errors, rejected promises). */
export const testErrors: string[] = [];
/** Set once SceneWarmup has compiled the scene's shaders. */
export const testFlags = { warmupDone: false };

const resolve = (): ResolvedTest | null => {
  if (typeof window === 'undefined') return null;
  const params = parseTestParams(window.location.search);
  if (!params) return null;
  let name = params.scenario;
  if (!SCENARIOS[name]) {
    testErrors.push(`[vcTest] unknown scenario "${name}", using meadow. Known: ${Object.keys(SCENARIOS).join(', ')}`);
    name = 'meadow';
  }
  const scenario = SCENARIOS[name];
  return {
    name,
    params,
    scenario,
    world: params.world ?? scenario.world ?? WorldType.DEFAULT,
    seed: params.seed ?? scenario.seed ?? DEFAULT_TEST_SEED,
    hour: params.time ?? scenario.time ?? DEFAULT_HOUR,
    weather: params.weather ?? scenario.weather ?? 'clear',
    hud: params.hud ?? 'normal',
    give: [...(scenario.give ?? []), ...params.give],
  };
};

export const TEST: ResolvedTest | null = resolve();

const MAX_ERRORS = 200;
const record = (msg: string) => {
  if (testErrors.length < MAX_ERRORS) testErrors.push(msg);
};
const describe = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
};

if (TEST) {
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    record(args.map(describe).join(' ').slice(0, 2000));
    origError(...args);
  };
  window.addEventListener('error', (e) => record(`uncaught: ${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => record(`unhandled rejection: ${describe(e.reason)}`));
  window.addEventListener('vc-warmup-done', () => { testFlags.warmupDone = true; });
}

/**
 * Before the world loads: erase what earlier test runs saved for this world
 * (unless `keep`, or the seed belongs to a world in the player's list), skip
 * first-play notices, and take the mouse virtually.
 */
export async function prepareTestWorld(test: ResolvedTest): Promise<void> {
  setVirtualPointerCapture(true);
  try {
    window.localStorage.setItem('vc-controls-seen-v1', '1');
    window.localStorage.setItem('vc-rain-told-v1', '1');
  } catch { /* storage blocked */ }
  if (test.params.keep) return;
  if (listWorlds().some((w) => w.seed === test.seed)) {
    console.warn(`[vcTest] seed ${test.seed} is one of your saved worlds: its saves are left alone (runs are not fresh).`);
    return;
  }
  await eraseWorldData(test.world, test.seed, true);
}

/** Where to stand: `at=` from the URL, else the scenario's spot, else null (the normal spawn). */
export function resolveTestSpawn(test: ResolvedTest): SpawnSpot | null {
  let spot: SpawnSpot | null = null;
  if (test.params.at) spot = { ...test.params.at };
  else if (test.scenario.spawn) {
    try {
      spot = test.scenario.spawn();
      if (!spot) record(`[vcTest] scenario "${test.name}" found no spawn spot; using the normal spawn`);
    } catch (e) {
      record(`[vcTest] scenario "${test.name}" spawn failed: ${describe(e)}`);
    }
  }
  return spot;
}

/** The first view (radians): URL yaw/pitch (degrees) over the spawn spot's, else level with the land. */
export function initialView(test: ResolvedTest, spot: SpawnSpot | null): { yaw: number | null; pitch: number } {
  const deg = Math.PI / 180;
  return {
    yaw: test.params.yaw != null ? test.params.yaw * deg : spot?.yaw ?? null,
    pitch: test.params.pitch != null ? test.params.pitch * deg : spot?.pitch ?? -0.08,
  };
}
