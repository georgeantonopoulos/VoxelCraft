
import * as THREE from 'three';
import React, { useRef, useState, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useKeyboardControls } from '@react-three/drei';
import { RigidBody, CapsuleCollider, useRapier } from '@react-three/rapier';
import { PLAYER_SPEED, JUMP_FORCE } from '../constants';
import { metadataDB } from '../services/MetadataDB';

export const Player = ({ position = [16, 32, 16] }: { position?: [number, number, number] }) => {
  const body = useRef<any>(null);
  const [, getKeys] = useKeyboardControls();
  const { rapier, world } = useRapier();
  const [currentFriction, setCurrentFriction] = useState(0);

  useFrame((state, delta) => {
    if (!body.current) return;

    const { forward, backward, left, right, jump } = getKeys();
    const isMoving = forward || backward || left || right;
    
    const velocity = body.current.linvel();
    const translation = body.current.translation();
    const camera = state.camera;
    
    // --- Movement Logic ---
    if (isMoving) {
        // Standard Movement
        const frontVector = new THREE.Vector3(0, 0, (backward ? 1 : 0) - (forward ? 1 : 0));
        const sideVector = new THREE.Vector3((left ? 1 : 0) - (right ? 1 : 0), 0, 0);
        const direction = new THREE.Vector3();

        direction.subVectors(frontVector, sideVector).normalize().multiplyScalar(PLAYER_SPEED);

        // Apply rotation around Y axis
        const euler = new THREE.Euler(0, camera.rotation.y, 0);
        direction.applyEuler(euler);

        body.current.setLinvel({ x: direction.x, y: velocity.y, z: direction.z }, true);
        if (currentFriction !== 0) setCurrentFriction(0);

    } else {
        const ray = new rapier.Ray(translation, { x: 0, y: -1, z: 0 });
        const hit = world.castRay(ray, 1.5, true);

        let isWet = false;
        if (hit && hit.timeOfImpact < 1.2) {
            const hitPoint = ray.pointAt(hit.timeOfImpact);
            const sampleY = hitPoint.y - 0.1;
            const wetness = metadataDB.getGlobal(hitPoint.x, sampleY, hitPoint.z, 'wetness');
            if (wetness > 50) isWet = true;
        }

        if (isWet) {
            if (currentFriction !== 0.1) setCurrentFriction(0.1);
        } else {
            body.current.setLinvel({ x: 0, y: velocity.y, z: 0 }, true);
            if (currentFriction !== 2.0) setCurrentFriction(2.0);
        }
    }

    if (jump) {
      const ray = new rapier.Ray(translation, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 1.5, true);
      if (hit && hit.timeOfImpact < 1.2) {
         body.current.setLinvel({ x: velocity.x, y: JUMP_FORCE, z: velocity.z }, true);
      }
    }

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
      friction={currentFriction}
    >
      <CapsuleCollider args={[0.5, 0.5]} />
    </RigidBody>
  );
};
