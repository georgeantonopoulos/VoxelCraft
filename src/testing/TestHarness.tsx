import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ItemType, type CustomTool } from '@/types';
import { useInventoryStore } from '@/state/InventoryStore';
import { useMaterialsStore } from '@/state/MaterialsStore';
import { useHudPresence } from '@/state/HudPresenceStore';
import { useLogStore } from '@/state/LogStore';
import { useGroveStore } from '@/state/GroveStore';
import { useWeatherStore, type WeatherPhase } from '@/state/WeatherStore';
import { chunkDataManager } from '@core/terrain/ChunkDataManager';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { orbitOffsetForHour, type HudMode } from './testConfig';
import { initialView, testErrors, testFlags, type ResolvedTest } from './testMode';
import { SCENARIOS, openViewYaw, type SpawnSpot } from './scenarios';

/**
 * window.__vcTest: one scripting surface for automated checks in test mode.
 * Angles are in DEGREES here (yaw 0 looks down -Z, positive turns left;
 * pitch negative looks down). Everything async returns a promise.
 */
export interface VcTestApi {
  config: { scenario: string; world: string; seed: number; hour: number | 'live'; weather: WeatherPhase; hud: HudMode };
  isReady: boolean;
  /** Resolves once terrain, colliders, shaders and the scenario are all ready. */
  ready: () => Promise<ReadyReport>;
  /** Game state as a plain object (player, camera, inventory, grove, weather, logs, errors). */
  state: () => Record<string, unknown>;
  errors: () => string[];
  clearErrors: () => void;
  player: () => { x: number; y: number; z: number };
  camera: () => { yaw: number; pitch: number; yawDeg: number; pitchDeg: number };
  teleport: (x: number, y: number, z: number) => void;
  /** Teleport to the surface at (x, z), waiting for its chunk to load. */
  goto: (x: number, z: number) => Promise<boolean>;
  /** Wait until the player stands still on ground. */
  settle: (timeoutMs?: number) => Promise<boolean>;
  look: (yawDeg: number, pitchDeg?: number) => void;
  lookAt: (x: number, y: number, z: number) => void;
  /** Physical ground height (terrain collider), falling back to the generator's surface. */
  groundAt: (x: number, z: number) => number;
  /** What the crosshair rests on (physics ray), or null. */
  aim: (max?: number) => unknown;
  setTime: (hour: number | 'live') => void;
  setWeather: (phase: WeatherPhase, instant?: boolean) => void;
  /** Items: pickaxe, axe, torch[:n], stick[:n], stone[:n], shard[:n], flora[:n], saw, pick, flintaxe, maul, spear, copper[:n], hinge[:n], all. Returns unknown tokens. */
  give: (...items: string[]) => string[];
  /** Hotbar slot 1-9 and beyond. */
  select: (slot: number) => void;
  hud: (mode: HudMode) => void;
  /** Press a key (KeyboardEvent.code, e.g. 'KeyW', 'KeyQ', 'Digit3', 'Space') for ms. */
  key: (code: string, ms?: number) => Promise<void>;
  /** Mouse press at the crosshair. */
  click: (button?: 'left' | 'right', ms?: number) => Promise<void>;
  wait: (ms: number) => Promise<void>;
  /** Wait for n rendered frames. */
  frames: (n?: number) => Promise<void>;
  /** Average rendered fps over a few seconds. */
  fps: (seconds?: number) => Promise<number>;
  scenarios: () => { name: string; description: string }[];
}

export interface ReadyReport {
  ok: boolean;
  /** Milliseconds since navigation start. */
  ms: number;
  scenario: string;
  world: string;
  seed: number;
  player: { x: number; y: number; z: number } | null;
  errors: string[];
  failed?: string;
}

// ---- frame counting (TestFrameProbe lives in the Canvas) ----
let frameCount = 0;
const frameWaiters: { at: number; resolve: () => void }[] = [];

/** Mount inside the Canvas in test mode: counts rendered frames. */
export const TestFrameProbe: React.FC = () => {
  useFrame(() => {
    frameCount++;
    for (let i = frameWaiters.length - 1; i >= 0; i--) {
      if (frameCount >= frameWaiters[i].at) {
        frameWaiters[i].resolve();
        frameWaiters.splice(i, 1);
      }
    }
  });
  return null;
};

// ---- helpers over existing debug handles ----
interface VcDebug {
  teleport: (x: number, y: number, z: number) => void;
  look: (yaw: number, pitch: number) => void;
  player: () => { t: { x: number; y: number; z: number }; v: { x: number; y: number; z: number } } | null;
  rayDown: (x: number, y: number, z: number, max?: number) => number | null;
  aim: (max?: number) => unknown;
}
const dbg = (): VcDebug | undefined => (window as unknown as { __vcDebug?: VcDebug }).__vcDebug;
const three = () => (window as unknown as { __three?: { camera: THREE.Camera; gl: THREE.WebGLRenderer } }).__three;

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, Math.max(0, ms)));
const waitFor = async (test: () => boolean, timeoutMs: number, every = 100): Promise<boolean> => {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    if (test()) return true;
    await wait(every);
  }
  return test();
};

const KEY_FOR: Record<string, string> = { Space: ' ', ShiftLeft: 'Shift', ShiftRight: 'Shift', Escape: 'Escape', Tab: 'Tab', Enter: 'Enter',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
const keyOf = (code: string): string =>
  KEY_FOR[code] ?? (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code);

const DEFAULT_COUNTS: Record<string, number> = { torch: 3, stick: 8, stone: 6, shard: 6, flora: 3, copper: 4, hinge: 2 };
const STACKS: Record<string, ItemType> = { torch: ItemType.TORCH, stick: ItemType.STICK, stone: ItemType.STONE, shard: ItemType.SHARD, flora: ItemType.FLORA };
const TOOLS: Record<string, CustomTool['attachments']> = {
  saw: { edge_1: ItemType.SHARD, edge_2: ItemType.SHARD, edge_3: ItemType.SHARD },
  pick: { side_left: ItemType.SHARD, side_right: ItemType.SHARD },
  flintaxe: { tip_center: ItemType.SHARD, side_left: ItemType.SHARD },
  maul: { tip_center: ItemType.STONE },
  spear: { tip_center: ItemType.SHARD },
};
let toolSerial = 0;

const giveOne = (token: string): boolean => {
  const [name, countRaw] = token.toLowerCase().split(':');
  const n = countRaw ? Math.max(1, Math.floor(Number(countRaw)) || 1) : DEFAULT_COUNTS[name] ?? 1;
  const inv = useInventoryStore.getState();
  if (name === 'pickaxe') { inv.setHasPickaxe(true); return true; }
  if (name === 'axe') { inv.setHasAxe(true); return true; }
  if (STACKS[name]) { inv.addItem(STACKS[name], n); return true; }
  if (TOOLS[name]) {
    inv.addCustomTool({ id: `tool_test_${name}_${Date.now()}_${toolSerial++}`, baseType: ItemType.STICK, attachments: { ...TOOLS[name] } });
    return true;
  }
  if (name === 'copper') { useMaterialsStore.getState().add('copper', n); return true; }
  if (name === 'hinge' || name === 'hinges') { useMaterialsStore.getState().add('hinges', n); return true; }
  if (name === 'all') {
    ['pickaxe', 'axe', 'torch', 'stick', 'stone', 'shard', 'flora', 'saw', 'flintaxe', 'copper', 'hinge'].forEach(giveOne);
    return true;
  }
  return false;
};

const HUD_STYLE_ID = 'vc-test-hud-hidden';
const applyHud = (mode: HudMode) => {
  document.getElementById(HUD_STYLE_ID)?.remove();
  useHudPresence.getState().hold('test', mode === 'awake');
  if (mode === 'hidden') {
    const style = document.createElement('style');
    style.id = HUD_STYLE_ID;
    style.textContent = '#vc-hud { display: none !important; }';
    document.head.appendChild(style);
  }
};

interface HarnessProps {
  test: ResolvedTest;
  spawn: SpawnSpot | null;
  gameStarted: boolean;
  terrainLoaded: boolean;
  setSunTimeOffset: (v: number) => void;
  setSunOrbitSpeed: (v: number) => void;
  liveOrbitSpeed: number;
}

/**
 * Headless (renders nothing, lives outside the Canvas). Publishes
 * window.__vcTest at mount and runs the ready sequence once the world has
 * loaded: player settled on the ground, shaders warmed, then weather, items,
 * HUD, first view and the scenario's setup.
 */
export const TestHarness: React.FC<HarnessProps> = ({ test, spawn, gameStarted, terrainLoaded, setSunTimeOffset, setSunOrbitSpeed, liveOrbitSpeed }) => {
  useEffect(() => {
    let hour: number | 'live' = test.hour;
    let readyReport: ReadyReport | null = null;
    const readyWaiters: ((r: ReadyReport) => void)[] = [];

    const cam = () => three()?.camera;
    const api: VcTestApi = {
      config: { scenario: test.name, world: test.world, seed: test.seed, hour: test.hour, weather: test.weather, hud: test.hud },
      isReady: false,
      ready: () => readyReport ? Promise.resolve(readyReport) : new Promise((r) => readyWaiters.push(r)),
      state: () => {
        let base: Record<string, unknown> = {};
        try {
          const text = (window as unknown as { render_game_to_text?: () => string }).render_game_to_text?.();
          if (text) base = JSON.parse(text);
        } catch { /* not published yet */ }
        const logs = Object.values(useLogStore.getState().logs);
        const count = (s: string) => logs.filter((l) => l.state === s).length;
        const w = useWeatherStore.getState();
        const m = useMaterialsStore.getState();
        const inv = useInventoryStore.getState();
        return {
          ...base,
          test: { scenario: test.name, seed: test.seed, world: test.world, hour, ready: api.isReady },
          camera: (() => { const c = api.camera(); return { yawDeg: +c.yawDeg.toFixed(1), pitchDeg: +c.pitchDeg.toFixed(1) }; })(),
          selected: inv.inventorySlots[inv.selectedSlotIndex] ?? null,
          tools: inv.customToolIds.length,
          materials: { copper: m.copper, hinges: m.hinges },
          weather: { phase: w.phase, overcast: +w.overcast.toFixed(2), rain: +w.rain.toFixed(2), sheltered: w.sheltered },
          logs: { loose: count('loose'), placed: count('placed'), carried: useLogStore.getState().carriedId ? 1 : 0 },
          chunks: chunkDataManager.getStats(),
          frames: frameCount,
          errors: testErrors.length,
        };
      },
      errors: () => [...testErrors],
      clearErrors: () => { testErrors.length = 0; },
      player: () => {
        const p = dbg()?.player();
        return p ? { x: p.t.x, y: p.t.y, z: p.t.z } : { x: NaN, y: NaN, z: NaN };
      },
      camera: () => {
        const c = cam();
        const e = c ? new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ') : new THREE.Euler();
        return { yaw: e.y, pitch: e.x, yawDeg: THREE.MathUtils.radToDeg(e.y), pitchDeg: THREE.MathUtils.radToDeg(e.x) };
      },
      teleport: (x, y, z) => dbg()?.teleport(x, y, z),
      goto: async (x, z) => {
        const loaded = await waitFor(() => {
          const top = TerrainService.getHeightAt(x, z);
          dbg()?.teleport(x, top + 2, z);
          return dbg()?.rayDown(x, top + 6, z, 20) != null;
        }, 30000, 150);
        return loaded && api.settle();
      },
      settle: async (timeoutMs = 20000) => {
        let still = 0;
        return waitFor(() => {
          const p = dbg()?.player();
          if (!p) return false;
          const ground = dbg()?.rayDown(p.t.x, p.t.y, p.t.z, 4);
          const speed = Math.hypot(p.v.x, p.v.y, p.v.z);
          still = ground != null && speed < 0.3 ? still + 1 : 0;
          return still >= 4;
        }, timeoutMs, 100);
      },
      look: (yawDeg, pitchDeg = -5) => dbg()?.look(THREE.MathUtils.degToRad(yawDeg), THREE.MathUtils.degToRad(pitchDeg)),
      lookAt: (x, y, z) => {
        const c = cam();
        if (!c) return;
        const o = c.getWorldPosition(new THREE.Vector3());
        const dx = x - o.x, dy = y - o.y, dz = z - o.z;
        dbg()?.look(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)));
      },
      groundAt: (x, z) => {
        const top = TerrainService.getHeightAt(x, z);
        return dbg()?.rayDown(x, top + 8, z, 40) ?? top;
      },
      aim: (max) => dbg()?.aim(max) ?? null,
      setTime: (h) => {
        hour = h;
        if (h === 'live') { setSunOrbitSpeed(liveOrbitSpeed); return; }
        setSunOrbitSpeed(0);
        setSunTimeOffset(orbitOffsetForHour(h));
      },
      setWeather: (phase, instant = true) => {
        const w = (window as unknown as { __weather?: { set: (p: WeatherPhase, o: { hold?: boolean; instant?: boolean }) => void } }).__weather;
        if (w) w.set(phase, { hold: true, instant });
        else testErrors.push('[vcTest] setWeather: weather not running yet');
      },
      give: (...items) => items.filter((t) => !giveOne(t)),
      select: (slot) => useInventoryStore.getState().setSelectedSlotIndex(slot - 1),
      hud: applyHud,
      key: async (code, ms = 80) => {
        const init = { code, key: keyOf(code), bubbles: true, cancelable: true };
        window.dispatchEvent(new KeyboardEvent('keydown', init));
        await wait(ms);
        window.dispatchEvent(new KeyboardEvent('keyup', init));
      },
      click: async (button = 'left', ms = 60) => {
        const target = three()?.gl.domElement ?? document.body;
        const b = button === 'right' ? 2 : 0;
        const r = target.getBoundingClientRect();
        const init = { button: b, buttons: b === 2 ? 2 : 1, bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        target.dispatchEvent(new MouseEvent('mousedown', init));
        await wait(ms);
        target.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
      },
      wait,
      frames: (n = 1) => new Promise((resolve) => frameWaiters.push({ at: frameCount + n, resolve })),
      fps: async (seconds = 3) => {
        const f0 = frameCount, t0 = performance.now();
        await wait(seconds * 1000);
        return +(((frameCount - f0) * 1000) / (performance.now() - t0)).toFixed(1);
      },
      scenarios: () => Object.entries(SCENARIOS).map(([name, s]) => ({ name, description: s.description })),
    };

    (window as unknown as { __vcTest?: VcTestApi; __vcTestFinish?: (r: ReadyReport) => void }).__vcTest = api;
    // The ready sequence (below) reports through this.
    (window as unknown as { __vcTestFinish?: (r: ReadyReport) => void }).__vcTestFinish = (r) => {
      readyReport = r;
      api.isReady = r.ok;
      readyWaiters.splice(0).forEach((w) => w(r));
    };
    return () => {
      delete (window as unknown as { __vcTest?: VcTestApi }).__vcTest;
      delete (window as unknown as { __vcTestFinish?: unknown }).__vcTestFinish;
    };
  }, [test, setSunTimeOffset, setSunOrbitSpeed, liveOrbitSpeed]);

  // The ready sequence, once per page load.
  useEffect(() => {
    if (!gameStarted || !terrainLoaded) return;
    let cancelled = false;
    const api = (window as unknown as { __vcTest?: VcTestApi }).__vcTest!;
    const finish = (window as unknown as { __vcTestFinish?: (r: ReadyReport) => void }).__vcTestFinish!;
    const report = (ok: boolean, failed?: string): ReadyReport => ({
      ok, failed, ms: Math.round(performance.now()), scenario: test.name, world: test.world, seed: test.seed,
      player: dbg() ? api.player() : null, errors: [...testErrors],
    });
    (async () => {
      if (!(await waitFor(() => !!dbg()?.player(), 60000))) return finish(report(false, 'player never spawned'));
      if (!(await waitFor(() => testFlags.warmupDone, 60000))) return finish(report(false, 'shader warm-up never finished'));
      if (!(await api.settle(30000))) return finish(report(false, 'player never settled on the ground'));
      if (cancelled) return;
      api.setWeather(test.weather, true);
      const unknown = api.give(...test.give);
      if (unknown.length) testErrors.push(`[vcTest] unknown items: ${unknown.join(', ')}`);
      applyHud(test.hud);
      const view = initialView(test, spawn);
      const here = api.player();
      dbg()?.look(view.yaw ?? openViewYaw(here.x, here.z), view.pitch);
      try {
        await test.scenario.setup?.(api);
      } catch (e) {
        return finish(report(false, `scenario setup failed: ${e instanceof Error ? e.message : String(e)}`));
      }
      // Arrival notices ("New land discovered", the first quest) would cover
      // every screenshot: let them fire, then clear them.
      await wait(1200);
      useGroveStore.setState({ toasts: [] });
      await api.frames(10);
      if (!cancelled) finish(report(true));
    })();
    return () => { cancelled = true; };
  }, [gameStarted, terrainLoaded, test, spawn]);

  return null;
};
