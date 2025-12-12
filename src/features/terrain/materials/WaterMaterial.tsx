
import * as THREE from 'three';
import React, { useRef } from 'react';
import { extend, useFrame, useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { noiseTexture } from '@core/memory/sharedResources';
import { CHUNK_SIZE_XZ } from '@/constants';

// Fallback 1x1 shoreline mask so water can't disappear if a chunk has no computed mask.
// This keeps edgeAlpha at 1.0 (fully visible) instead of discarding everything.
const FALLBACK_SHORE_MASK = (() => {
  const data = new Uint8Array([255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
})();

const WaterMeshShader = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    // Base water colors (tuned to avoid "milky white" surface washout).
    uColorShallow: new THREE.Color('#3ea7d6'),
    uColorDeep: new THREE.Color('#0b3e63'),
    uNoiseTexture: noiseTexture,
    uShoreMask: FALLBACK_SHORE_MASK,
    uShoreEdge: 0.06,
    uAlphaBase: 0.58,
    uFresnelAlpha: 0.22,
    // Static texture detail (not time-dependent) to break up flatness.
    uTexScale: 0.06,
    uTexStrength: 0.12,
    // Subtle foam/brightening near shore.
    uFoamStrength: 0.22,
    uChunkSize: CHUNK_SIZE_XZ,
    uCamPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#87CEEB'),
    uFogNear: 30,
    uFogFar: 300,
    uFade: 1
  },
  // Vertex
  `
    precision highp float;

    uniform float uTime;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewPos;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;

      vec4 mvPosition = viewMatrix * worldPos;
      vViewPos = -mvPosition.xyz;

      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  // Fragment
  `
    precision highp float;
    precision highp sampler3D;
    precision highp sampler2D;

    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uColorShallow;
    uniform vec3 uColorDeep;
    uniform sampler3D uNoiseTexture;
    uniform sampler2D uShoreMask;
    uniform float uShoreEdge;
    uniform float uAlphaBase;
    uniform float uFresnelAlpha;
    uniform float uTexScale;
    uniform float uTexStrength;
    uniform float uFoamStrength;
    uniform float uChunkSize;
    uniform vec3 uCamPos;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uFade;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewPos;

    vec3 getNormal(vec3 pos, vec3 baseNormal, float time) {
        float scale = 0.1;
        float speed = 0.5;

        vec3 p1 = pos * scale + vec3(time * speed * 0.1, time * speed * 0.05, time * 0.02);
        vec3 p2 = pos * scale - vec3(time * speed * 0.08, 0.0, time * speed * 0.06);

        float n1 = texture(uNoiseTexture, p1 * 0.2).r;
        float n2 = texture(uNoiseTexture, p2 * 0.2).g;

        // Perturb
        vec3 n = normalize(baseNormal + vec3(n1-0.5, n2-0.5, (n1+n2)*0.1) * 0.5);
        return n;
    }

    void main() {
        // Shoreline mask: use world-position modulo chunk size to get stable 0..1 UV per chunk.
        // This avoids blocky geometry edges by fading/discarding pixels near the land boundary.
        vec2 uv = fract(vWorldPos.xz / max(uChunkSize, 0.0001));
        float mask = texture2D(uShoreMask, uv).r;
        float edgeAlpha = smoothstep(0.5 - uShoreEdge, 0.5 + uShoreEdge, mask);
        if (edgeAlpha < 0.01) discard;

        vec3 viewDir = normalize(uCamPos - vWorldPos);
        vec3 normal = getNormal(vWorldPos, vNormal, uTime);

        // Specular
        vec3 lightDir = normalize(uSunDir);
        vec3 halfVec = normalize(lightDir + viewDir);
        float NdotH = max(dot(normal, halfVec), 0.0);
        float specular = pow(NdotH, 100.0) * 1.0;

        // Fresnel
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

        // Static water "texture" (non-animated): subtle color variation using the shared noise volume.
        // This keeps water from looking like a flat plastic sheet even when waves are subtle.
        vec3 texP = vec3(vWorldPos.xz * uTexScale, 0.25);
        vec3 nTex = texture(uNoiseTexture, texP).rgb;
        float texVal = (nTex.r + nTex.g) * 0.5; // 0..1
        float texSigned = (texVal - 0.5) * 2.0; // -1..1

        vec3 albedo = mix(uColorDeep, uColorShallow, fresnel * 0.5 + 0.25);
        albedo *= 1.0 + texSigned * uTexStrength;

        // Foam/brightening near shore: strongest near the boundary (mask ~ 0.5) on the water side.
        float shoreT = clamp((mask - 0.5) / max(uShoreEdge * 2.0, 0.0001), 0.0, 1.0);
        float foam = (1.0 - smoothstep(0.0, 1.0, shoreT));
        foam *= (0.6 + 0.4 * nTex.b);

        vec3 shaded = albedo + vec3(specular);
        shaded = mix(shaded, vec3(1.0), foam * uFoamStrength);
        shaded = mix(uFogColor, shaded, uFade);

        float distanceToCam = distance(uCamPos, vWorldPos);
        float fogFactor = clamp((distanceToCam - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
        fogFactor = pow(fogFactor, 1.25);

        vec3 finalColor = mix(shaded, uFogColor, fogFactor * 0.6);
        float alpha = (uAlphaBase + fresnel * uFresnelAlpha) * uFade * edgeAlpha;
        alpha = clamp(alpha + foam * 0.10, 0.0, 0.92);

        // IMPORTANT: Don't apply manual gamma here; Three.js renderer handles output color space.
        gl_FragColor = vec4(finalColor, alpha);
    }
  `
);

extend({ WaterMeshShader });

export interface WaterMaterialProps {
  sunDirection?: THREE.Vector3;
  shoreMask?: THREE.Texture | null;
  shoreEdge?: number;
  alphaBase?: number;
  texStrength?: number;
  foamStrength?: number;
}

/**
 * Water material component.
 */
export const WaterMaterial: React.FC<WaterMaterialProps> = ({
  sunDirection,
  shoreMask = null,
  shoreEdge = 0.06,
  alphaBase = 0.58,
  texStrength = 0.12,
  foamStrength = 0.22
}) => {
  const ref = useRef<any>(null);
  const { camera, scene } = useThree();

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.uTime = clock.getElapsedTime();
      ref.current.uCamPos = camera.position;
      // Chunk opacity fade was removed; keep water fully active and let fog handle distance.
      ref.current.uFade = 1.0;
      ref.current.uShoreEdge = shoreEdge;
      ref.current.uAlphaBase = alphaBase;
      ref.current.uTexStrength = texStrength;
      ref.current.uFoamStrength = foamStrength;
      ref.current.uChunkSize = CHUNK_SIZE_XZ;

      const fog = scene.fog as THREE.Fog | undefined;
      if (fog) {
        ref.current.uFogColor.copy(fog.color);
        ref.current.uFogNear = fog.near;
        ref.current.uFogFar = fog.far;
      } else {
        ref.current.uFogColor.set('#87CEEB');
        ref.current.uFogNear = 1e6;
        ref.current.uFogFar = 1e6 + 1.0;
      }

      if (sunDirection) ref.current.uSunDir = sunDirection;
      if (ref.current.uNoiseTexture !== noiseTexture) {
        ref.current.uNoiseTexture = noiseTexture;
      }
      // Ensure a valid shore mask is always bound (shader discards when mask is 0).
      const nextMask = shoreMask ?? FALLBACK_SHORE_MASK;
      if (ref.current.uShoreMask !== nextMask) ref.current.uShoreMask = nextMask;
    }
  });

  return (
    // @ts-ignore
    <waterMeshShader
      ref={ref}
      transparent
      side={THREE.DoubleSide} // Render backfaces for volume feel
      depthWrite={false} // Important for transparency sorting
    />
  );
};
