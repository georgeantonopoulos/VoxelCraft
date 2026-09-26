/**
 * Turns raw wheel events into hotbar steps: one step per notch's worth of
 * scroll, with a short pause between steps. Trackpads and smooth-scroll mice
 * send dozens of small wheel events per flick; stepping on each raced the
 * selection across the hotbar. Pure (time passed in) so it can be tested.
 */
export interface WheelStepper {
  /** Returns +1 / -1 when this event completes a step, else 0. */
  push(deltaY: number, deltaMode: number, nowMs: number, gapMs: number): -1 | 0 | 1;
}

export const NOTCH_PX = 100;

export function createWheelStepper(): WheelStepper {
  let accum = 0;
  let lastStep = -Infinity;
  let lastEvent = -Infinity;
  return {
    push(deltaY, deltaMode, now, gapMs) {
      if (now - lastEvent > 250) accum = 0; // a new gesture
      lastEvent = now;
      accum += deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 400 : deltaY;
      if (Math.abs(accum) < NOTCH_PX) return 0;
      const dir = accum > 0 ? 1 : -1;
      accum = 0;
      if (now - lastStep < gapMs) return 0;
      lastStep = now;
      return dir;
    },
  };
}
