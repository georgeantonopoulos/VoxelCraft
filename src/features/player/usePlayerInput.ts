import { useKeyboardControls } from '@react-three/drei';
import { useInputStore } from '@/state/InputStore';
import { useSettingsStore } from '@/state/SettingsStore';

export const usePlayerInput = () => {
  const inputMode = useSettingsStore(s => s.inputMode);
  const [, getKeys] = useKeyboardControls();

  return () => {
    if (inputMode === 'touch') {
      const { moveVector, isJumping } = useInputStore.getState();
      // Joystick Y is negative when dragging UP (screen coords).
      // We want Forward (Negative Z) when dragging UP.
      // So Z = Y.
      return {
        move: { x: moveVector.x, z: moveVector.y },
        jump: isJumping,
        shift: false
      };
    } else {
      const { forward, backward, left, right, jump, shift } = getKeys();
      const x = (right ? 1 : 0) - (left ? 1 : 0);
      const z = (backward ? 1 : 0) - (forward ? 1 : 0);
      return {
        move: { x, z },
        jump,
        shift
      };
    }
  };
};
