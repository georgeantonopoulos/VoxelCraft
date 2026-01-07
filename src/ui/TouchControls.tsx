import React, { useRef, useState } from 'react';
import { useInputStore } from '@/state/InputStore';
import { useSettingsStore } from '@/state/SettingsStore';

export const TouchControls: React.FC = () => {
  const inputMode = useSettingsStore(s => s.inputMode);
  const { setMoveVector, setLookDelta, setJumping, setDigging } = useInputStore();

  // Joystick State
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 }); // Visual offset
  const joystickOrigin = useRef<{ x: number, y: number } | null>(null);
  const joystickId = useRef<number | null>(null);

  // Look State
  const lookId = useRef<number | null>(null);
  const lastLookPos = useRef<{ x: number, y: number } | null>(null);

  // Constants
  const JOYSTICK_RADIUS = 50;

  if (inputMode !== 'touch') return null;

  const handlePointerDown = (e: React.PointerEvent) => {
    // Left half = Move, Right half = Look
    const isLeft = e.clientX < window.innerWidth / 2;

    // Prevent default touch actions (scrolling etc)
    e.preventDefault();

    if (isLeft && joystickId.current === null) {
      joystickId.current = e.pointerId;
      joystickOrigin.current = { x: e.clientX, y: e.clientY };
      setJoystickPos({ x: 0, y: 0 });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } else if (!isLeft && lookId.current === null) {
      lookId.current = e.pointerId;
      lastLookPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    e.preventDefault();

    if (e.pointerId === joystickId.current && joystickOrigin.current) {
      const dx = e.clientX - joystickOrigin.current.x;
      const dy = e.clientY - joystickOrigin.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cappedDist = Math.min(dist, JOYSTICK_RADIUS);
      const angle = Math.atan2(dy, dx);

      const visualX = Math.cos(angle) * cappedDist;
      const visualY = Math.sin(angle) * cappedDist;
      setJoystickPos({ x: visualX, y: visualY });

      // Normalized Output (-1 to 1)
      setMoveVector(visualX / JOYSTICK_RADIUS, visualY / JOYSTICK_RADIUS);
    }

    if (e.pointerId === lookId.current && lastLookPos.current) {
      const dx = e.clientX - lastLookPos.current.x;
      const dy = e.clientY - lastLookPos.current.y;

      const current = useInputStore.getState().lookDelta;
      setLookDelta(current.x + dx, current.y + dy);

      lastLookPos.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    e.preventDefault();
    if (e.pointerId === joystickId.current) {
      joystickId.current = null;
      joystickOrigin.current = null;
      setJoystickPos({ x: 0, y: 0 });
      setMoveVector(0, 0);
    }
    if (e.pointerId === lookId.current) {
      lookId.current = null;
      lastLookPos.current = null;
    }
  };

  return (
    <div className="absolute inset-0 z-40 select-none touch-none pointer-events-none">
      {/* Touch Areas Container */}
      <div
        className="absolute inset-0 pointer-events-auto flex"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Left Half: Move */}
        <div className="w-1/2 h-full relative">
          {/* Visual Joystick Indicator (only visible when active) */}
          {joystickOrigin.current && (
            <div
              className="absolute w-24 h-24 rounded-full border-2 border-white/30 bg-black/20 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: joystickOrigin.current.x, top: joystickOrigin.current.y }}
            >
              <div
                className="absolute w-10 h-10 rounded-full bg-white/50 -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
                style={{ transform: `translate(calc(-50% + ${joystickPos.x}px), calc(-50% + ${joystickPos.y}px))` }}
              />
            </div>
          )}

          {/* Hint text if idle */}
          {!joystickOrigin.current && (
            <div className="absolute bottom-20 left-10 text-white/30 text-sm font-bold uppercase tracking-widest pointer-events-none">
              Move
            </div>
          )}
        </div>

        {/* Right Half: Look */}
        <div className="w-1/2 h-full relative">
          {!lookId.current && (
            <div className="absolute bottom-20 right-10 text-white/30 text-sm font-bold uppercase tracking-widest pointer-events-none">
              Look
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons Overlay */}
      <div className="absolute bottom-8 right-8 flex flex-col gap-4 pointer-events-auto">
        <div className="flex gap-4">
          {/* DIG (Left Click) */}
          <button
            className="w-16 h-16 rounded-full bg-red-500/50 border-2 border-red-400 text-white font-bold backdrop-blur-sm active:bg-red-500/80 active:scale-95 transition-all flex items-center justify-center"
            onPointerDown={() => setDigging(true)}
            onPointerUp={() => setDigging(false)}
            onPointerLeave={() => setDigging(false)}
          >
            DIG
          </button>
        </div>

        {/* JUMP */}
        <button
          className="w-20 h-20 self-end rounded-full bg-slate-200/50 border-2 border-white text-white font-bold backdrop-blur-sm active:bg-slate-200/80 active:scale-95 transition-all flex items-center justify-center"
          onPointerDown={() => setJumping(true)}
          onPointerUp={() => setJumping(false)}
          onPointerLeave={() => setJumping(false)}
        >
          JUMP
        </button>
      </div>
    </div>
  );
};
