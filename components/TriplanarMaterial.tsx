
import * as THREE from 'three';
import React, { useRef } from 'react';
import { extend, useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { WATER_LEVEL } from '../constants';

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
    uDetailStrength: 0.35,
    uMacroVariation: 0.35,
    uAOIntensity: 0.45,
    uWaterLevel: WATER_LEVEL
  },
  `
    attribute float aMaterial;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vWorldNormal;
    varying float vMaterial;
    varying float vDepth;
    varying float vHeight;
    
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
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uAmbientColor;

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
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vWorldNormal;
    varying float vMaterial;
    varying float vDepth;
    varying float vHeight;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
      const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
      vec2 i  = floor(v + dot(v, C.yy) );
      vec2 x0 = v - i + dot(i, C.xx);
      vec2 i1;
      i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec4 x12 = x0.xyxy + C.xxzz;
      x12.xy -= i1;
      i = mod289(i);
      vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));

      vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
      m = m*m ;
      m = m*m ;

      vec3 x = 2.0 * fract(p * C.www) - 1.0;
      vec3 h = abs(x) - 0.5;
      vec3 ox = floor(x + 0.5);
      vec3 a0 = x - ox;

      m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );

      vec3 g;
      g.x  = a0.x  * x0.x  + h.x  * x0.y;
      g.yz = a0.yz * x12.xz + h.yz * x12.yw;
      return 130.0 * dot(m, g);
    }

    float fbm(vec2 p) {
        float f = 0.0;
        float w = 0.5;
        for (int i = 0; i < 4; i++) {
            f += w * snoise(p);
            p *= 2.0;
            w *= 0.5;
        }
        return f;
    }

    float triplanarNoise(vec3 pos, vec3 normal, float scale) {
        vec3 blend = max(abs(normal) - 0.4, 0.0);
        blend /= (dot(blend, vec3(1.0)) + 0.00001);
        
        float x = fbm(pos.yz * scale);
        float y = fbm(pos.zx * scale);
        float z = fbm(pos.xy * scale);
        
        return x * blend.x + y * blend.y + z * blend.z;
    }

    vec3 triSampleColor(vec3 pos, vec3 normal, vec3 color, float scale) {
      float n = triplanarNoise(pos * scale, normal, 1.0);
      return color * (0.9 + 0.2 * n);
    }

    vec3 calcDetailNormal(vec3 pos, vec3 normal) {
      // Cheap gradient-based normal perturbation to give rock/grass micro detail.
      float eps = 0.15;
      float dX = triplanarNoise(pos + vec3(eps, 0.0, 0.0), normal, 2.5) - triplanarNoise(pos - vec3(eps, 0.0, 0.0), normal, 2.5);
      float dY = triplanarNoise(pos + vec3(0.0, eps, 0.0), normal, 2.5) - triplanarNoise(pos - vec3(0.0, eps, 0.0), normal, 2.5);
      float dZ = triplanarNoise(pos + vec3(0.0, 0.0, eps), normal, 2.5) - triplanarNoise(pos - vec3(0.0, 0.0, eps), normal, 2.5);
      vec3 bumped = normalize(vNormal + vec3(dX, dY, dZ) * uDetailStrength);
      return bumped;
    }

    void main() {
      vec3 worldNormal = normalize(vWorldNormal);
      float slope = clamp(dot(worldNormal, vec3(0.0, 1.0, 0.0)), -1.0, 1.0);
      float m = vMaterial;
      float height = vHeight;

      // Multi-scale noise for subtle color variation and macro breakup
      float macroNoise = triplanarNoise(vPosition, worldNormal, 0.04) * uMacroVariation;
      float microNoise = triplanarNoise(vPosition, worldNormal, 0.7);

      vec3 c_stone = triSampleColor(vPosition, worldNormal, uColorStone, 0.12);
      vec3 c_grass = triSampleColor(vPosition, worldNormal, uColorGrass, 0.1);
      c_grass = mix(c_grass, c_grass * 0.82 + vec3(0.06, 0.08, 0.02), macroNoise * 0.5 + 0.5);
      vec3 c_dirt = triSampleColor(vPosition, worldNormal, uColorDirt, 0.18);
      vec3 c_sand = triSampleColor(vPosition, worldNormal, uColorSand, 0.2);

      vec3 baseColor = c_stone;
      float specular = 0.08;

      // Height-based ramps keep transitions controllable even when material IDs are noisy.
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

      // Cliff/steep surfaces use more stone and damp grass saturation.
      float rockThreshold = 1.0 - smoothstep(0.55, 0.8, slope);
      baseColor = mix(baseColor, c_stone, rockThreshold);

      // Height-aware tweaks: snow cap and damp beach near water.
      baseColor = mix(baseColor, mix(baseColor, uColorSnow, 0.65), snowLine);
      baseColor = mix(baseColor, mix(baseColor, c_sand, 0.7), beach * (1.0 - snowLine));

      // Add subtle dirt influence on shallow slopes.
      baseColor = mix(baseColor, c_dirt, dirtBand * 0.35);

      // Small darkening in cavities to fake ambient occlusion.
      float ao = clamp(1.0 - (1.0 - slope) * uAOIntensity - macroNoise * 0.25, 0.55, 1.0);

      vec3 normal = calcDetailNormal(vPosition, worldNormal);
      vec3 lightDir = normalize(uSunDir);
      vec3 viewDir = normalize(cameraPosition - vPosition);

      float NdotL = max(dot(normal, lightDir), 0.0);
      vec3 diffuse = uSunColor * NdotL;

      vec3 halfVec = normalize(lightDir + viewDir);
      float NdotH = max(dot(normal, halfVec), 0.0);
      float spec = pow(NdotH, 48.0) * specular;

      // Wrap a soft rim to outline silhouettes a bit more on foliage/grass.
      float rim = pow(1.0 - max(dot(viewDir, normal), 0.0), 2.0) * 0.15;

      vec3 ambient = uAmbientColor * (0.55 + 0.45 * ao);
      vec3 lit = baseColor * (ambient + diffuse) + spec * uSunColor + rim * baseColor;

      // Exponential distance fog with slight height bias toward low valleys.
      float distFog = 1.0 - exp2(-uFogDensity * uFogDensity * vDepth * vDepth * 1.2);
      float heightFog = clamp(exp(-max(height - uWaterLevel, 0.0) * uFogHeightFalloff), 0.0, 1.0);
      float fogFactor = clamp(distFog * (0.35 + 0.65 * heightFog), 0.0, 1.0);

      vec3 fogColor = mix(uFogColorNear, uFogColorFar, clamp((height + 20.0) / 80.0, 0.0, 1.0));
      vec3 finalColor = mix(lit, fogColor, fogFactor);

      gl_FragColor = vec4(finalColor, 1.0);
      gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0 / 2.2));
    }
  `
);

extend({ TerrainShaderMaterial });

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3 }> = ({ sunDirection }) => {
  const ref = useRef<any>(null);

  useFrame(({ clock }) => {
    if(ref.current) {
        ref.current.uTime = clock.getElapsedTime();
        if (sunDirection) {
          ref.current.uSunDir = sunDirection;
        }
    }
  });

  return (
    // @ts-ignore
    <terrainShaderMaterial 
      ref={ref}
      side={THREE.DoubleSide} 
    />
  );
};
