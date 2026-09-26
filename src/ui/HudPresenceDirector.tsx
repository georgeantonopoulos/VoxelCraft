import { useEffect } from 'react';
import { useHudPresence } from '@state/HudPresenceStore';
import { useGroveStore } from '@state/GroveStore';
import { useInventoryStore } from '@state/InventoryStore';

/** Wakes the quiet HUD when something worth seeing happens. Renders nothing. */
export const HudPresenceDirector: React.FC<{ mouseMode: boolean }> = ({ mouseMode }) => {
  useEffect(() => {
    const { wake, hold } = useHudPresence.getState();
    wake(14000); // Let a new arrival read the path first.

    const unGrove = useGroveStore.subscribe((s, prev) => {
      if (s.progression !== prev.progression || s.toasts.length > prev.toasts.length) wake(8000);
      const near = s.compass && s.compass.distance < 40;
      const wasNear = prev.compass && prev.compass.distance < 40;
      if (near && !wasNear) wake(8000);
    });
    const unInv = useInventoryStore.subscribe((s, prev) => {
      if (s.selectedSlotIndex !== prev.selectedSlotIndex || s.inventorySlots !== prev.inventorySlots) wake(3500);
    });
    const onPickup = () => wake(4000);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') { e.preventDefault(); if (!e.repeat) hold('tab', true); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Tab') hold('tab', false); };
    const onBlur = () => hold('tab', false);
    const onLock = () => {
      if (mouseMode) hold('paused', !document.pointerLockElement);
    };

    window.addEventListener('vc-item-picked-up', onPickup);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onLock);
    onLock();
    // Touch players tap the hotbar and buttons, so their HUD stays up.
    hold('touch', !mouseMode);
    return () => {
      unGrove();
      unInv();
      window.removeEventListener('vc-item-picked-up', onPickup);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onLock);
      hold('paused', false);
      hold('tab', false);
      hold('touch', false);
    };
  }, [mouseMode]);
  return null;
};
