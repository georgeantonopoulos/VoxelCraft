/**
 * Shared mutable player state for high-frequency reads.
 *
 * Updated every frame by Player.tsx.
 * Read directly (no subscription) by AmbientLife, FogDeer, etc.
 *
 * This pattern avoids Zustand subscription overhead for 60fps data.
 * Similar to SharedUniforms.ts for material data.
 *
 * For multiplayer: This represents the LOCAL player only.
 * Remote players would use a separate Map<playerId, PlayerPosition>.
 */

export interface PlayerPosition {
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Increments each update - useful for change detection without deep comparison */
  version: number;
}

/**
 * Mutable singleton - updated every frame by Player.tsx.
 * Read directly by any system that needs player position.
 */
export const playerState: PlayerPosition = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  version: 0,
};

/**
 * Called every frame by Player.tsx.
 * Mutates the singleton in-place (no allocations).
 */
export const updatePlayerState = (x: number, y: number, z: number, rotation: number): void => {
  playerState.x = x;
  playerState.y = y;
  playerState.z = z;
  playerState.rotation = rotation;
  playerState.version++;
};

// --- Throttled Listener System for UI Components ---

type PlayerUpdateCallback = (state: PlayerPosition) => void;
const listeners = new Set<PlayerUpdateCallback>();
let lastNotifyTime = 0;
let lastNotifyVersion = 0;
const NOTIFY_THROTTLE_MS = 100; // 10Hz

/**
 * Subscribe to throttled player position updates.
 * Useful for UI components that don't need 60fps updates.
 *
 * @param callback Called at ~10Hz when position changes
 * @returns Unsubscribe function
 */
export const subscribeThrottled = (callback: PlayerUpdateCallback): (() => void) => {
  listeners.add(callback);
  return () => listeners.delete(callback);
};

/**
 * Called every frame after updatePlayerState.
 * Notifies listeners at throttled rate (10Hz).
 */
export const notifyListeners = (): void => {
  const now = performance.now();
  if (now - lastNotifyTime < NOTIFY_THROTTLE_MS) return;
  if (playerState.version === lastNotifyVersion) return;

  lastNotifyTime = now;
  lastNotifyVersion = playerState.version;
  listeners.forEach(cb => cb(playerState));
};

// --- DevTools Integration ---

if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__playerState = playerState;
}
