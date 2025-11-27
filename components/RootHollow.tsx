import * as THREE from 'three';
import React, { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';
import { useGameStore } from '../services/GameManager';
import { FractalTree } from './FractalTree';

const vertexShader = `
  uniform float uTime;
  uniform float uDisplacementStrength;
  uniform sampler3D uNoiseTexture;
  varying vec3 vWorldPosition;
  varying vec3 vNormal;

  void main() {
    vNormal = normal;
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    float displacement = texture(uNoiseTexture, position * 0.5).r * uDisplacementStrength;
    vec3 displacedPosition = position + normal * -displacement; // Invert for "Hollow"
    csm_Position = displacedPosition;
  }
`;

const fragmentShader = `
  varying vec3 vWorldPosition;
  varying vec3 vNormal;
  void main() {
    vec3 color = vec3(0.1, 0.05, 0.0); // Dark dirt
    csm_DiffuseColor = vec4(color, 1.0);
  }
`;

export const RootHollow: React.FC<{ position: [number, number, number] }> = ({ position }) => {
  const materialRef = useRef<any>();
  const [state, setState] = useState<'IDLE' | 'GROWING'>('IDLE');
  const [seed, setSeed] = useState(0);

  const placedFloras = useGameStore(s => s.placedFloras);
  const removeFlora = useGameStore(s => s.removeFlora);
  const hollowPos = useRef(new THREE.Vector3(...position)).current;

  useFrame(({ clock }) => {
    if (materialRef.current) materialRef.current.uniforms.uTime.value = clock.getElapsedTime();

    if (state === 'IDLE') {
        for (const flora of placedFloras) {
            // Check Live Physics Position if available, else static
            const body = flora.bodyRef?.current;
            const floraPos = body ? body.translation() : flora.position;
            const dist = hollowPos.distanceTo(new THREE.Vector3(floraPos.x, floraPos.y, floraPos.z));

            if (dist < 1.5) {
                // Check if settled (low velocity)
                const vel = body ? body.linvel() : {x:0, y:0, z:0};
                if (Math.abs(vel.x) + Math.abs(vel.y) + Math.abs(vel.z) < 0.1) {
                    removeFlora(flora.id);
                    setSeed(Math.random() * 9999);
                    setState('GROWING');
                }
            }
        }
    }
  });

  if (state === 'GROWING') {
    return <FractalTree position={position} seed={seed} />;
  }

  return (
    <mesh position={position} scale={1.5}>
      <sphereGeometry args={[1, 32, 32]} />
      <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          uTime: { value: 0 },
          uDisplacementStrength: { value: 0.8 },
          uNoiseTexture: { value: noiseTexture },
        }}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
};