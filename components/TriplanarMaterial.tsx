import * as THREE from 'three';
import React, { useRef, useEffect, useMemo } from 'react';
import CustomShaderMaterial from 'three-custom-shader-material';
import { useFrame } from '@react-three/fiber';
import { noiseTexture } from '../utils/sharedResources';
import { WATER_LEVEL } from '../constants';
import CSM from 'three-csm';

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3, opacity?: number, csm?: CSM }> = ({ opacity = 1, csm }) => {
  const materialRef = useRef<any>(null);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uNoiseTexture: { value: noiseTexture },
    uColorBedrock: { value: new THREE.Color('#2a2a2a') },
    uColorStone: { value: new THREE.Color('#7a8288') },
    uColorDirt: { value: new THREE.Color('#5d4037') },
    uColorGrass: { value: new THREE.Color('#3d9a24') },
    uColorSand: { value: new THREE.Color('#e6dcab') },
    uColorSnow: { value: new THREE.Color('#ffffff') },
    uColorClay: { value: new THREE.Color('#a67b5b') },
    uColorWater: { value: new THREE.Color('#3b85d1') },
    uColorMoss: { value: new THREE.Color('#5c8a3c') },
    uWaterLevel: { value: WATER_LEVEL },
    uMacroVariation: { value: 0.35 },
    uFogColorNear: { value: new THREE.Color('#bcd5f1') },
    uFogColorFar: { value: new THREE.Color('#e3eef8') },
    uFogHeightFalloff: { value: 0.02 },
  }), []);

  // CSM Handshake: Register material with CSM instance
  useEffect(() => {
      if (csm && materialRef.current) {
          csm.setupMaterial(materialRef.current);
      }
  }, [csm]);

  useFrame(({ clock }) => {
      if (materialRef.current) {
          materialRef.current.uniforms.uTime.value = clock.getElapsedTime();

          // Ensure noise texture reference is fresh
          if (materialRef.current.uniforms.uNoiseTexture.value !== noiseTexture) {
              materialRef.current.uniforms.uNoiseTexture.value = noiseTexture;
          }
      }
  });

  const vertexHeader = `
    attribute float aMaterial;
    attribute float aWetness;
    attribute float aMossiness;
    
    varying float vMaterial;
    varying float vWetness;
    varying float vMossiness;
    varying float vHeight;
    varying vec3 vWorldNormal;
    varying vec3 vPos;
  `;

  const vertexMain = `
    vMaterial = aMaterial;
    vWetness = aWetness;
    vMossiness = aMossiness;
    vHeight = position.y;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    
    // Pass position to CSM if needed, though it usually uses world pos
    csm_Position = position;
  `;

  const fragmentHeader = `
    precision highp sampler3D;

    varying float vMaterial;
    varying float vWetness;
    varying float vMossiness;
    varying float vHeight;
    varying vec3 vWorldNormal;
    varying vec3 vPos;

    uniform sampler3D uNoiseTexture;
    uniform float uTime;

    uniform vec3 uColorBedrock;
    uniform vec3 uColorStone;
    uniform vec3 uColorDirt;
    uniform vec3 uColorGrass;
    uniform vec3 uColorSand;
    uniform vec3 uColorSnow;
    uniform vec3 uColorClay;
    uniform vec3 uColorWater;
    uniform vec3 uColorMoss;

    uniform float uWaterLevel;
    uniform float uMacroVariation;

    uniform vec3 uFogColorNear;
    uniform vec3 uFogColorFar;
    uniform float uFogHeightFalloff;

    float getNoise(vec3 pos, float scale) {
        vec4 n = texture(uNoiseTexture, pos * scale * 0.05);
        return n.r + n.g * 0.5 + n.b * 0.25 + n.a * 0.125;
    }

    vec3 triSampleColor(vec3 pos, vec3 normal, vec3 color, float scale) {
      float n = getNoise(pos, scale);
      return color * (0.85 + 0.3 * n);
    }
  `;

  const fragmentMain = `
      vec3 worldNormal = normalize(vWorldNormal);
      float slope = clamp(dot(worldNormal, vec3(0.0, 1.0, 0.0)), -1.0, 1.0);
      float m = vMaterial;
      float height = vHeight;

      // Macro Variation
      float macroNoise = getNoise(vPos, 0.05) * uMacroVariation;

      // Textures
      vec3 c_stone = triSampleColor(vPos, worldNormal, uColorStone, 0.3);
      vec3 c_grass = triSampleColor(vPos, worldNormal, uColorGrass, 0.25);
      c_grass = mix(c_grass, c_grass * 0.8 + vec3(0.1, 0.1, 0.0), macroNoise * 0.5);

      vec3 c_dirt = triSampleColor(vPos, worldNormal, uColorDirt, 0.35);
      vec3 c_sand = triSampleColor(vPos, worldNormal, uColorSand, 0.4);
      vec3 c_clay = triSampleColor(vPos, worldNormal, uColorClay, 0.3);
      vec3 c_water = uColorWater;
      vec3 c_moss = triSampleColor(vPos, worldNormal, uColorMoss, 0.3);

      vec3 baseColor = c_stone;

      float snowLine = smoothstep(18.0, 28.0, height);
      float beach = smoothstep(uWaterLevel - 1.5, uWaterLevel + 2.0, height);
      float dirtBand = smoothstep(0.2, 0.65, slope);

      // Blending Logic
      if (m < 2.0) {
         baseColor = mix(uColorBedrock, c_stone, clamp(m, 0.0, 1.0));
      } else if (m < 3.0) {
         baseColor = mix(c_stone, c_dirt, clamp(m - 2.0, 0.0, 1.0));
      } else if (m < 4.0) {
         baseColor = mix(c_dirt, c_grass, clamp(m - 3.0, 0.0, 1.0));
      } else if (m < 5.0) {
         baseColor = mix(c_grass, c_sand, clamp(m - 4.0, 0.0, 1.0));
      } else if (m < 6.0) {
         baseColor = mix(c_sand, uColorSnow, clamp(m - 5.0, 0.0, 1.0));
      } else if (m < 7.0) {
         baseColor = mix(uColorSnow, c_clay, clamp(m - 6.0, 0.0, 1.0));
      } else if (m < 8.0) {
         baseColor = mix(c_clay, c_water, clamp(m - 7.0, 0.0, 1.0));
      } else {
         baseColor = c_water;
      }

      if (abs(m - 10.0) < 0.5) {
          baseColor = c_moss;
      }

      float rockThreshold = 1.0 - smoothstep(0.55, 0.8, slope);
      baseColor = mix(baseColor, c_stone, rockThreshold);
      baseColor = mix(baseColor, mix(baseColor, uColorSnow, 0.65), snowLine);
      baseColor = mix(baseColor, mix(baseColor, c_sand, 0.7), beach * (1.0 - snowLine));
      baseColor = mix(baseColor, c_dirt, dirtBand * 0.35);

      // Wetness
      float wetFactor = smoothstep(0.05, 0.6, vWetness);
      baseColor = mix(baseColor, baseColor * 0.4, wetFactor * 0.7);

      // Moss Overlay
      float mossNoise = getNoise(vPos, 0.5);
      float mossThreshold = smoothstep(0.2, 0.5, vMossiness + mossNoise * 0.2);
      baseColor = mix(baseColor, c_moss, mossThreshold);

      // PBR Injection
      csm_DiffuseColor = vec4(baseColor, 1.0);

      // Roughness Logic
      float rough = 0.9;
      if (m >= 5.0 && m < 6.0) rough = 0.4; // Snow
      if (m >= 8.0) rough = 0.1; // Water

      // Wetness makes it smooth
      rough = mix(rough, 0.1, wetFactor);
      csm_Roughness = rough;
      csm_Metalness = 0.0; // Non-metallic generally

      // --- Custom Art Direction ---

      // 1. Height Fog
      float heightFog = clamp(exp(-max(height - uWaterLevel, 0.0) * uFogHeightFalloff), 0.0, 1.0);
      vec3 fogColor = mix(uFogColorNear, uFogColorFar, clamp((height + 20.0) / 80.0, 0.0, 1.0));

      // Mix Fog into Diffuse (Darken/Tint)
      csm_DiffuseColor.rgb = mix(csm_DiffuseColor.rgb, fogColor, heightFog * 0.5);

      // 2. Rim Light
      vec3 viewDir = normalize(cameraPosition - vPos);
      float rim = pow(1.0 - max(dot(viewDir, worldNormal), 0.0), 3.0);
      vec3 rimColor = baseColor * 2.0;

      csm_Emissive = rim * rimColor * 0.2;
  `;

  return (
      <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        vertexShader={vertexHeader + vertexMain}
        fragmentShader={fragmentHeader + fragmentMain}
        uniforms={uniforms}
        transparent={opacity < 1}
        opacity={opacity}
        side={THREE.DoubleSide}
        silent
      />
  );
};
