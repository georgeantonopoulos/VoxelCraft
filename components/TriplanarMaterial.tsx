
import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { extend, useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { WATER_LEVEL } from '../constants';
import { noiseTexture } from '../utils/sharedResources';

const TerrainShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0.5, 0.85, 0.35).normalize(),
    uSunColor: new THREE.Color('#fff7d1'),
    uAmbientColor: new THREE.Color('#4f6f8d'),
    uColorBedrock: new THREE.Color('#2a2a2a'),
    uColorStone: new THREE.Color('#7a8288'),
    uColorDirt: new THREE.Color('#5d4037'),
    uColorGrass: new THREE.Color('#3d9a24'),
    uColorSand: new THREE.Color('#e6dcab'),
    uColorSnow: new THREE.Color('#ffffff'),
    uFogColorNear: new THREE.Color('#bcd5f1'),
    uFogColorFar: new THREE.Color('#e3eef8'),
    uFogDensity: 0.015,
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
    
    out vec3 vNormal;
    out vec3 vPosition;
    out vec3 vWorldNormal;
    out float vMaterial;
    out float vDepth;
    out float vHeight;
    
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vMaterial = aMaterial;
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

    out vec4 fragColor;

    // Sample 3D noise from texture
    // Channels: R=Base, G=x2, B=x4, A=x8
    float getNoise(vec3 pos, float scale) {
        vec4 n = texture(uNoiseTexture, pos * scale * 0.05); // Scale factor to map world units to texture
        // Reconstruct FBM-like signal
        return n.r + n.g * 0.5 + n.b * 0.25 + n.a * 0.125;
    }

    // Helper for detailing
    float getDetailNoise(vec3 pos, float scale) {
        vec4 n = texture(uNoiseTexture, pos * scale * 0.1);
        return n.r * 2.0 - 1.0; // Simple signed noise
    }

    vec3 triSampleColor(vec3 pos, vec3 normal, vec3 color, float scale) {
      // Simple blending using noise to break uniformity
      float n = getNoise(pos, scale);
      return color * (0.85 + 0.3 * n); // Modulate brightness
    }

    vec3 calcDetailNormal(vec3 pos, vec3 normal) {
      float eps = 0.1;
      // Use texture sampling for cheap perturbation
      // We sample the high freq channel (Blue or Alpha) for bumps

      float scale = 1.5;
      float dX = texture(uNoiseTexture, (pos + vec3(eps, 0, 0)) * scale * 0.1).b - texture(uNoiseTexture, (pos - vec3(eps, 0, 0)) * scale * 0.1).b;
      float dY = texture(uNoiseTexture, (pos + vec3(0, eps, 0)) * scale * 0.1).b - texture(uNoiseTexture, (pos - vec3(0, eps, 0)) * scale * 0.1).b;
      float dZ = texture(uNoiseTexture, (pos + vec3(0, 0, eps)) * scale * 0.1).b - texture(uNoiseTexture, (pos - vec3(0, 0, eps)) * scale * 0.1).b;

      vec3 bump = vec3(dX, dY, dZ);
      return normalize(normal + bump * uDetailStrength * 2.0);
    }

    void main() {
      vec3 worldNormal = normalize(vWorldNormal);
      float slope = clamp(dot(worldNormal, vec3(0.0, 1.0, 0.0)), -1.0, 1.0);
      float m = vMaterial;
      float height = vHeight;

      // Macro variation
      float macroNoise = getNoise(vPosition, 0.05) * uMacroVariation; // Low freq

      vec3 c_stone = triSampleColor(vPosition, worldNormal, uColorStone, 0.12);
      vec3 c_grass = triSampleColor(vPosition, worldNormal, uColorGrass, 0.1);

      // Modulate grass
      c_grass = mix(c_grass, c_grass * 0.8 + vec3(0.1, 0.1, 0.0), macroNoise * 0.5);

      vec3 c_dirt = triSampleColor(vPosition, worldNormal, uColorDirt, 0.18);
      vec3 c_sand = triSampleColor(vPosition, worldNormal, uColorSand, 0.2);

      vec3 baseColor = c_stone;
      float specular = 0.08;

      float snowLine = smoothstep(18.0, 28.0, height);
      float beach = smoothstep(uWaterLevel - 1.5, uWaterLevel + 2.0, height);
      float dirtBand = smoothstep(0.2, 0.65, slope);

      if (m < 2.0) {
         baseColor = mix(uColorBedrock, c_stone, clamp(m, 0.0, 1.0));
      } else if (m < 3.0) {
         baseColor = mix(c_stone, c_dirt, clamp(m - 2.0, 0.0, 1.0));
         specular = 0.04;
      } else if (m < 4.0) {
         baseColor = mix(c_dirt, c_grass, clamp(m - 3.0, 0.0, 1.0));
         specular = 0.03;
      } else if (m < 5.0) {
         baseColor = mix(c_grass, c_sand, clamp(m - 4.0, 0.0, 1.0));
      } else {
         baseColor = mix(c_sand, uColorSnow, clamp(m - 5.0, 0.0, 1.0));
         specular = 0.35;
      }

      float rockThreshold = 1.0 - smoothstep(0.55, 0.8, slope);
      baseColor = mix(baseColor, c_stone, rockThreshold);
      baseColor = mix(baseColor, mix(baseColor, uColorSnow, 0.65), snowLine);
      baseColor = mix(baseColor, mix(baseColor, c_sand, 0.7), beach * (1.0 - snowLine));
      baseColor = mix(baseColor, c_dirt, dirtBand * 0.35);

      float ao = clamp(1.0 - (1.0 - slope) * uAOIntensity - macroNoise * 0.25, 0.55, 1.0);

      vec3 normal = calcDetailNormal(vPosition, worldNormal);
      vec3 lightDir = normalize(uSunDir);
      vec3 viewDir = normalize(cameraPosition - vPosition);

      float NdotL = max(dot(normal, lightDir), 0.0);
      vec3 diffuse = uSunColor * NdotL;

      vec3 halfVec = normalize(lightDir + viewDir);
      float NdotH = max(dot(normal, halfVec), 0.0);
      float spec = pow(NdotH, 48.0) * specular;

      float rim = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.0) * 0.15;

      vec3 ambient = uAmbientColor * (0.55 + 0.45 * ao);
      vec3 lit = baseColor * (ambient + diffuse) + spec * uSunColor + rim * baseColor;

      float distFog = 1.0 - exp2(-uFogDensity * uFogDensity * vDepth * vDepth * 1.2);
      float heightFog = clamp(exp(-max(height - uWaterLevel, 0.0) * uFogHeightFalloff), 0.0, 1.0);
      float fogFactor = clamp(distFog * (0.35 + 0.65 * heightFog), 0.0, 1.0);

      vec3 fogColor = mix(uFogColorNear, uFogColorFar, clamp((height + 20.0) / 80.0, 0.0, 1.0));
      vec3 finalColor = mix(lit, fogColor, fogFactor);

      fragColor = vec4(finalColor, uOpacity);
      fragColor.rgb = pow(fragColor.rgb, vec3(1.0 / 2.2));
    }
  `
);

extend({ TerrainShaderMaterial });

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3, opacity?: number }> = ({ sunDirection, opacity = 1 }) => {
  const ref = useRef<any>(null);

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
