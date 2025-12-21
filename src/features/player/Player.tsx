import * as THREE from 'three';
import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '@/constants';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { usePlayerInput } from './usePlayerInput';
import { useWorldStore } from '@/state/WorldStore';
import { useEnvironmentStore } from '@/state/EnvironmentStore';
import { LuminaExitFinder } from '@features/terrain/logic/LuminaExitFinder';

const FLY_SPEED = 8;
const DOUBLE_TAP_TIME = 300;
const SWIM_SPEED = 4.0;
const SWIM_VERTICAL_SPEED = 4.5;

// Scratch objects to avoid per-frame allocations
const scratchPos = new THREE.Vector3();
const scratchMoveDir = new THREE.Vector3();
const scratchCamDir = new THREE.Vector3();
const scratchForward = new THREE.Vector3();
const scratchSide = new THREE.Vector3();
const scratchUp = new THREE.Vector3(0, 1, 0);
const scratchVelocity = new THREE.Vector3();
export const Player = ({ position = [16, 32, 16] }: { position?: [number, number, number] }) => {
  const body = useRef<any>(null);
  const [isLuminaDashing, setIsLuminaDashing] = useState(false);
  const luminaTarget = useRef<THREE.Vector3 | null>(null);

  const getInput = usePlayerInput();
  const { rapier, world } = useRapier();
  const [isFlying, setIsFlying] = useState(false);
  const lastSpacePress = useRef<number>(0);
  const wasJumpPressed = useRef<boolean>(false);
  const spacePressHandled = useRef<boolean>(false);

  const setPlayerParams = useWorldStore((state) => state.setPlayerParams);

  useEffect(() => {
    if (!body.current) return;
    body.current.setGravityScale(isFlying ? 0 : 1, true);
  }, [isFlying]);

  useEffect(() => {
    const handleLumina = () => {
      if (!body.current) return;
      const pos = body.current.translation();
      const exit = LuminaExitFinder.findClosestExit(pos.x, pos.y, pos.z);

      if (exit) {
        luminaTarget.current = new THREE.Vector3(exit.x, exit.y, exit.z);
        setIsLuminaDashing(true);
        window.dispatchEvent(new CustomEvent('lumina-glow-start', { detail: { duration: 1000 } }));
      }
    };
    window.addEventListener('lumina-special-action', handleLumina);
    return () => window.removeEventListener('lumina-special-action', handleLumina);
  }, []);

  useFrame((state, delta) => {
    if (!body.current) return;

    const pos = body.current.translation();
    scratchPos.set(pos.x, pos.y, pos.z);

    if (isLuminaDashing && luminaTarget.current) {
      const dist = scratchPos.distanceTo(luminaTarget.current);
      if (dist < 0.5) {
        setIsLuminaDashing(false);
        luminaTarget.current = null;
      } else {
        scratchMoveDir.copy(luminaTarget.current).sub(scratchPos);
        if (scratchMoveDir.lengthSq() > 0.001) {
          scratchMoveDir.normalize();
          scratchMoveDir.multiplyScalar(Math.min(dist, delta * 120));
          body.current.setTranslation({
            x: pos.x + scratchMoveDir.x,
            y: pos.y + scratchMoveDir.y,
            z: pos.z + scratchMoveDir.z
          }, true);
        } else {
          setIsLuminaDashing(false);
          luminaTarget.current = null;
        }
        return;
      }
    }

    const { move, jump, shift } = getInput();
    const vel = body.current.linvel();
    scratchVelocity.set(vel.x, vel.y, vel.z);

    const camera = state.camera;

    // Water/Swimming logic
    const footY = pos.y - 0.65;
    const midY = pos.y;
    const headY = pos.y + 0.65;
    const footInWater = terrainRuntime.isLiquidAtWorld(pos.x, footY, pos.z);
    const midInWater = terrainRuntime.isLiquidAtWorld(pos.x, midY, pos.z);
    const headInWater = terrainRuntime.isLiquidAtWorld(pos.x, headY, pos.z);
    const waterHits = (footInWater ? 1 : 0) + (midInWater ? 1 : 0) + (headInWater ? 1 : 0);
    const inWater = waterHits > 0;
    const submersion = waterHits / 3.0;

    // Update EnvironmentStore for underwater effects (bubbles, exposure, vignette)
    const setUnderwaterBlend = useEnvironmentStore.getState().setUnderwaterBlend;
    const setUnderwaterState = useEnvironmentStore.getState().setUnderwaterState;
    setUnderwaterBlend(submersion);
    const isFullyUnderwater = headInWater;
    const currentUnderwaterState = useEnvironmentStore.getState().isUnderwater;
    if (isFullyUnderwater !== currentUnderwaterState) {
      setUnderwaterState(isFullyUnderwater, state.clock.getElapsedTime());
    }

    // Calculate rotation for minimap
    camera.getWorldDirection(scratchCamDir);
    const rotation = Math.atan2(-scratchCamDir.x, -scratchCamDir.z);

    setPlayerParams({ x: pos.x, y: pos.y, z: pos.z, rotation });

    // Movement calculation: Use horizontal heading to avoid speed loss when looking down
    scratchForward.copy(scratchCamDir);
    scratchForward.y = 0;
    scratchForward.normalize();

    // Cross product with Up gives Side vector (Right)
    scratchSide.crossVectors(scratchUp, scratchForward).normalize();

    // move.z is forward/back (-1 is W), move.x is left/right
    scratchMoveDir.set(0, 0, 0);
    scratchMoveDir.addScaledVector(scratchForward, -move.z);
    scratchMoveDir.addScaledVector(scratchSide, -move.x);

    const baseSpeed = (inWater && !isFlying) ? SWIM_SPEED : PLAYER_SPEED;
    const drag = (inWater && !isFlying) ? (1.0 - 0.35 * submersion) : 1.0;

    if (scratchMoveDir.lengthSq() > 1.0) scratchMoveDir.normalize();
    scratchMoveDir.multiplyScalar(baseSpeed * drag);

    let yVelocity = scratchVelocity.y;

    // Jump / Fly double tap
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
      if (jump && !spacePressHandled.current) {
        yVelocity = SWIM_VERTICAL_SPEED;
      } else if (shift) {
        yVelocity = -SWIM_VERTICAL_SPEED;
      } else {
        const surfaceY = terrainRuntime.getSeaSurfaceYAtWorld(pos.x, pos.z);
        if (surfaceY != null) {
          const targetCenterY = surfaceY - 0.55;
          const error = targetCenterY - pos.y;
          yVelocity = THREE.MathUtils.clamp(error * 2.2 - scratchVelocity.y * 0.35, -3.0, 3.0);
        } else {
          yVelocity = scratchVelocity.y * 0.7;
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

    body.current.setLinvel({ x: scratchMoveDir.x, y: yVelocity, z: scratchMoveDir.z }, true);

    // Sync camera to body eye level
    camera.position.set(pos.x, pos.y + 0.75, pos.z);
  });

  return (
    <RigidBody ref={body} colliders={false} mass={1} type="dynamic" position={position} enabledRotations={[false, false, false]} friction={0}>
      <CapsuleCollider args={[0.4, 0.4]} />
    </RigidBody>
  );
};

