import React, { useRef, useState } from 'react';
import { useInputStore } from '@/state/InputStore';
import { useSettingsStore } from '@/state/SettingsStore';
import { useInventoryStore } from '@/state/InventoryStore';
import { useLogStore } from '@/state/LogStore';
import { ItemType } from '@/types';
import { getToolCapabilities } from '@features/interaction/logic/ToolCapabilities';
import { openCraftingForSelected } from '@features/crafting/openCrafting';

/** Forward on-screen button presses to InteractionHandler (mouse equivalents). */
const touchAction = (button: number, pressed: boolean) => {
  window.dispatchEvent(new CustomEvent('vc-touch-action', { detail: { button, pressed } }));
};

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

  // What the buttons do right now depends on what is in hand.
  const carrying = useLogStore((st) => st.carriedId !== null);
  const selected = useInventoryStore((st) => st.inventorySlots[st.selectedSlotIndex]);
  const selectedTool = useInventoryStore((st) => {
    const it = st.inventorySlots[st.selectedSlotIndex];
    return typeof it === 'string' && it.startsWith('tool_') ? st.customTools[it] : undefined;
  });
  const caps = getToolCapabilities(selectedTool ?? (selected as ItemType | null));
  const primaryLabel = caps.canSaw ? 'Saw' : caps.canChop && !caps.canDig ? 'Chop' : caps.canSmash ? 'Strike' : 'Dig';
  const showCraft = !carrying && (selected === ItemType.STICK || !!selectedTool);

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
              className="absolute w-24 h-24 rounded-full border border-lichen/30 bg-night/25 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{ left: joystickOrigin.current.x, top: joystickOrigin.current.y }}
            >
              <div
                className="absolute w-10 h-10 rounded-full bg-parchment/45 -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
                style={{ transform: `translate(calc(-50% + ${joystickPos.x}px), calc(-50% + ${joystickPos.y}px))` }}
              />
            </div>
          )}

          {/* Hint text if idle */}
          {!joystickOrigin.current && (
            <div className="grove-eyebrow absolute bottom-20 left-10 pointer-events-none">
              Move
            </div>
          )}
        </div>

        {/* Right Half: Look */}
        <div className="w-1/2 h-full relative">
          {!lookId.current && (
            <div className="grove-eyebrow absolute bottom-20 right-10 pointer-events-none">
              Look
            </div>
          )}
        </div>
      </div>

      {/* Action buttons: hollows like the hotbar's, named for what they will do now. */}
      <div className="absolute bottom-28 right-8 flex flex-col items-end gap-3 pointer-events-auto">
        {showCraft && (
          <button
            aria-label="Craft"
            className="grove-touch h-12 w-12 text-[13px]"
            onPointerDown={(event) => { event.preventDefault(); openCraftingForSelected(); }}
          >
            Craft
          </button>
        )}
        <div className="flex gap-3">
          {/* Gather (Q): pick up what you look at; with a log in hand, set it down. */}
          <button
            aria-label={carrying ? 'Set down' : 'Gather'}
            className="grove-touch h-16 w-16 text-[14px]"
            onPointerDown={(event) => {
              event.preventDefault();
              window.dispatchEvent(new Event('vc-item-pickup-request'));
            }}
          >
            {carrying ? 'Set down' : 'Gather'}
          </button>

          {/* Use (right click): place / throw / use; with a log in hand, place it. */}
          <button
            aria-label={carrying ? 'Place' : 'Use'}
            className="grove-touch h-16 w-16 text-[14px]"
            onPointerDown={(event) => { event.preventDefault(); touchAction(2, true); }}
            onPointerUp={() => touchAction(2, false)}
            onPointerLeave={() => touchAction(2, false)}
          >
            {carrying ? 'Place' : 'Use'}
          </button>

          {/* Primary (left click): dig / chop / saw / strike; with a log in hand, turn it. */}
          {carrying ? (
            <button
              aria-label="Turn"
              className="grove-touch h-16 w-16 text-[14px]"
              onPointerDown={(event) => { event.preventDefault(); window.dispatchEvent(new CustomEvent('vc-build-rotate')); }}
            >
              Turn
            </button>
          ) : (
            <button
              aria-label={primaryLabel}
              className="grove-touch h-16 w-16 text-[14px]"
              onPointerDown={(event) => { event.preventDefault(); setDigging(true); touchAction(0, true); }}
              onPointerUp={() => { setDigging(false); touchAction(0, false); }}
              onPointerLeave={() => { setDigging(false); touchAction(0, false); }}
            >
              {primaryLabel}
            </button>
          )}
        </div>

        <button
          aria-label="Jump"
          className="grove-touch h-20 w-20 text-[16px]"
          onPointerDown={() => setJumping(true)}
          onPointerUp={() => setJumping(false)}
          onPointerLeave={() => setJumping(false)}
        >
          Jump
        </button>
      </div>
    </div>
  );
};
