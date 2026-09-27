/**
 * "Is the game capturing the mouse right now?" Gameplay input (clicks, Q,
 * hotbar keys, wheel) only counts while it is, and the pause veil shows while
 * it is not.
 *
 * Normally that is real pointer lock. Automated browsers usually cannot take
 * pointer lock, so test mode (`?test`) switches on a virtual capture: the game
 * then behaves as if the mouse were locked (no veil, full frame rate, inputs
 * accepted) and the camera is turned through `__vcTest.look()` instead.
 */
let virtualCapture = false;

export const isPointerCaptured = (): boolean => virtualCapture || !!document.pointerLockElement;

/** Test mode only. Fires `pointerlockchange` so listeners re-read the state. */
export const setVirtualPointerCapture = (on: boolean): void => {
  if (virtualCapture === on) return;
  virtualCapture = on;
  document.dispatchEvent(new Event('pointerlockchange'));
};
