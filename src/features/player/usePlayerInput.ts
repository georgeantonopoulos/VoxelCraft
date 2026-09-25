import { useKeyboardControls } from '@react-three/drei';
import { useInputStore } from '@/state/InputStore';
import { useSettingsStore } from '@/state/SettingsStore';
import { useCraftingStore } from '@/state/CraftingStore';

const NO_INPUT = { move: { x: 0, z: 0 }, jump: false, shift: false, crouch: false } as const;

export const usePlayerInput = () => {
  const inputMode = useSettingsStore(s => s.inputMode);
  const [, getKeys] = useKeyboardControls();

  return () => {
    // Menus own the keyboard: the player must not walk while crafting or in settings.
    if (useCraftingStore.getState().isOpen || useSettingsStore.getState().isSettingsOpen) {
      return { move: { ...NO_INPUT.move }, jump: false, shift: false, crouch: false };
    }
    if (inputMode === 'touch') {
      const { moveVector, isJumping } = useInputStore.getState();
      // Joystick Y is negative when dragging UP (screen coords).
      // We want Forward (Negative Z) when dragging UP.
      // So Z = Y.
      return {
        move: { x: moveVector.x, z: moveVector.y },
        jump: isJumping,
        shift: false,
        crouch: false
      };
    } else {
      const { forward, backward, left, right, jump, shift, crouch } = getKeys();
      const x = (right ? 1 : 0) - (left ? 1 : 0);
      const z = (backward ? 1 : 0) - (forward ? 1 : 0);
      return {
        move: { x, z },
        jump,
        shift,
        crouch
      };
    }
  };
};
