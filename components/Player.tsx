import * as THREE from 'three';
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '../constants';

export const Player = () => {
  const body = useRef<any>(null);
  const [, getKeys] = useKeyboardControls();
  const { rapier, world } = useRapier();

  useFrame((state, delta) => {
    if (!body.current) return;

    const { forward, backward, left, right, jump } = getKeys();
    
    const velocity = body.current.linvel();
    const camera = state.camera;
    
    // Calculate movement direction relative to camera
    const frontVector = new THREE.Vector3(0, 0, (backward ? 1 : 0) - (forward ? 1 : 0));
    const sideVector = new THREE.Vector3((left ? 1 : 0) - (right ? 1 : 0), 0, 0);
    const direction = new THREE.Vector3();
    
    direction.subVectors(frontVector, sideVector).normalize().multiplyScalar(PLAYER_SPEED);
    direction.applyEuler(camera.rotation);
    
    body.current.setLinvel({ x: direction.x, y: velocity.y, z: direction.z }, true);

    // Jump (Very basic check)
    if (jump) {
      // Simple raycast down to check if grounded
      const ray = new rapier.Ray(body.current.translation(), { x: 0, y: -1, z: 0 });
      // Use world directly (it is the Rapier World instance)
      const hit = world.castRay(ray, 1.5, true);
      
      // Check Time of Impact (toi / timeOfImpact)
      if (hit && hit.timeOfImpact < 1.2) {
         body.current.setLinvel({ x: velocity.x, y: JUMP_FORCE, z: velocity.z }, true);
      }
    }

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
      position={[16, 32, 16]} 
      enabledRotations={[false, false, false]}
      friction={0}
    >
      <CapsuleCollider args={[0.5, 0.5]} />
    </RigidBody>
  );
};