import React, { useEffect } from 'react';
import { useInventoryStore } from '@state/InventoryStore';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || target.isContentEditable;
}

export const InventoryInput: React.FC<{ enabled: boolean }> = ({ enabled }) => {
  const cycleSlot = useInventoryStore((s) => s.cycleSlot);
  const setSelectedSlotIndex = useInventoryStore((s) => s.setSelectedSlotIndex);

  useEffect(() => {
    if (!enabled) return;

    const handleWheel = (e: WheelEvent) => {
      // Inventory scrolling is a gameplay input; only respond when pointer is locked.
      if (!document.pointerLockElement) return;
      // Prevent the page from scrolling while in pointer lock on some browsers.
      e.preventDefault();
      const direction = e.deltaY > 0 ? 1 : -1;
      cycleSlot(direction);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!document.pointerLockElement) return;
      if (isTextInputTarget(e.target)) return;

      // 1..5 selects the corresponding slot.
      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        setSelectedSlotIndex(Number(e.key) - 1);
      }
    };

    // We need `passive: false` so `preventDefault()` is allowed on wheel.
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel as EventListener);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, cycleSlot, setSelectedSlotIndex]);

  return null;
};

