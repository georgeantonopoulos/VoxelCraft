import * as THREE from 'three';
import React, { useMemo } from 'react';
import { extend, useFrame, useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { useControls, folder } from 'leva';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { CHUNK_SIZE_XZ } from '@/constants';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { frameProfiler } from '@core/utils/FrameProfiler';

// Global water debug mode (accessible from Leva)
let waterDebugMode = 0;

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
    uFade: 1,
    uDebugMode: 0,
    uNoiseEnabled: 1, // 1=true, 0=false
    uForceFullAlpha: 0 // 1=true, 0=false
  },
  // Vertex shader
  `
    precision highp float;
    uniform float uTime;
    uniform float uChunkSize;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    varying float vFragDepth;
    varying vec2 vLocalUV;

    void main() {
      // Transform normal to WORLD space (not view space) for consistency with viewDir calculation
      vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
      
      // Pass local mesh position for UV calculation
      vLocalUV = position.xz / uChunkSize;
      
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vec4 mvPosition = viewMatrix * worldPos;
      vViewPos = -mvPosition.xyz;
      gl_Position = projectionMatrix * mvPosition;
      
      // For logarithmic depth buffer
      vFragDepth = 1.0 + gl_Position.w;
    }
  `,
  // Fragment shader
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
    uniform int uDebugMode;
    uniform int uNoiseEnabled;
    uniform int uForceFullAlpha;

    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying vec3 vViewPos;
    varying float vFragDepth;
    varying vec2 vLocalUV;

    // Logarithmic depth buffer constant
    const float logDepthBufFC = 0.1823;

    vec3 getNormal(vec3 pos, vec3 baseNormal, float time) {
        // Skip noise calculcations if disabled
        if (uNoiseEnabled == 0) return baseNormal;

        float scale = 0.1;
        float speed = 0.5;
        vec3 p1 = pos * scale + vec3(time * speed * 0.1, time * speed * 0.05, time * 0.02);
        vec3 p2 = pos * scale - vec3(time * speed * 0.08, 0.0, time * speed * 0.06);
        float n1 = texture(uNoiseTexture, p1 * 0.2).r;
        float n2 = texture(uNoiseTexture, p2 * 0.2).g;
        return normalize(baseNormal + vec3(n1-0.5, n2-0.5, (n1+n2)*0.1) * 0.5);
    }

    void main() {
        vec2 uv = vLocalUV;
        // float mask = texture(uShoreMask, uv).r; // DISABLED SHORE MASK
        float mask = 1.0; 
        float edgeAlpha = smoothstep(0.5 - uShoreEdge, 0.5 + uShoreEdge, mask);
        
        // Debug mode 1: Show UV as colors (red=U, green=V)
        if (uDebugMode == 1) {
            gl_FragColor = vec4(uv.x, uv.y, 0.0, 1.0);
            gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
            return;
        }

        // Debug mode 2: Show shore mask value (white=water, black=land)
        if (uDebugMode == 2) {
            gl_FragColor = vec4(vec3(mask), 1.0);
            gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
            return;
        }
        
        // Debug mode 4: Simple solid blue water, alpha=1, no effects
        if (uDebugMode == 4) {
            gl_FragColor = vec4(0.2, 0.5, 0.8, 1.0);
            gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
            return;
        }

        // Debug mode 3: Skip shore mask discard (show all water)
        // if (uDebugMode != 3 && edgeAlpha < 0.01) discard; // REMOVED: Causing disappearance at grazing angles

        vec3 viewDir = normalize(uCamPos - vWorldPos);
        vec3 normal = getNormal(vWorldPos, vNormal, uTime);

        vec3 lightDir = normalize(uSunDir);
        vec3 halfVec = normalize(lightDir + viewDir);
        float NdotH = max(dot(normal, halfVec), 0.0);
        float specular = pow(NdotH, 100.0) * 1.0;
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

        vec3 texP = vec3(vWorldPos.xz * uTexScale, 0.25);
        vec3 nTex = vec3(0.5);
        if (uNoiseEnabled == 1) {
            nTex = texture(uNoiseTexture, texP).rgb;
        }
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
        
        if (uForceFullAlpha == 1) {
            alpha = 1.0;
        }
        
        gl_FragColor = vec4(finalColor, alpha);
        
        gl_FragDepth = log2(vFragDepth) * logDepthBufFC * 0.5;
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
  //sharedWaterMaterial.depthTest = false; // DIAGNOSTIC: disable depth testing

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

  // Debug controls - only active in debug mode
  const debugControls = useControls('Water Debug', {
    debugMode: {
      value: 0,
      options: { 'Normal': 0, 'Show UV': 1, 'Show Shore Mask': 2, 'No Shore Discard': 3, 'Solid Blue': 4 },
      label: 'Debug Mode'
    },
    depthTestEnabled: { value: true, label: 'Depth Test' },
    noiseEnabled: { value: true, label: 'Noise Enabled' },
    forceFullAlpha: { value: false, label: 'Force Alpha=1' }
  }, { collapsed: true });

  useFrame((state) => {
    frameProfiler.begin('water-material');
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

      // Apply debug mode
      uniforms.uDebugMode.value = debugControls.debugMode;
      uniforms.uNoiseEnabled.value = debugControls.noiseEnabled ? 1 : 0;
      uniforms.uForceFullAlpha.value = debugControls.forceFullAlpha ? 1 : 0;
      material.depthTest = debugControls.depthTestEnabled;

      // Sync fog from scene
      if (state.scene.fog && (state.scene.fog as any).color) {
        uniforms.uFogColor.value.copy((state.scene.fog as any).color);
      }
    }
    frameProfiler.end('water-material');
  });

  return <primitive object={material} attach="material" />;
});
