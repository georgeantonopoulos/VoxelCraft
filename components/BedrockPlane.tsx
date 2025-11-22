import React from 'react';
import { RigidBody } from '@react-three/rapier';

export const BedrockPlane = () => {
  return (
    <RigidBody type="fixed" position={[0, -36, 0]} friction={1}>
       <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[2000, 2000]} />
          <meshStandardMaterial color="#050505" roughness={1} />
       </mesh>
    </RigidBody>
  );
};
