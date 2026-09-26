import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '@/state/SettingsStore';
import { useCraftingStore } from '@/state/CraftingStore';
import { VineRule } from '@ui/grove/GroveOrnaments';

/**
 * Shown whenever the mouse is free in mouse mode (before the first click and
 * after Esc). Clicking anywhere on it re-captures the mouse: drei's
 * PointerLockControls listens for clicks on the document. Buttons stop the
 * click from reaching it.
 */
export const PauseVeil: React.FC = () => {
  const [locked, setLocked] = useState(() => !!document.pointerLockElement);
  const [everLocked, setEverLocked] = useState(false);
  const settingsOpen = useSettingsStore((s) => s.isSettingsOpen);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const craftingOpen = useCraftingStore((s) => s.isOpen);

  useEffect(() => {
    const onChange = () => {
      const now = !!document.pointerLockElement;
      setLocked(now);
      if (now) setEverLocked(true);
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, []);

  if (locked || settingsOpen || craftingOpen) return null;

  return (
    <div className="grove-fade-in pointer-events-auto absolute inset-0 z-40 flex cursor-pointer flex-col items-center justify-center"
      style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(7,11,10,0.35), rgba(7,11,10,0.72))', animationDuration: '300ms' }}
    >
      <div className="grove-text-shadow flex flex-col items-center text-center">
        <div className="grove-eyebrow">{everLocked ? 'The Grove waits' : 'You wake in the Grove'}</div>
        <h1 className="mt-1 font-display text-[54px] font-semibold leading-none text-parchment">
          {everLocked ? 'Paused' : 'Click to begin'}
        </h1>
        <VineRule className="my-4" width={220} />
        <p className="text-[14px] text-lichen/75">
          {everLocked ? 'Click anywhere to return' : 'Click anywhere to look around'} · <span className="grove-key">Esc</span> frees the mouse
        </p>
        <div className="mt-7 flex gap-3">
          <button
            className="grove-button-quiet px-6 py-2 text-[13px]"
            onClick={(e) => { e.stopPropagation(); toggleSettings(); }}
          >
            Settings
          </button>
        </div>
      </div>
    </div>
  );
};
