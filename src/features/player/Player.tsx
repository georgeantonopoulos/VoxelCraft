import * as THREE from 'three';
import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '@/constants';

const FLY_SPEED = 8;
const DOUBLE_TAP_TIME = 300;

export const Player = ({ position = [16, 32, 16] }: { position?: [number, number, number] }) => {
  const body = useRef<any>(null);
  const [, getKeys] = useKeyboardControls();
  const { rapier, world } = useRapier();
  const [isFlying, setIsFlying] = useState(false);
  const lastSpacePress = useRef<number>(0);
  const wasJumpPressed = useRef<boolean>(false);
  const spacePressHandled = useRef<boolean>(false);

  useEffect(() => {
    if (!body.current) return;
    body.current.setGravityScale(isFlying ? 0 : 1, true);
  }, [isFlying]);

  useFrame((state) => {
    if (!body.current) return;

    const pos = body.current.translation();

    // Calculate rotation from forward vector to avoid Euler order issues
    const dir = new THREE.Vector3();
    state.camera.getWorldDirection(dir);
    // We want the angle of the "Backward" vector because Canvas +Y is Down (South-ish)
    // and we want Forward to be Up.
    // atan2(y, x) -> atan2(-dir.x, -dir.z)
    // This gives us the rotation needed to align Forward with Up (-Y in CSS? No, CSS 0 is Right)
    // Let's stick to the logic: 
    // North (0,0,-1) -> atan2(0, 1) = 0. Map North is Up. Correct.
    // East (1,0,0) -> atan2(-1, 0) = -PI/2. Map East (Right) rotates -90 to Top. Correct.
    const rotation = Math.atan2(-dir.x, -dir.z);

    window.dispatchEvent(new CustomEvent('player-moved', {
      detail: {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        rotation: rotation
      }
    }));

    const { forward, backward, left, right, jump, shift } = getKeys();
    // REMOVED: The Flora Placement logic that was conflicting

    const velocity = body.current.linvel();
    const camera = state.camera;

    const frontVector = new THREE.Vector3(0, 0, (backward ? 1 : 0) - (forward ? 1 : 0));
    const sideVector = new THREE.Vector3((left ? 1 : 0) - (right ? 1 : 0), 0, 0);
    const direction = new THREE.Vector3();

    direction.subVectors(frontVector, sideVector).normalize().multiplyScalar(PLAYER_SPEED);
    direction.applyEuler(camera.rotation);

    let yVelocity = velocity.y;

    // Double-tap fly logic
    const isDoubleTap = jump && !wasJumpPressed.current;
    if (isDoubleTap) {
      const now = Date.now();
      if (now - lastSpacePress.current < DOUBLE_TAP_TIME) {
        setIsFlying(prev => !prev);
        lastSpacePress.current = 0;
        spacePressHandled.current = true;
      } else {
        lastSpacePress.current = now;
      }
    }

    if (isFlying) {
      if (jump && !spacePressHandled.current) yVelocity = FLY_SPEED;
      else if (shift) yVelocity = -FLY_SPEED;
      else yVelocity = 0;
    } else {
      if (jump && !wasJumpPressed.current && !spacePressHandled.current) {
        const ray = new rapier.Ray(body.current.translation(), { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, 1.5, true);
        if (hit && hit.timeOfImpact < 1.2) yVelocity = JUMP_FORCE;
      }
    }

    if (!jump && wasJumpPressed.current) spacePressHandled.current = false;
    wasJumpPressed.current = jump;

    body.current.setLinvel({ x: direction.x, y: yVelocity, z: direction.z }, true);
    const translation = body.current.translation();
    camera.position.set(translation.x, translation.y + 0.6, translation.z);
  });

  return (
    <RigidBody ref={body} colliders={false} mass={1} type="dynamic" position={position} enabledRotations={[false, false, false]} friction={0}>
      <CapsuleCollider args={[0.4, 0.4]} />
    </RigidBody>
  );
};
