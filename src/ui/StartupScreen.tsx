import React, { useEffect, useState } from 'react';
import logo from '@assets/images/thegrove_logo.jpg';
import { FireflyField, GroveLogo, VineRule } from '@ui/grove/GroveOrnaments';

interface StartupScreenProps {
  onEnter: () => void;
  loaded: boolean;
}

const TIPS: React.ReactNode[] = [
  <>Look at fallen sticks, stones and flora and press <span className="grove-key">Q</span> to gather them.</>,
  <>Lumina flora glow in the dark. Carry some with you into caves.</>,
  <>With a stick selected, press <span className="grove-key">C</span> to shape a tool.</>,
  <>Your Lumina Sense, at the top of the screen, points to the nearest sleeping Root Hollow.</>,
  <>Double-tap <span className="grove-key">Space</span> to fly. <span className="grove-key">Shift</span> takes you down again.</>,
  <>Nights are short but dark. A torch keeps the shadows back.</>,
];

const FADE_MS = 550;

/**
 * Shown while the first chunks grow. The cinematic flyover renders behind
 * it, so the veil keeps the centre of the frame open.
 */
export const StartupScreen: React.FC<StartupScreenProps> = ({ onEnter, loaded }) => {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * TIPS.length));
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % TIPS.length), 5200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(onEnter, FADE_MS);
    return () => window.clearTimeout(id);
  }, [leaving, onEnter]);

  useEffect(() => {
    if (!loaded || leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') setLeaving(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loaded, leaving]);

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center text-parchment select-none transition-opacity ease-out"
      style={{ opacity: leaving ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
    >
      {/* Veil: dark at the edges, open in the middle so the flyover shows. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(7,11,10,0.97) 0%, rgba(7,11,10,0.9) 24%, rgba(7,11,10,0.5) 40%, rgba(7,11,10,0.2) 56%, rgba(7,11,10,0.7) 80%, rgba(7,11,10,0.95) 100%),' +
            'radial-gradient(ellipse 80% 70% at 50% 50%, rgba(7,11,10,0) 40%, rgba(7,11,10,0.6) 100%)',
          backdropFilter: loaded ? 'none' : 'blur(3px)',
          transition: 'backdrop-filter 1200ms ease',
        }}
      />
      <FireflyField count={40} />

      <div className="relative mt-[4vh] w-[min(620px,86vw)]">
        <GroveLogo src={logo} />
      </div>

      <div className="relative mt-auto mb-[9vh] flex flex-col items-center px-6">
        <div className="flex h-[74px] flex-col items-center justify-center">
          {!loaded ? (
            <div className="flex flex-col items-center gap-3">
              <div className="lumina-marker h-3 w-3" />
              <span className="font-display text-[20px] italic text-lichen/80 grove-breathe">The world is growing…</span>
            </div>
          ) : (
            <button className="grove-button grove-rise px-12 py-3.5 text-[21px]" onClick={() => setLeaving(true)}>
              Enter the Grove
            </button>
          )}
        </div>

        <VineRule className="mt-6 mb-3 opacity-80" width={200} />

        <p key={tip} className="grove-rise grove-text-shadow max-w-[520px] text-center text-[14px] leading-relaxed text-lichen/80">
          {TIPS[tip]}
        </p>
        <p className="mt-3 text-center text-[12px] tracking-wide text-lichen/45">
          Click the world to look around · <span className="grove-key">Esc</span> to pause · <span className="grove-key">H</span> for controls
        </p>
      </div>
    </div>
  );
};
