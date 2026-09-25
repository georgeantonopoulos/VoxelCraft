/**
 * Grove gameplay events.
 *
 * Gameplay systems announce meaningful moments (a hollow restored, a tree
 * felled...) through a single window CustomEvent so the progression layer stays
 * decoupled from terrain/flora/interaction code, mirroring the `vc-audio-*`
 * event pattern used by AudioManager.
 */

export const GROVE_EVENT = 'vc-grove-event';

export type GroveEvent =
  | { type: 'hollow-found'; hollowId: string }
  | { type: 'hollow-awakened'; hollowId: string; x: number; y: number; z: number }
  | { type: 'hollow-restored'; hollowId: string; x: number; y: number; z: number }
  | { type: 'tree-felled' }
  | { type: 'torch-placed' };

export const emitGroveEvent = (event: GroveEvent): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<GroveEvent>(GROVE_EVENT, { detail: event }));
};

export const onGroveEvent = (handler: (event: GroveEvent) => void): (() => void) => {
  const listener = (e: Event) => handler((e as CustomEvent<GroveEvent>).detail);
  window.addEventListener(GROVE_EVENT, listener);
  return () => window.removeEventListener(GROVE_EVENT, listener);
};

/**
 * Stable identifier for a Root Hollow derived from its world XZ position.
 * Hollow positions come from deterministic terrain generation, so the id is
 * stable across chunk reloads and page reloads for the same seed.
 */
export const hollowIdAt = (x: number, z: number): string => `${Math.round(x)},${Math.round(z)}`;
