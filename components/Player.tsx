import * as THREE from 'three';
import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '../constants';

const FLY_SPEED = 8; // Vertical speed when flying
const DOUBLE_TAP_TIME = 300; // Milliseconds between taps to count as double-tap

export const Player = ({ position = [16, 32, 16], onPlaceFlora }: { position?: [number, number, number], onPlaceFlora: (p: THREE.Vector3) => void }) => {
  const body = useRef<any>(null);
  const [, getKeys] = useKeyboardControls();
  const { rapier, world } = useRapier();
  const [isFlying, setIsFlying] = useState(false);
  const lastSpacePress = useRef<number>(0);
  const wasJumpPressed = useRef<boolean>(false);
  const spacePressHandled = useRef<boolean>(false);

  // Update gravity scale when flying mode changes
  useEffect(() => {
    if (!body.current) return;
    body.current.setGravityScale(isFlying ? 0 : 1, true);
  }, [isFlying]);

  useFrame((state) => {
    if (!body.current) return;

    // Dispatch position update for UI
    const pos = body.current.translation();
    window.dispatchEvent(new CustomEvent('player-moved', {
        detail: { x: pos.x, y: pos.y, z: pos.z }
    }));

    const { forward, backward, left, right, jump, shift } = getKeys();

    // Flora Placement
    if (getKeys().place) {
        const pos = body.current.translation();
        onPlaceFlora(new THREE.Vector3(pos.x, pos.y, pos.z));
    }
    
    const velocity = body.current.linvel();
    const camera = state.camera;
    
    // Calculate movement direction relative to camera
    const frontVector = new THREE.Vector3(0, 0, (backward ? 1 : 0) - (forward ? 1 : 0));
    const sideVector = new THREE.Vector3((left ? 1 : 0) - (right ? 1 : 0), 0, 0);
    const direction = new THREE.Vector3();
    
    direction.subVectors(frontVector, sideVector).normalize().multiplyScalar(PLAYER_SPEED);
    direction.applyEuler(camera.rotation);
    
    let yVelocity = velocity.y;

    // Detect double-tap Space to toggle flying mode
    const isDoubleTap = jump && !wasJumpPressed.current;
    if (isDoubleTap) {
      const now = Date.now();
      const timeSinceLastPress = now - lastSpacePress.current;
      
      if (timeSinceLastPress < DOUBLE_TAP_TIME && timeSinceLastPress > 0) {
        // Double-tap detected - toggle flying mode
        setIsFlying(prev => !prev);
        lastSpacePress.current = 0; // Reset to prevent triple-tap issues
        spacePressHandled.current = true; // Mark as handled to prevent jump/fly on this tap
      } else {
        lastSpacePress.current = now;
      }
    }

    if (isFlying) {
      // Flying mode: Space to go up, Shift to go down, hover otherwise
      if (jump && !spacePressHandled.current) {
        yVelocity = FLY_SPEED; // Fly up
      } else if (shift) {
        yVelocity = -FLY_SPEED; // Fly down
      } else {
        yVelocity = 0; // Hover (maintain current Y)
      }
    } else {
      // Normal mode: Jump when grounded (only if not handling double-tap)
      if (jump && !wasJumpPressed.current && !spacePressHandled.current) {
        // Simple raycast down to check if grounded
        const ray = new rapier.Ray(body.current.translation(), { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, 1.5, true);
        
        // Check Time of Impact (toi / timeOfImpact)
        if (hit && hit.timeOfImpact < 1.2) {
          yVelocity = JUMP_FORCE;
        }
      }
    }

    // Reset spacePressHandled when jump is released
    if (!jump && wasJumpPressed.current) {
      spacePressHandled.current = false;
    }

    // Track jump key state for single-press detection
    wasJumpPressed.current = jump;
    
    body.current.setLinvel({ x: direction.x, y: yVelocity, z: direction.z }, true);

    // Sync camera to body
    const translation = body.current.translation();
    camera.position.set(translation.x, translation.y + 0.8, translation.z);
  });

  return (
    <RigidBody 
      ref={body} 
      colliders={false} 
      mass={1} 
      type="dynamic" 
      position={position}
      enabledRotations={[false, false, false]}
      friction={0}
    >
      <CapsuleCollider args={[0.5, 0.5]} />
    </RigidBody>
  );
};