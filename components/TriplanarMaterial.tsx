import * as THREE from 'three';
import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import { noiseTexture } from '../utils/sharedResources';

let loggedRendererInfo = false;

// 1. Vertex Shader
// We must declare attributes exactly as Three.js expects them if we override.
// CSM handles position/normal, we handle the custom data.
const vertexShader = `
  attribute float aVoxelMat;
  attribute float aVoxelWetness;
  attribute float aVoxelMossiness;

  flat varying float vMaterial;
  varying float vWetness;
  varying float vMossiness;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;

  void main() {
    vMaterial = aVoxelMat;
    vWetness = aVoxelWetness;
    vMossiness = aVoxelMossiness;
    
    // Calculate world position manually for noise lookup
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;

    // Standard normal matrix calc
    vWorldNormal = normalize(mat3(modelMatrix) * normal);

    // CSM specific output.
    // CRITICAL: Do not transform 'position' here, CSM does that later.
    // We just pass the local position through.
    csm_Position = position;
  }
`;

  // 2. Fragment Shader
  const fragmentShader = `
    uniform sampler3D uNoiseTexture;
    uniform vec3 uColorStone;
    uniform vec3 uColorGrass;
    uniform vec3 uColorDirt;
    uniform vec3 uColorSand;
    uniform vec3 uColorSnow;
    uniform vec3 uColorWater;

    flat varying float vMaterial;
    varying float vWetness;
    varying float vMossiness;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;

    // Helper to get noise at a specific scale
    vec4 getNoise(float scale) {
        return texture(uNoiseTexture, vWorldPosition * scale);
    }

    void main() {
      // Re-normalize interpolated normals
      vec3 N = normalize(vWorldNormal);

      // 1. Material ID Snapping
      float m = floor(vMaterial + 0.5);

      // Base Colors
      vec3 baseCol = uColorStone;
      if (m < 2.0) baseCol = uColorStone;       // 1: Stone
      else if (m < 3.0) baseCol = uColorStone;  // 2: Stone
      else if (m < 4.0) baseCol = uColorDirt;   // 3: Dirt
      else if (m < 5.0) baseCol = uColorGrass;  // 4: Grass
      else if (m < 6.0) baseCol = uColorSand;   // 5: Sand
      else if (m < 7.0) baseCol = uColorSnow;   // 6: Snow
      else if (m < 8.0) baseCol = uColorDirt;   // 7: Dirt
      else baseCol = uColorWater;               // 8+: Water

      // 2. Advanced Noise Sampling
      // Sample at a medium scale for general texture
      vec4 nMid = getNoise(0.15);   // Repetitions every ~7 blocks
      // Sample at high scale for fine grain
      vec4 nHigh = getNoise(0.6);   // Repetitions every ~1.6 blocks

      float noiseFactor = 0.0;

      // 3. Per-Material Texture Logic
      if (m >= 4.0 && m < 5.0) {
        // GRASS: Needs fine grain (A) and some variation (R)
        // Use high freq grain for "blades" effect
        float bladeNoise = nHigh.a; 
        float patchNoise = nMid.r;
        noiseFactor = mix(bladeNoise, patchNoise, 0.3); 
        // Make grass slightly vibrant
        baseCol *= vec3(1.0, 1.1, 1.0); 
      } 
      else if (m >= 1.0 && m < 3.0) {
        // STONE: Craggy look. Use R (structure) and B (cracks)
        float structure = nMid.r;
        float cracks = nHigh.g;
        noiseFactor = mix(structure, cracks, 0.5);
      }
      else if (m >= 5.0 && m < 6.0) {
        // SAND: Very fine grain (A channel of high freq)
        noiseFactor = nHigh.a;
      }
      else if (m >= 3.0 && m < 4.0 || (m >= 7.0 && m < 8.0)) {
        // DIRT: Clumpy. Low freq structure.
        noiseFactor = nMid.g;
      }
      else if (m >= 6.0 && m < 7.0) {
        // SNOW: Smooth but with soft drifts
        noiseFactor = nMid.r * 0.5 + 0.5;
      }
      else {
        // DEFAULT
        noiseFactor = nMid.r;
      }

      // Apply Noise to Color (Modulate intensity)
      // Map noise 0..1 to 0.6..1.2 range for contrast
      float intensity = 0.6 + 0.6 * noiseFactor;
      vec3 col = baseCol * intensity;

      // 4. Mossiness (Green overlay on top surfaces)
      if (vMossiness > 0.1) {
          vec3 mossColor = vec3(0.2, 0.5, 0.1);
          // Add noise to moss too
          float mossNoise = nHigh.g; 
          mossColor *= (0.8 + 0.4 * mossNoise);
          col = mix(col, mossColor, vMossiness * 0.9);
      }

      // 5. Wetness (Darken and smooth)
      col = mix(col, col * 0.5, vWetness);

      // Safety: NaN Check
      if (!(col.r >= 0.0)) col.r = 0.0;
      if (!(col.g >= 0.0)) col.g = 0.0;
      if (!(col.b >= 0.0)) col.b = 0.0;

      // Clamp for Post-Processing safety
      col = clamp(col, 0.0, 5.0);

      csm_DiffuseColor = vec4(col, 1.0);

      // Roughness/Metalness
      // Reduce default roughness so point lights are visible as highlights
      float roughness = 0.8; 
      
      // Add some variation to roughness based on noise
      roughness -= (nHigh.r * 0.2); // 0.6 to 0.8 range roughly

      // Wet things are shiny
      roughness = mix(roughness, 0.2, vWetness);
      
      // Water is very shiny
      if (m >= 8.0) roughness = 0.1;
      // Sand is matte
      if (m >= 5.0 && m < 6.0) roughness = 1.0;

      csm_Roughness = roughness;
      csm_Metalness = 0.0;
    }
  `;

export const TriplanarMaterial: React.FC<{ sunDirection?: THREE.Vector3 }> = () => {
  const materialRef = useRef<any>(null);
  const { gl } = useThree();
  const loggedRef = useRef(false);
  const programLoggedRef = useRef(false);

  useFrame(() => {
    if (materialRef.current) {
        materialRef.current.uniforms.uNoiseTexture.value = noiseTexture;
    }
  });

  useEffect(() => {
    if (loggedRef.current || loggedRendererInfo) return;
    const isWebGL2 = (gl as any).isWebGL2 || gl.capabilities?.isWebGL2;
    const max3D = (gl.capabilities as any)?.max3DTextureSize ?? (gl.capabilities as any)?.maxTextureSize;
    console.log('[TriplanarMaterial] Renderer info', {
      isWebGL2,
      supports3DTexture: Boolean((gl.capabilities as any)?.isWebGL2),
      max3DTextureSize: max3D,
      renderer: gl.getContext().constructor?.name
    });
    loggedRef.current = true;
    loggedRendererInfo = true;
  }, [gl]);

  const uniforms = useMemo(() => ({
    uNoiseTexture: { value: noiseTexture },
    uColorStone: { value: new THREE.Color('#888c8d') },
    uColorGrass: { value: new THREE.Color('#41a024') },
    uColorDirt: { value: new THREE.Color('#755339') },
    uColorSand: { value: new THREE.Color('#ebd89f') },
    uColorSnow: { value: new THREE.Color('#ffffff') },
    uColorWater: { value: new THREE.Color('#0099ff') },
  }), []);

  return (
    <CustomShaderMaterial
        ref={materialRef}
        baseMaterial={THREE.MeshStandardMaterial}
        roughness={0.9}
        metalness={0.0}
        // Explicit depth settings to ensure N8AO sees the mesh correctly
        depthWrite={true}
        depthTest={true}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        {...{
          onBeforeCompile: (shader: any) => {
            if (!programLoggedRef.current) {
              console.log('[TriplanarMaterial] onBeforeCompile', {
                vertexLength: shader.vertexShader?.length ?? 0,
                fragmentLength: shader.fragmentShader?.length ?? 0
              });
              programLoggedRef.current = true;
            }
          }
        } as any}
    />
  );
};
