import { useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { useInputStore } from '@/state/InputStore';
import * as THREE from 'three';

export const TouchCameraControls = () => {
  const { camera } = useThree();
  const { setLookDelta } = useInputStore();

  // Sensitivity factor (tunable)
  const SENSITIVITY = 0.005;

  useEffect(() => {
    // Ensure rotation order matches PointerLockControls for consistency
    camera.rotation.order = 'YXZ';
  }, [camera]);

  useFrame(() => {
    // Read accumulated delta directly from store to avoid React render loop lag
    const { x, y } = useInputStore.getState().lookDelta;

    if (x !== 0 || y !== 0) {
      // Apply yaw (Y axis) - horizontal drag
      camera.rotation.y -= x * SENSITIVITY;

      // Apply pitch (X axis) - vertical drag
      const newPitch = camera.rotation.x - y * SENSITIVITY;

      // Clamp pitch to avoid flipping over
      camera.rotation.x = THREE.MathUtils.clamp(newPitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);

      // Reset delta
      setLookDelta(0, 0);
    }
  });

  return null;
};
