import * as THREE from 'three';
import React, { useMemo } from 'react';
import { extend, useFrame, useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { CHUNK_SIZE_XZ } from '@/constants';
import { sharedUniforms } from '@core/graphics/SharedUniforms';

// Fallback 1x1 shoreline mask
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

const PLACEHOLDER_NOISE_3D = (() => {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.Data3DTexture(data, 1, 1, 1);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.needsUpdate = true;
  return tex;
})();

const WaterMeshShader = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0, 1, 0),
    uColorShallow: new THREE.Color('#3ea7d6'),
    uColorDeep: new THREE.Color('#0b3e63'),
    uNoiseTexture: PLACEHOLDER_NOISE_3D,
    uShoreMask: FALLBACK_SHORE_MASK,
    uShoreEdge: 0.06,
    uAlphaBase: 0.58,
    uFresnelAlpha: 0.22,
    uTexScale: 0.06,
    uTexStrength: 0.12,
    uFoamStrength: 0.22,
    uChunkSize: CHUNK_SIZE_XZ,
    uCamPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#87CEEB'),
    uFogNear: 20,
    uFogFar: 250,
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
        return normalize(baseNormal + vec3(n1-0.5, n2-0.5, (n1+n2)*0.1) * 0.5);
    }

    void main() {
        vec2 uv = fract(vWorldPos.xz / max(uChunkSize, 0.0001));
        float mask = texture2D(uShoreMask, uv).r;
        float edgeAlpha = smoothstep(0.5 - uShoreEdge, 0.5 + uShoreEdge, mask);
        if (edgeAlpha < 0.01) discard;

        vec3 viewDir = normalize(uCamPos - vWorldPos);
        vec3 normal = getNormal(vWorldPos, vNormal, uTime);

        vec3 lightDir = normalize(uSunDir);
        vec3 halfVec = normalize(lightDir + viewDir);
        float NdotH = max(dot(normal, halfVec), 0.0);
        float specular = pow(NdotH, 100.0) * 1.0;
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

        vec3 texP = vec3(vWorldPos.xz * uTexScale, 0.25);
        vec3 nTex = texture(uNoiseTexture, texP).rgb;
        float texVal = (nTex.r + nTex.g) * 0.5;
        float texSigned = (texVal - 0.5) * 2.0;

        vec3 albedo = mix(uColorDeep, uColorShallow, fresnel * 0.5 + 0.25);
        albedo *= 1.0 + texSigned * uTexStrength;

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
        gl_FragColor = vec4(finalColor, alpha);
    }
  `
);

extend({ WaterMeshShader });

let sharedWaterMaterial: any = null;
let lastUpdateFrame = -1;

export const getSharedWaterMaterial = () => {
  if (sharedWaterMaterial) return sharedWaterMaterial;

  sharedWaterMaterial = new WaterMeshShader();
  sharedWaterMaterial.transparent = true;
  sharedWaterMaterial.side = THREE.DoubleSide;
  sharedWaterMaterial.depthWrite = false;

  // Link to shared uniforms to avoid per-frame updates in multiple locations
  sharedWaterMaterial.uniforms.uTime = sharedUniforms.uTime;
  sharedWaterMaterial.uniforms.uSunDir = sharedUniforms.uSunDir;
  sharedWaterMaterial.uniforms.uFogNear = sharedUniforms.uFogNear;
  sharedWaterMaterial.uniforms.uFogFar = sharedUniforms.uFogFar;

  sharedWaterMaterial.onBeforeRender = (_renderer: any, _scene: any, _camera: any, _geometry: any, object: any) => {
    if (object.userData && object.userData.shoreMask) {
      sharedWaterMaterial.uniforms.uShoreMask.value = object.userData.shoreMask;
    } else {
      sharedWaterMaterial.uniforms.uShoreMask.value = FALLBACK_SHORE_MASK;
    }
  };

  return sharedWaterMaterial;
};

/**
 * WaterMaterial Component
 * Refactored to link to shared uniforms and eliminate prop-drilling.
 */
export interface WaterMaterialProps {
  sunDirection?: THREE.Vector3;
  shoreEdge?: number;
  alphaBase?: number;
  texStrength?: number;
  foamStrength?: number;
}

export const WaterMaterial: React.FC<WaterMaterialProps> = React.memo(({
  sunDirection, shoreEdge, alphaBase, texStrength, foamStrength
}) => {
  useThree();
  const material = useMemo(() => getSharedWaterMaterial(), []);

  useFrame((state) => {
    // Lazy initialization
    if (material.uniforms.uNoiseTexture.value === PLACEHOLDER_NOISE_3D) {
      material.uniforms.uNoiseTexture.value = getNoiseTexture();
    }

    if (lastUpdateFrame !== state.gl.info.render.frame) {
      lastUpdateFrame = state.gl.info.render.frame;

      const uniforms = material.uniforms;
      uniforms.uCamPos.value.copy(state.camera.position);

      if (sunDirection) uniforms.uSunDir.value.copy(sunDirection);
      if (shoreEdge !== undefined) uniforms.uShoreEdge.value = shoreEdge;
      if (alphaBase !== undefined) uniforms.uAlphaBase.value = alphaBase;
      if (texStrength !== undefined) uniforms.uTexStrength.value = texStrength;
      if (foamStrength !== undefined) uniforms.uFoamStrength.value = foamStrength;

      // Sync fog from scene
      if (state.scene.fog && (state.scene.fog as any).color) {
        uniforms.uFogColor.value.copy((state.scene.fog as any).color);
      }
    }
  });

  return <primitive object={material} attach="material" />;
});
