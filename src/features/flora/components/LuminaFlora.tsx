import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { RigidBody } from '@react-three/rapier';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

import { ItemType } from '@/types';
import { getItemMetadata } from '../../interaction/logic/ItemRegistry';

interface LuminaFloraProps {
  id: string;
  position: [number, number, number];
  onPickup?: () => void;
  seed?: number; // To vary the phase
  bodyRef?: React.RefObject<any>;
}

// Cached material for performance
let luminaMaterial: THREE.Material | null = null;

const getLuminaMaterial = () => {
  if (luminaMaterial) return luminaMaterial;

  luminaMaterial = new (CustomShaderMaterial as any)({
    baseMaterial: THREE.MeshStandardMaterial,
    vertexShader: `
      uniform float uTime;
      attribute float aSeed; // per-flora seed (a shared uniform was last-writer-wins)
      varying vec3 vPos;
      varying vec3 vWorldNormal;
      varying float vPulse;
      varying float vSeed;

      void main() {
        float uSeed = aSeed;
        vSeed = aSeed;
        vPos = position;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);

        // Breathing pulse
        float pulse = sin(uTime * 2.0 + uSeed) * 0.35 + 1.15;
        vPulse = pulse;

        // Subtle vertex displacement for organic feel
        float breathe = sin(uTime * 1.5 + uSeed + position.y * 3.0) * 0.02;
        vec3 pos = position;
        pos += normal * breathe * pulse;

        csm_Position = pos;
      }
    `,
    fragmentShader: `
      precision highp sampler3D;
      uniform float uTime;
      uniform vec3 uColor;
      uniform sampler3D uNoiseTexture;
      varying vec3 vPos;
      varying vec3 vWorldNormal;
      varying float vPulse;
      varying float vSeed;

      void main() {
        float uSeed = vSeed;
        // Multi-scale noise for organic detail
        vec3 noiseCoord = vPos * 3.0 + vec3(uSeed * 0.1);
        float nBase = texture(uNoiseTexture, noiseCoord * 0.3).r;
        float nFine = texture(uNoiseTexture, noiseCoord * 0.8).g;
        float nMicro = texture(uNoiseTexture, noiseCoord * 2.0).b;

        // Cell structure pattern
        float cells = smoothstep(0.4, 0.6, nFine);
        float membranes = smoothstep(0.55, 0.6, nMicro);

        // Internal glow veins - pulsing with time
        float veinPhase = sin(uTime * 3.0 + vPos.y * 8.0 + uSeed) * 0.5 + 0.5;
        float veins = smoothstep(0.6, 0.75, nBase + veinPhase * 0.2);

        // Base dark color with subtle variation
        vec3 baseColor = vec3(0.08, 0.1, 0.12);
        baseColor *= 0.8 + nFine * 0.4;

        // Color variation in the glow
        vec3 glowColor = uColor;
        glowColor.r *= 0.9 + nMicro * 0.2;
        glowColor.g *= 1.0 + (nFine - 0.5) * 0.1;
        glowColor.b *= 1.0 + nBase * 0.15;

        // Subsurface scattering simulation
        float fresnel = 1.0 - abs(dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0)));
        fresnel = pow(fresnel, 2.0);
        float subsurface = fresnel * 0.3 + 0.1;

        // Apply membrane darkening
        baseColor *= 1.0 - membranes * 0.3;

        // Add internal glow through the membrane
        vec3 internalGlow = glowColor * (cells * 0.4 + veins * 0.6);
        baseColor += internalGlow * subsurface;

        csm_DiffuseColor = vec4(baseColor, 1.0);

        // Emissive with vein modulation and pulse
        float glowIntensity = 1.35 * vPulse;
        glowIntensity *= 0.7 + veins * 0.4 + cells * 0.2;
        glowIntensity *= 1.0 + fresnel * 0.3;
        csm_Emissive = glowColor * glowIntensity;

        // Variable roughness - cells are shinier
        float rough = 0.5 - cells * 0.15 + membranes * 0.1;
        csm_Roughness = clamp(rough, 0.25, 0.6);
      }
    `,
    uniforms: {
      uTime: sharedUniforms.uTime, // advanced once per frame by VoxelTerrain
      uColor: { value: new THREE.Color(getItemMetadata(ItemType.FLORA)?.color || '#00FFFF') },
      uNoiseTexture: { value: getNoiseTexture() },
    },
    roughness: 0.4,
    metalness: 0.0,
    toneMapped: false,
  });

  return luminaMaterial;
};

export const LuminaFlora: React.FC<LuminaFloraProps> = ({ id, position, seed = 0, bodyRef }) => {
  const internalRef = useRef<any>(null);
  const refToUse = bodyRef || internalRef;
  const material = useMemo(() => getLuminaMaterial(), []);

  // Per-flora geometry carrying its seed as a vertex attribute, so every flora
  // keeps its own pulse phase and pattern while sharing one material.
  const geometries = useMemo(() => {
    const withSeed = (g: THREE.BufferGeometry) => {
      g.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(seed), 1));
      return g;
    };
    return {
      main: withSeed(new THREE.SphereGeometry(0.25, 24, 24)),
      bulbA: withSeed(new THREE.SphereGeometry(0.15, 16, 16)),
      bulbB: withSeed(new THREE.SphereGeometry(0.12, 16, 16)),
    };
  }, [seed]);
  useEffect(() => () => {
    geometries.main.dispose();
    geometries.bulbA.dispose();
    geometries.bulbB.dispose();
  }, [geometries]);

  return (
    <RigidBody
      ref={refToUse}
      type="dynamic"
      colliders="ball"
      position={position}
      restitution={0.2}
      friction={0.8}
      userData={{ type: ItemType.FLORA, id }}
    >
      <group>
        {/* Main Bulb - Bioluminescent with detailed shader */}
        <mesh castShadow receiveShadow geometry={geometries.main}>
          <primitive object={material} attach="material" />
        </mesh>

        {/* Secondary bulbs - share the same material for consistency */}
        <mesh position={[0.15, -0.1, 0.1]} castShadow receiveShadow geometry={geometries.bulbA}>
          <primitive object={material} attach="material" />
        </mesh>
        <mesh position={[-0.15, -0.15, -0.05]} castShadow receiveShadow geometry={geometries.bulbB}>
          <primitive object={material} attach="material" />
        </mesh>
      </group>
    </RigidBody>
  );
};
