import * as THREE from 'three';
import React, { useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '@core/memory/sharedResources';
import { getPaletteTexture } from '@core/graphics/paletteTexture';

const vertexShader = `
  attribute vec4 aMaterialIndices;
  attribute vec4 aMaterialWeights;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;

  varying vec4 vMatIndices;
  varying vec4 vMatWeights;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vMatIndices = aMaterialIndices;
    vMatWeights = aMaterialWeights;
    vWetness = aVoxelWetness;
    vMossiness = aVoxelMossiness;
    
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    
    csm_Position = position;
    csm_Normal = normal;
  }
`;

const fragmentShader = `
  precision highp float;
  precision highp sampler2DArray;
  precision highp sampler3D;

  uniform sampler3D uNoiseTexture;
  uniform sampler2DArray uMaterialPalette;

  uniform vec3 uColorMoss;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uOpacity;

  varying vec4 vMatIndices;
  varying vec4 vMatWeights;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  // Safe Normalize
  vec3 safeNormalize(vec3 v) {
      float len = length(v);
      if (len < 0.0001) return vec3(0.0, 1.0, 0.0);
      return v / len;
  }

  // Sharp Triplanar Sampler
  vec4 getTriplanarNoise(vec3 normal, float scale) {
      vec3 blend = abs(normal);
      blend = normalize(max(blend, 0.00001));
      blend = pow(blend, vec3(8.0));
      blend /= dot(blend, vec3(1.0));

      vec3 p = vWorldPosition * scale;
      
      vec4 xN = texture(uNoiseTexture, p.zyx);
      vec4 yN = texture(uNoiseTexture, p.xzy + vec3(100.0));
      vec4 zN = texture(uNoiseTexture, p.xyz + vec3(200.0));

      return xN * blend.x + yN * blend.y + zN * blend.z;
  }

  void main() {
    vec3 N = safeNormalize(vWorldNormal);
    vec4 nMid = getTriplanarNoise(N, 0.15);
    vec4 nHigh = getTriplanarNoise(N, 0.6);

    vec3 accColor = vec3(0.0);
    float accRoughness = 0.0;
    float accNoise = 0.0;
    float totalW = 0.0;

    // Unrolled loop for top 4 materials
    for(int i = 0; i < 4; i++) {
        float weight = vMatWeights[i];
        if (weight > 0.001) {
            float id = vMatIndices[i];

            // Look up base color from palette (u=0.5, v=0.5, layer=id)
            // Palette is 1x1 pixels, so UV doesn't matter much but center is safe
            vec4 baseCol4 = texture(uMaterialPalette, vec3(0.5, 0.5, id));
            vec3 baseCol = baseCol4.rgb;

            float roughness = 0.8;
            float noiseFactor = 0.0;

            // Simplified Material Parameter Logic (Branchless-ish)
            // We can bake these into the palette alpha or a secondary texture later.
            // For now, we use ID checks but they are much fewer than before.

            // Logic derived from old getMatParams:
            // Bedrock(1): noise=nMid.r
            // Stone(2): noise=mix(nMid.r, nHigh.g, 0.5)
            // Dirt(3): noise=nMid.g
            // Grass(4): noise=mix(nHigh.a, nMid.r, 0.3)
            // Sand(5), RedSand(10), Jungle(13): noise=nHigh.a
            // Snow(6): noise=nMid.r * 0.5 + 0.5
            // Clay(7), Terracotta(11): noise=nMid.g
            // Water(8), Ice(12): roughness=0.1
            // Moss(9): noise=nMid.r
            // Glow(14): noise=nMid.r + 0.5
            // Obsidian(15): noise=nHigh.b, roughness=0.2

            int iID = int(id + 0.5); // Round to nearest int

            if (iID == 1) noiseFactor = nMid.r;
            else if (iID == 2) noiseFactor = mix(nMid.r, nHigh.g, 0.5);
            else if (iID == 3) noiseFactor = nMid.g;
            else if (iID == 4) {
                noiseFactor = mix(nHigh.a, nMid.r, 0.3);
                baseCol *= vec3(1.0, 1.1, 1.0); // Keep the tint
            }
            else if (iID == 5 || iID == 10 || iID == 13) noiseFactor = nHigh.a;
            else if (iID == 6) noiseFactor = nMid.r * 0.5 + 0.5;
            else if (iID == 7 || iID == 11) {
                noiseFactor = nMid.g;
                if (iID == 11) roughness = 0.9;
            }
            else if (iID == 8) roughness = 0.1;
            else if (iID == 9) noiseFactor = nMid.r;
            else if (iID == 12) {
                noiseFactor = nMid.b * 0.5;
                roughness = 0.1;
            }
            else if (iID == 14) noiseFactor = nMid.r + 0.5;
            else if (iID == 15) {
                noiseFactor = nHigh.b;
                roughness = 0.2;
            }

            accColor += baseCol * weight;
            accRoughness += roughness * weight;
            accNoise += noiseFactor * weight;
            totalW += weight;
        }
    }

    if (totalW > 0.0001) {
      accColor /= totalW;
      accRoughness /= totalW;
      accNoise /= totalW;
    } else {
      // Fallback Stone
      accColor = texture(uMaterialPalette, vec3(0.5, 0.5, 2.0)).rgb;
      accRoughness = 0.8;
      accNoise = 0.0;
    }

    float intensity = 0.6 + 0.6 * accNoise;
    vec3 col = accColor * intensity;

    // --- Overlays ---
    if (vMossiness > 0.1) {
        vec3 mossColor = uColorMoss;
        float mossNoise = nHigh.g;
        mossColor *= (0.8 + 0.4 * mossNoise);
        float mossMix = smoothstep(0.3, 0.6, vMossiness + mossNoise * 0.2);
        col = mix(col, mossColor, mossMix);
    }

    col = mix(col, col * 0.5, vWetness * 0.9);
    col = clamp(col, 0.0, 5.0);

    float fogDist = length(vWorldPosition - cameraPosition);
    float fogAmt = clamp((fogDist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
    fogAmt = pow(fogAmt, 1.1);
    col = mix(col, uFogColor, fogAmt * 0.9);

    csm_DiffuseColor = vec4(col, uOpacity);

    accRoughness -= (nHigh.r * 0.1);
    accRoughness = mix(accRoughness, 0.2, vWetness);
    
    csm_Roughness = accRoughness;
    csm_Metalness = 0.0;
  }
`;

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3; opacity?: number }> = ({ opacity = 1 }) => {
  const materialRef = useRef<any>(null);
  const { scene } = useThree();
  const paletteTexture = useMemo(() => getPaletteTexture(), []);

  useFrame(() => {
    if (materialRef.current) {
      const mat = materialRef.current;
      mat.uniforms.uNoiseTexture.value = noiseTexture;
      mat.uniforms.uMaterialPalette.value = paletteTexture;
      mat.uniforms.uOpacity.value = opacity;
      const isTransparent = opacity < 0.999;
      mat.transparent = isTransparent;
      mat.depthWrite = !isTransparent;

      const fog = scene.fog as THREE.Fog | undefined;
      if (fog) {
        mat.uniforms.uFogColor.value.copy(fog.color);
        mat.uniforms.uFogNear.value = fog.near;
        mat.uniforms.uFogFar.value = fog.far;
      } else {
        mat.uniforms.uFogColor.value.set('#87CEEB');
        mat.uniforms.uFogNear.value = 1e6;
        mat.uniforms.uFogFar.value = 1e6 + 1.0;
      }
    }
  });

  const uniforms = useMemo(() => ({
    uNoiseTexture: { value: noiseTexture },
    uMaterialPalette: { value: paletteTexture },
    uColorMoss: { value: new THREE.Color('#5c8a3c') },
    uFogColor: { value: new THREE.Color('#87CEEB') },
    uFogNear: { value: 30 },
    uFogFar: { value: 400 },
    uOpacity: { value: 1 },
  }), [paletteTexture]);

  return (
    <CustomShaderMaterial
      ref={materialRef}
      baseMaterial={THREE.MeshStandardMaterial}
      roughness={0.9}
      metalness={0.0}
      depthWrite
      depthTest
      side={THREE.FrontSide}
      vertexShader={vertexShader}
      fragmentShader={fragmentShader}
      uniforms={uniforms}
    />
  );
};
