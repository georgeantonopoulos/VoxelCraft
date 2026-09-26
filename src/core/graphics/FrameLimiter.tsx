import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';

/**
 * Caps rendering at MAX_FPS. The Canvas runs with frameloop="never" and this
 * drives it from requestAnimationFrame, skipping frames that come too soon.
 * On 120 Hz displays (ProMotion MacBooks) the game otherwise rendered 120
 * frames a second: twice the GPU work and heat for no visible gain here.
 */
const MAX_FPS = 60;

export const FrameLimiter: React.FC = () => {
  const advance = useThree((s) => s.advance);
  const clock = useThree((s) => s.clock);
  useEffect(() => {
    const minGap = 1000 / MAX_FPS - 1.5; // tolerance so a 60 Hz display never drops frames
    let last = -Infinity;
    let id = 0;
    // advance() takes SECONDS on the scene clock (frameloop "never": delta =
    // timestamp - clock.elapsedTime). Passing rAF milliseconds ran the whole
    // world 1000x fast. Continue from the clock's current time.
    const startClock = clock.elapsedTime;
    let startT = -1;
    const tick = (t: number) => {
      id = requestAnimationFrame(tick);
      if (t - last < minGap) return;
      last = t;
      if (startT < 0) startT = t;
      advance(startClock + (t - startT) / 1000);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [advance, clock]);
  return null;
};
