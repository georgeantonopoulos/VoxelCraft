import * as THREE from 'three';
import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '@/constants';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { usePlayerInput } from './usePlayerInput';

const FLY_SPEED = 8;
const DOUBLE_TAP_TIME = 300;
const SWIM_SPEED = 4.0;
const SWIM_VERTICAL_SPEED = 4.5;

export const Player = ({ position = [16, 32, 16] }: { position?: [number, number, number] }) => {
  const body = useRef<any>(null);
  const getInput = usePlayerInput();
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
    const posV3 = new THREE.Vector3(pos.x, pos.y, pos.z);

    // Water query samples along the capsule to estimate submersion.
    // We don't rely on physics colliders for water.
    const footY = posV3.y - 0.65;
    const midY = posV3.y;
    const headY = posV3.y + 0.65;
    const footInWater = terrainRuntime.isLiquidAtWorld(posV3.x, footY, posV3.z);
    const midInWater = terrainRuntime.isLiquidAtWorld(posV3.x, midY, posV3.z);
    const headInWater = terrainRuntime.isLiquidAtWorld(posV3.x, headY, posV3.z);
    const waterHits = (footInWater ? 1 : 0) + (midInWater ? 1 : 0) + (headInWater ? 1 : 0);
    const inWater = waterHits > 0;
    const submersion = waterHits / 3.0;

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

    const { move, jump, shift } = getInput();
    // REMOVED: The Flora Placement logic that was conflicting

    const velocity = body.current.linvel();
    const camera = state.camera;

    const direction = new THREE.Vector3(move.x, 0, move.z);

    // Underwater movement: slower horizontal speed with drag based on submersion.
    const baseSpeed = (inWater && !isFlying) ? SWIM_SPEED : PLAYER_SPEED;
    const drag = (inWater && !isFlying) ? (1.0 - 0.35 * submersion) : 1.0;

    // Normalize only if length > 1 (to allow slow analog movement)
    if (direction.lengthSq() > 1.0) direction.normalize();

    direction.multiplyScalar(baseSpeed * drag);
    direction.applyEuler(camera.rotation);

    let yVelocity = velocity.y;

    // Double-tap fly logic
    // Guard: swimming uses Space constantly; avoid accidental flight toggles while in water.
    const isDoubleTap = jump && !wasJumpPressed.current && !inWater;
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
    } else if (inWater) {
      // Swimming: Space to rise, Shift to sink, otherwise buoyancy toward sea surface.
      if (jump && !spacePressHandled.current) {
        yVelocity = SWIM_VERTICAL_SPEED;
      } else if (shift) {
        yVelocity = -SWIM_VERTICAL_SPEED;
      } else {
        const surfaceY = terrainRuntime.getSeaSurfaceYAtWorld(posV3.x, posV3.z);
        if (surfaceY != null) {
          // Target the capsule center slightly below the surface so the camera sits near the waterline.
          const targetCenterY = surfaceY - 0.55;
          const error = targetCenterY - posV3.y;
          // Simple PD-like control: proportional + mild damping using current y velocity.
          yVelocity = THREE.MathUtils.clamp(error * 2.2 - velocity.y * 0.35, -3.0, 3.0);
        } else {
          // If surface isn't available (chunk not loaded), damp vertical motion.
          yVelocity = velocity.y * 0.7;
        }
      }
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
