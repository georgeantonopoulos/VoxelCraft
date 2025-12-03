import * as THREE from 'three';
import { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '@/constants';
import { simulationManager } from '@features/flora/logic/SimulationManager';
import { useWorldStore } from '@state/WorldStore';

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

  // Hypothermia State
  const [isFreezing, setIsFreezing] = useState(false);

  // HUD Overlay for Freezing
  useEffect(() => {
    const hud = document.getElementById('hud-overlay');
    if (!hud) {
        const div = document.createElement('div');
        div.id = 'hud-overlay';
        div.style.position = 'absolute';
        div.style.top = '0';
        div.style.left = '0';
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.pointerEvents = 'none';
        div.style.transition = 'background-color 0.5s';
        div.style.zIndex = '10';
        document.body.appendChild(div);
    }
  }, []);

  useEffect(() => {
    const hud = document.getElementById('hud-overlay');
    if (hud) {
        hud.style.backgroundColor = isFreezing ? 'rgba(0, 100, 255, 0.3)' : 'transparent';
        if (isFreezing) {
            hud.style.boxShadow = 'inset 0 0 100px rgba(0, 255, 255, 0.5)';
        } else {
            hud.style.boxShadow = 'none';
        }
    }
  }, [isFreezing]);

  useEffect(() => {
    if (!body.current) return;
    body.current.setGravityScale(isFlying ? 0 : 1, true);
  }, [isFlying]);

  useFrame((state) => {
    if (!body.current) return;

    const pos = body.current.translation();
    const time = useWorldStore.getState().time; // Assuming time is in store (0-24 or similar)
    const isNight = time > 18 || time < 6;

    // Check Hypothermia
    const { wetness } = simulationManager.getMetadataAt(pos.x, pos.y, pos.z);

    // Logic: Night AND Wet > 50%
    const freezing = isNight && wetness > 0.5;
    if (freezing !== isFreezing) setIsFreezing(freezing);

    // Calculate rotation from forward vector to avoid Euler order issues
    const dir = new THREE.Vector3();
    state.camera.getWorldDirection(dir);
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
    const velocity = body.current.linvel();
    const camera = state.camera;

    const frontVector = new THREE.Vector3(0, 0, (backward ? 1 : 0) - (forward ? 1 : 0));
    const sideVector = new THREE.Vector3((left ? 1 : 0) - (right ? 1 : 0), 0, 0);
    const direction = new THREE.Vector3();

    // Apply slow if freezing
    const speed = freezing ? PLAYER_SPEED * 0.5 : PLAYER_SPEED;

    direction.subVectors(frontVector, sideVector).normalize().multiplyScalar(speed);
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
    camera.position.set(translation.x, translation.y + 0.8, translation.z);
  });

  return (
    <RigidBody ref={body} colliders={false} mass={1} type="dynamic" position={position} enabledRotations={[false, false, false]} friction={0}>
      <CapsuleCollider args={[0.5, 0.5]} />
    </RigidBody>
  );
};
