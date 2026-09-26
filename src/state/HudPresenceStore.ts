import type React from 'react';
import { create } from 'zustand';

/**
 * Quiet HUD: during play the screen holds only the crosshair and a faint
 * compass. Everything else wakes when something happens (quest progress,
 * pickups, switching items, holding Tab, pausing) and fades after a calm spell.
 */
const DEFAULT_WAKE_MS = 6000;

interface HudPresenceState {
  awake: boolean;
  /** Reasons that keep the HUD awake regardless of time (Tab held, paused). */
  holds: Record<string, true>;
  wake: (ms?: number) => void;
  hold: (reason: string, on: boolean) => void;
}

let sleepHandle: ReturnType<typeof setTimeout> | null = null;
let sleepAt = 0;

export const useHudPresence = create<HudPresenceState>((set, get) => ({
  awake: true,
  holds: {},
  wake: (ms = DEFAULT_WAKE_MS) => {
    const until = performance.now() + ms;
    if (until > sleepAt) {
      sleepAt = until;
      if (sleepHandle) clearTimeout(sleepHandle);
      sleepHandle = setTimeout(() => {
        sleepHandle = null;
        if (Object.keys(get().holds).length === 0) set({ awake: false });
      }, ms);
    }
    if (!get().awake) set({ awake: true });
  },
  hold: (reason, on) => {
    const holds = { ...get().holds };
    if (on) holds[reason] = true; else delete holds[reason];
    set({ holds, awake: on || Object.keys(holds).length > 0 || get().awake });
    // Releasing the last hold starts the normal fade.
    if (!on && Object.keys(holds).length === 0) get().wake(2500);
  },
}));

/** Opacity helper: full when awake, `rest` when asleep. */
export const presenceStyle = (awake: boolean, rest = 0): React.CSSProperties => ({
  opacity: awake ? 1 : rest,
  pointerEvents: awake || rest > 0 ? undefined : 'none',
  transition: `opacity ${awake ? 350 : 1600}ms ease`,
});
