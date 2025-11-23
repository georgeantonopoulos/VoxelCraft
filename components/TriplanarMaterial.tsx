import * as THREE from 'three';
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';

// 1. Vertex Shader: Pass voxel attributes to the pixel shader
const vertexShader = `
  attribute float aMaterial;
  attribute float aWetness;
  attribute float aMossiness;

  varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vMaterial = aMaterial;
    vWetness = aWetness;
    vMossiness = aMossiness;
    
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    // Required output for CustomShaderMaterial
    csm_Position = position;
  }
`;

// 2. Fragment Shader: Logic for mixing colors
const fragmentShader = `
  uniform sampler3D uNoiseTexture;
  uniform vec3 uColorStone;
  uniform vec3 uColorGrass;
  uniform vec3 uColorDirt;
  uniform vec3 uColorSand;
  uniform vec3 uColorSnow;
  uniform vec3 uColorWater;

  varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    // 1. Basic Material Selection
    vec3 col = uColorStone;
    float m = vMaterial;

    // Hardcoded material blending matches your engine's IDs
    if (m < 2.0) col = uColorStone;      // Bedrock
    else if (m < 3.0) col = uColorStone; // Stone
    else if (m < 4.0) col = uColorDirt;  // Dirt
    else if (m < 5.0) col = uColorGrass; // Grass
    else if (m < 6.0) col = uColorSand;  // Sand
    else if (m < 7.0) col = uColorSnow;  // Snow
    else if (m < 8.0) col = uColorDirt;  // Clay
    else col = uColorWater;              // Water

    // 2. Triplanar Noise (Subtle Detail)
    float n = texture(uNoiseTexture, vWorldPosition * 0.05).r;
    col = col * (0.92 + 0.16 * n); // Slight contrast boost

    // 3. Moss Overlay (Vibrant Green)
    if (vMossiness > 0.1) {
        col = mix(col, vec3(0.15, 0.6, 0.1), vMossiness * 0.9);
    }

    // 4. Wetness (Darkening)
    col = mix(col, col * 0.4, vWetness);

    // OUTPUT to PBR Engine
    csm_DiffuseColor = vec4(col, 1.0);

    // Dynamic PBR Properties
    // Dry terrain = Matte (0.9), Wet = Shiny (0.2)
    float roughness = mix(0.9, 0.2, vWetness);

    // Water blocks are always polished
    if (m >= 8.0) roughness = 0.05;

    csm_Roughness = roughness;
    csm_Metalness = 0.0;
  }
`;

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3, opacity?: number }> = ({ opacity = 1 }) => {
  const materialRef = useRef<any>(null);

  useFrame(() => {
    if (materialRef.current) {
        materialRef.current.uniforms.uNoiseTexture.value = noiseTexture;
    }
  });

  return (
    <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        // Base PBR settings
        roughness={0.9}
        metalness={0.0}

        vertexShader={vertexShader}
        fragmentShader={fragmentShader}

        // VIBRANT PALETTE DEFAULTS
        uniforms={{
            uNoiseTexture: { value: noiseTexture },
            uColorStone: { value: new THREE.Color('#888c8d') }, // Lighter neutral grey
            uColorGrass: { value: new THREE.Color('#41a024') }, // Vibrant, lush green
            uColorDirt: { value: new THREE.Color('#755339') },  // Warm brown
            uColorSand: { value: new THREE.Color('#ebd89f') },  // Bright beach sand
            uColorSnow: { value: new THREE.Color('#ffffff') },
            uColorWater: { value: new THREE.Color('#0099ff') }, // Tropical blue
        }}

        transparent={opacity < 1}
        {...({ silent: true } as any)}
    />
  );
};
