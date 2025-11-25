import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material';

interface LuminaFloraProps {
  position: [number, number, number];
  onPickup?: () => void;
  seed?: number; // To vary the phase
}

export const LuminaFlora: React.FC<LuminaFloraProps> = ({ position, onPickup, seed = 0 }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Uniforms for the shader
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#00FFFF') }, // Cyan
    uSeed: { value: seed }
  }), [seed]);

  useFrame(({ clock }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = clock.getElapsedTime();
    }
  });

  return (
    <RigidBody
      type="dynamic"
      colliders="ball"
      position={position}
      restitution={0.2}
      friction={0.8}
      userData={{ type: 'flora' }} // For future interaction
    >
      <group>
        {/* The Light Source - Cool White, moderate range */}
        {/* Only render this for Placed Flora (which this component represents) */}
        <pointLight
            color="#E0F7FA"
            intensity={2.0}
            distance={8}
            decay={2}
            castShadow
        />

        {/* The Visual Bulb - Cyan Emissive with Shader Pulse */}
        <mesh castShadow receiveShadow>
          {/* A cluster of spheres or a single sphere for now. User said "Group of 3 spheres" in plan Phase 1 */}
          <sphereGeometry args={[0.25, 32, 32]} />

          <CustomShaderMaterial
            ref={materialRef}
            baseMaterial={THREE.MeshStandardMaterial}
            vertexShader={`
              varying vec3 vPosition;
              void main() {
                vPosition = position;
              }
            `}
            fragmentShader={`
              uniform float uTime;
              uniform vec3 uColor;
              uniform float uSeed;

              void main() {
                // Breathing effect
                float pulse = sin(uTime * 2.0 + uSeed) * 0.5 + 1.5; // 1.0 to 2.0

                // Emissive is added to the lighting
                csm_Emissive = uColor * pulse;
              }
            `}
            uniforms={uniforms}
            silent
            // MeshStandardMaterial props
            color="#222"
            roughness={0.4}
            toneMapped={false} // Crucial for Bloom
          />
        </mesh>

        {/* Extra geometry for "Cluster" look?
            Let's keep it simple for the first pass or add small side bulbs.
        */}
        <mesh position={[0.15, -0.1, 0.1]} castShadow receiveShadow>
            <sphereGeometry args={[0.15, 16, 16]} />
            <meshStandardMaterial
                color="#222"
                emissive="#00FFFF"
                emissiveIntensity={0.5}
                toneMapped={false}
            />
            {/* Note: Side bulbs use simple material for now, or we can reuse the CSM if we extract it */}
        </mesh>
         <mesh position={[-0.15, -0.15, -0.05]} castShadow receiveShadow>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial
                color="#222"
                emissive="#00FFFF"
                emissiveIntensity={0.5}
                toneMapped={false}
            />
        </mesh>
      </group>
    </RigidBody>
  );
};
