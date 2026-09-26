import React, { useEffect, useState } from 'react';

/**
 * A soft Lumina-teal wash over the view while the Keeper follows the light
 * out of a cave (the dash moves through rock; the veil hides the passage).
 */
export const LuminaVeil: React.FC = () => {
  const [phase, setPhase] = useState<'off' | 'in' | 'out'>('off');
  useEffect(() => {
    const timers: number[] = [];
    const onStart = () => {
      timers.forEach(clearTimeout);
      setPhase('in');
      timers.push(window.setTimeout(() => setPhase('out'), 450));
      timers.push(window.setTimeout(() => setPhase('off'), 1400));
    };
    window.addEventListener('lumina-glow-start', onStart);
    return () => { window.removeEventListener('lumina-glow-start', onStart); timers.forEach(clearTimeout); };
  }, []);
  if (phase === 'off') return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[45]"
      style={{
        background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(164,242,228,0.92), rgba(98,230,216,0.75) 55%, rgba(7,11,10,0.85))',
        opacity: phase === 'in' ? 1 : 0,
        transition: phase === 'in' ? 'opacity 380ms ease-in' : 'opacity 900ms ease-out',
      }}
    />
  );
};
