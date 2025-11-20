
import * as THREE from 'three';
import React, { useRef } from 'react';
import { extend, useFrame } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';

const TerrainShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    uColorBedrock: new THREE.Color('#2a2a2a'),
    uColorStone: new THREE.Color('#7a8288'), 
    uColorDirt: new THREE.Color('#5d4037'),  
    uColorGrass: new THREE.Color('#44a022'), // slightly darker/richer grass
    uColorSand: new THREE.Color('#e6dcab'),
    uColorSnow: new THREE.Color('#ffffff'),
  },
  `
    attribute float aMaterial;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vWorldNormal;
    varying float vMaterial;
    varying float vDepth;
    
    void main() {
      vNormal = normalize(normalMatrix * normal);
      // Fix: Ensure world normal is correctly transformed
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      vMaterial = aMaterial;
      
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  `
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uColorGrass;
    uniform vec3 uColorStone;
    uniform vec3 uColorDirt;
    uniform vec3 uColorSand;
    uniform vec3 uColorSnow;
    uniform vec3 uColorBedrock;
    
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vWorldNormal;
    varying float vMaterial;
    varying float vDepth;

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
        for (int i = 0; i < 3; i++) {
            f += w * snoise(p);
            p *= 2.0; 
            w *= 0.5;
        }
        return f;
    }

    float triplanarNoise(vec3 pos, vec3 normal, float scale) {
        vec3 blend = max(abs(normal) - 0.4, 0.0);
        blend /= dot(blend, vec3(1.0));
        
        float x = fbm(pos.yz * scale);
        float y = fbm(pos.zx * scale);
        float z = fbm(pos.xy * scale);
        
        return x * blend.x + y * blend.y + z * blend.z;
    }

    void main() {
      // Slope calculation: 1.0 = Flat UP, 0.0 = Vertical Wall, -1.0 = Ceiling
      float slope = dot(vWorldNormal, vec3(0.0, 1.0, 0.0));
      
      float m = vMaterial;
      
      // Scale noise to avoid artifacts
      float macroNoise = triplanarNoise(vPosition, vWorldNormal, 0.06);
      float microNoise = triplanarNoise(vPosition, vWorldNormal, 0.6);

      vec3 c_stone = uColorStone * (0.85 + 0.3 * microNoise);
      vec3 c_grass = uColorGrass * (0.85 + 0.3 * microNoise);
      // Add some color variation to grass
      c_grass = mix(c_grass, c_grass * 0.8 + vec3(0.05, 0.05, 0.0), macroNoise * 0.5 + 0.5);
      
      vec3 c_dirt = uColorDirt * (0.9 + 0.2 * microNoise);
      vec3 c_sand = uColorSand * (0.95 + 0.1 * microNoise);
      
      vec3 baseColor = c_stone;
      float specular = 0.1;

      // Material Blending Logic
      if (m < 2.0) {
         baseColor = mix(uColorBedrock, c_stone, clamp(m - 1.0, 0.0, 1.0));
      } else if (m < 3.0) {
         baseColor = mix(c_stone, c_dirt, clamp(m - 2.0, 0.0, 1.0));
         specular = 0.05;
      } else if (m < 4.0) {
         baseColor = mix(c_dirt, c_grass, clamp(m - 3.0, 0.0, 1.0));
         specular = 0.02;
      } else if (m < 5.0) {
         baseColor = mix(c_grass, c_sand, clamp(m - 4.0, 0.0, 1.0));
      } else {
         baseColor = mix(c_sand, uColorSnow, clamp(m - 5.0, 0.0, 1.0));
         specular = 0.4;
      }

      // Automatic Cliff Texturing
      // If surface is steep (slope < 0.65), blend in Stone.
      // But allow Bedrock (1) and Snow (6) to persist.
      if (m > 2.5 && m < 5.5) {
         float rockThreshold = 0.65 + microNoise * 0.1;
         // Using smoothstep for a softer blend transition
         float isWall = 1.0 - smoothstep(rockThreshold - 0.15, rockThreshold, slope);
         baseColor = mix(baseColor, c_stone, isWall);
      }

      // Simple lighting
      vec3 normal = normalize(vNormal + triplanarNoise(vPosition, vWorldNormal, 4.0) * 0.05);
      vec3 lightDir = uSunDir;
      
      float NdotL = max(dot(normal, lightDir), 0.0);
      // Ambient + Direct
      vec3 ambient = vec3(0.4, 0.45, 0.55) * 0.6;
      vec3 direct = vec3(1.0, 0.95, 0.85) * NdotL;
      
      vec3 halfVec = normalize(lightDir + normalize(cameraPosition - vPosition));
      float NdotH = max(dot(normal, halfVec), 0.0);
      float spec = pow(NdotH, 32.0) * specular;
      
      vec3 final = baseColor * (ambient + direct) + spec;

      // Fog
      vec3 fogColor = vec3(0.7, 0.85, 1.0);
      float fogFactor = 1.0 - exp2(-0.015 * 0.015 * vDepth * vDepth * 1.44);
      fogFactor = clamp(fogFactor, 0.0, 1.0);

      gl_FragColor = vec4(mix(final, fogColor, fogFactor), 1.0);
      // Tone mapping approximation
      gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(1.0/2.2));
    }
  `
);

extend({ TerrainShaderMaterial });

export const TriplanarMaterial = () => {
  const ref = useRef<any>(null);

  useFrame(({ clock }) => {
    if(ref.current) {
        ref.current.uTime = clock.getElapsedTime();
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
