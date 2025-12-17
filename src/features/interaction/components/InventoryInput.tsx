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
  const slotCount = useInventoryStore((s) => s.inventorySlots.length);

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

      // 1..9 selects the corresponding slot (as long as it exists).
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= slotCount) {
        e.preventDefault();
        setSelectedSlotIndex(n - 1);
      }
    };

    // We need `passive: false` so `preventDefault()` is allowed on wheel.
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel as EventListener);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, cycleSlot, setSelectedSlotIndex, slotCount]);

  return null;
};
