import React, { useEffect } from 'react';
import { useInventoryStore } from '@state/InventoryStore';
import { useCarryingStore } from '@state/CarryingStore';

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

      // LOCK inventory cycling when carrying a log - wheel is used for rotation toggle
      if (useCarryingStore.getState().isCarrying()) return;

      // Prevent the page from scrolling while in pointer lock on some browsers.
      e.preventDefault();
      const direction = e.deltaY > 0 ? 1 : -1;
      cycleSlot(direction);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!document.pointerLockElement) return;
      if (isTextInputTarget(e.target)) return;

      // Handle both top-row digits and numpad digits.
      // e.code is more reliable for physical key locations.
      let slotIndex = -1;

      if (e.code.startsWith('Digit')) {
        const val = parseInt(e.code.replace('Digit', ''), 10);
        if (!isNaN(val) && val >= 1 && val <= 9) {
          slotIndex = val - 1;
        }
      } else if (e.code.startsWith('Numpad') && e.code.length === 7) {
        // e.code for Numpad digits is "Numpad1", "Numpad2", etc.
        const val = parseInt(e.code.replace('Numpad', ''), 10);
        if (!isNaN(val) && val >= 1 && val <= 9) {
          slotIndex = val - 1;
        }
      }

      // Fallback to e.key for non-standard keyboards if slotIndex wasn't set.
      if (slotIndex === -1) {
        const n = Number(e.key);
        if (Number.isInteger(n) && n >= 1 && n <= 9) {
          slotIndex = n - 1;
        }
      }

      if (slotIndex >= 0 && slotIndex < slotCount) {
        e.preventDefault();
        setSelectedSlotIndex(slotIndex);
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
