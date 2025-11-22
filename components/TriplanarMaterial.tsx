
import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { extend, useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { WATER_LEVEL } from '../constants';
import { noiseTexture } from '../utils/sharedResources';

import type CSM from 'three-csm';

const TerrainShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0.5, 0.85, 0.35).normalize(),
    uSunColor: new THREE.Color('#fff2cc'), // Slightly warmer, less bright white
    uAmbientColor: new THREE.Color('#3a4d66'), // Darker ambient for better contrast
    uColorBedrock: new THREE.Color('#2a2a2a'),
    uColorStone: new THREE.Color('#7a8288'),
    uColorDirt: new THREE.Color('#5d4037'),
    uColorGrass: new THREE.Color('#2d8a1b'), // Richer, darker green
    uColorSand: new THREE.Color('#e6dcab'),
    uColorSnow: new THREE.Color('#ffffff'),
    uColorClay: new THREE.Color('#a67b5b'),
    uColorWater: new THREE.Color('#3b85d1'),
    uColorMoss: new THREE.Color('#4c7a2d'), // Darker moss
    uFogColorNear: new THREE.Color('#b0ccf0'), // Slightly deeper blue
    uFogColorFar: new THREE.Color('#dbe9f4'),
    uFogDensity: 0.01,
    uFogHeightFalloff: 0.02,
    uDetailStrength: 0.4,
    uMacroVariation: 0.35,
    uAOIntensity: 0.45,
    uWaterLevel: WATER_LEVEL,
    uOpacity: 1.0,
    uNoiseTexture: null // Will be set via prop
  },
  `
    precision highp float;
    in float aMaterial;
    in float aWetness;
    in float aMossiness;
    
    out vec3 vNormal;
    out vec3 vPosition;
    out vec3 vWorldNormal;
    out float vMaterial;
    out float vDepth;
    out float vHeight;
    out float vWetness;
    out float vMossiness;
    
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vMaterial = aMaterial;
      vWetness = aWetness;
      vMossiness = aMossiness;
      vHeight = vPosition.y;
      
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  `
    precision highp float;
    precision highp sampler3D;

    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uAmbientColor;
    uniform sampler3D uNoiseTexture;

    uniform vec3 uColorGrass;
    uniform vec3 uColorStone;
    uniform vec3 uColorDirt;
    uniform vec3 uColorSand;
    uniform vec3 uColorSnow;
    uniform vec3 uColorClay;
    uniform vec3 uColorWater;
    uniform vec3 uColorMoss;
    uniform vec3 uColorBedrock;
    uniform vec3 uFogColorNear;
    uniform vec3 uFogColorFar;
    uniform float uFogDensity;
    uniform float uFogHeightFalloff;
    uniform float uDetailStrength;
    uniform float uMacroVariation;
    uniform float uAOIntensity;
    uniform float uWaterLevel;
    uniform float uOpacity;
    
    in vec3 vNormal;
    in vec3 vPosition;
    in vec3 vWorldNormal;
    in float vMaterial;
    in float vDepth;
    in float vHeight;
    in float vWetness;
    in float vMossiness;

    out vec4 fragColor;

    // Sample 3D noise from texture for basic variation
    float getNoise(vec3 pos, float scale) {
        vec4 n = texture(uNoiseTexture, pos * scale * 0.05); 
        return n.r + n.g * 0.5 + n.b * 0.25 + n.a * 0.125;
    }

    // Fractal Brownian Motion for detailed natural noise
    float fbm(vec3 p) {
        float f = 0.0;
        float w = 0.5;
        vec3 shift = vec3(100.0);
        for (int i = 0; i < 4; i++) {
            vec4 n = texture(uNoiseTexture, p * 0.05);
            f += w * (n.r + n.g * 0.5 + n.b * 0.25);
            p = p * 2.0 + shift;
            w *= 0.5;
        }
        return f;
    }

    vec3 triSampleColor(vec3 pos, vec3 normal, vec3 color, float scale) {
      float n = getNoise(pos, scale);
      return color * (0.85 + 0.3 * n);
    }

    // Enhanced Detail Normal using FBM
    vec3 calcDetailNormal(vec3 pos, vec3 normal) {
      float eps = 0.1;
      float scale = 1.2;
      
      // Sample FBM at neighbors
      float hC = fbm(pos * scale);
      float hX = fbm((pos + vec3(eps, 0, 0)) * scale);
      float hY = fbm((pos + vec3(0, eps, 0)) * scale);
      float hZ = fbm((pos + vec3(0, 0, eps)) * scale);

      float dX = (hC - hX);
      float dY = (hC - hY);
      float dZ = (hC - hZ);

      vec3 bump = vec3(dX, dY, dZ);
      // Strengthen bump mapping
      return normalize(normal + bump * uDetailStrength * 4.0);
    }

    void main() {
      vec3 worldNormal = normalize(vWorldNormal);
      float slope = clamp(dot(worldNormal, vec3(0.0, 1.0, 0.0)), -1.0, 1.0);
      float m = vMaterial;
      float height = vHeight;

      // Macro variation for large scale features
      float macroNoise = getNoise(vPosition, 0.03) * uMacroVariation;

      // Material Colors with variation
      vec3 c_stone = triSampleColor(vPosition, worldNormal, uColorStone, 0.3);
      
      // Grass Variation (Dry/Green patches)
      vec3 c_grass = triSampleColor(vPosition, worldNormal, uColorGrass, 0.25);
      float grassPatch = smoothstep(0.3, 0.7, getNoise(vPosition, 0.02));
      c_grass = mix(c_grass, c_grass * vec3(1.1, 1.05, 0.8), grassPatch * 0.4); // Yellowish dry patches

      vec3 c_dirt = triSampleColor(vPosition, worldNormal, uColorDirt, 0.35);
      vec3 c_sand = triSampleColor(vPosition, worldNormal, uColorSand, 0.4);
      vec3 c_clay = triSampleColor(vPosition, worldNormal, uColorClay, 0.3);
      vec3 c_water = uColorWater;
      vec3 c_moss = triSampleColor(vPosition, worldNormal, uColorMoss, 0.3);

      vec3 baseColor = c_stone;
      float specular = 0.04;
      float roughness = 0.8;
      
      // Micro-detail grain for roughness
      float grain = getNoise(vPosition, 2.0);
      roughness += (grain - 0.5) * 0.15;

      float snowLine = smoothstep(18.0, 28.0, height);
      float beach = smoothstep(uWaterLevel - 1.5, uWaterLevel + 2.0, height);
      float dirtBand = smoothstep(0.2, 0.65, slope);

      // Material Blending
      if (m < 2.0) {
         baseColor = mix(uColorBedrock, c_stone, clamp(m, 0.0, 1.0));
      } else if (m < 3.0) {
         baseColor = mix(c_stone, c_dirt, clamp(m - 2.0, 0.0, 1.0));
         roughness = 0.9;
      } else if (m < 4.0) {
         baseColor = mix(c_dirt, c_grass, clamp(m - 3.0, 0.0, 1.0));
         roughness = 0.85;
      } else if (m < 5.0) {
         baseColor = mix(c_grass, c_sand, clamp(m - 4.0, 0.0, 1.0));
         roughness = 0.9;
      } else if (m < 6.0) {
         baseColor = mix(c_sand, uColorSnow, clamp(m - 5.0, 0.0, 1.0));
         specular = 0.3; roughness = 0.4;
      } else if (m < 7.0) {
         baseColor = mix(uColorSnow, c_clay, clamp(m - 6.0, 0.0, 1.0));
         roughness = 0.6;
      } else if (m < 8.0) {
         baseColor = mix(c_clay, c_water, clamp(m - 7.0, 0.0, 1.0));
         specular = 0.8; roughness = 0.2;
      } else {
         baseColor = c_water;
         specular = 0.9; roughness = 0.1;
      }

      // Explicit Mossy Stone Override
      if (abs(m - 10.0) < 0.5) {
          baseColor = c_moss;
          specular = 0.02; roughness = 1.0;
      }

      // Perturbed rock threshold for more natural cliffs
      float rockThreshold = 1.0 - smoothstep(0.5, 0.8, slope + macroNoise * 0.25);
      baseColor = mix(baseColor, c_stone, rockThreshold);
      
      baseColor = mix(baseColor, mix(baseColor, uColorSnow, 0.65), snowLine);
      baseColor = mix(baseColor, mix(baseColor, c_sand, 0.7), beach * (1.0 - snowLine));
      baseColor = mix(baseColor, c_dirt, dirtBand * 0.35);

      // Wetness Effects
      float wetFactor = smoothstep(0.05, 0.6, vWetness);
      baseColor = mix(baseColor, baseColor * 0.5, wetFactor * 0.6);
      specular = mix(specular, 0.5, wetFactor * 0.8);
      roughness = mix(roughness, 0.2, wetFactor * 0.8);

      // Moss Growth
      float mossNoise = getNoise(vPosition, 0.5);
      float mossThreshold = smoothstep(0.2, 0.5, vMossiness + mossNoise * 0.2);
      baseColor = mix(baseColor, c_moss, mossThreshold);
      roughness = mix(roughness, 1.0, mossThreshold);
      specular = mix(specular, 0.02, mossThreshold);

      float ao = clamp(1.0 - (1.0 - slope) * uAOIntensity - macroNoise * 0.25, 0.55, 1.0);

      vec3 normal = calcDetailNormal(vPosition, worldNormal);
      vec3 lightDir = normalize(uSunDir);
      vec3 viewDir = normalize(cameraPosition - vPosition);

      float NdotL = max(dot(normal, lightDir), 0.0);
      
      // Subsurface Scattering (SSS) for Grass
      // Simulates light passing through thin blades when backlit
      float sssFactor = 0.0;
      if (m >= 3.0 && m < 4.0) { // Grass range
          float VdotL = dot(viewDir, -lightDir);
          sssFactor = smoothstep(0.0, 1.0, VdotL) * 0.4 * (1.0 - NdotL);
          baseColor += uColorGrass * sssFactor * 0.6;
      }

      vec3 diffuse = uSunColor * NdotL;

      // PBR-style Specular
      vec3 halfVec = normalize(lightDir + viewDir);
      float NdotH = max(dot(normal, halfVec), 0.0);
      
      float shininess = (1.0 - roughness) * 128.0 + 2.0;
      float spec = pow(NdotH, shininess) * specular;

      // Fresnel effect
      float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 5.0);
      spec += fresnel * specular * 0.5;

      float rim = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0) * 0.2;

      vec3 ambient = uAmbientColor * (0.6 + 0.4 * ao);
      vec3 lit = baseColor * (ambient + diffuse) + spec * uSunColor + rim * baseColor * 0.5;

      // Fog
      float distFog = 1.0 - exp2(-uFogDensity * uFogDensity * vDepth * vDepth * 1.2);
      float heightFog = clamp(exp(-max(height - uWaterLevel, 0.0) * uFogHeightFalloff), 0.0, 1.0);
      float fogFactor = clamp(distFog * (0.35 + 0.65 * heightFog), 0.0, 1.0);

      vec3 fogColor = mix(uFogColorNear, uFogColorFar, clamp((height + 20.0) / 80.0, 0.0, 1.0));
      vec3 finalColor = mix(lit, fogColor, fogFactor);

      fragColor = vec4(finalColor, uOpacity);
    }
  `
);

extend({ TerrainShaderMaterial });

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3, opacity?: number, csm?: CSM | null }> = ({ sunDirection, opacity = 1, csm }) => {
  const ref = useRef<any>(null);

  // CSM Setup
  React.useEffect(() => {
    if (ref.current && csm) {
      csm.setupMaterial(ref.current);
    }
  }, [csm, ref]);

  useFrame(({ clock }) => {
    if(ref.current) {
        ref.current.uTime = clock.getElapsedTime();
        if (sunDirection) {
          ref.current.uSunDir = sunDirection;
        }
        ref.current.uOpacity = opacity;

        if (ref.current.uNoiseTexture !== noiseTexture) {
             ref.current.uNoiseTexture = noiseTexture;
        }
    }
  });

  return (
    // @ts-ignore
    <terrainShaderMaterial 
      ref={ref}
      uNoiseTexture={noiseTexture}
      side={THREE.DoubleSide} 
      transparent={opacity < 1}
      glslVersion={THREE.GLSL3}
    />
  );
};
