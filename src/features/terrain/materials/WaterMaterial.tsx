import * as THREE from 'three';
import React, { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { getNoiseTexture } from '@core/memory/sharedResources';
import { CHUNK_SIZE_XZ, WATER_LEVEL } from '@/constants';
import { sharedUniforms } from '@core/graphics/SharedUniforms';
import { frameProfiler } from '@core/utils/FrameProfiler';

/**
 * Water surface material.
 *
 * One material per water chunk (all clones share one compiled program). Each
 * chunk gets its own seabed height texture, so the shader knows the water
 * depth at every pixel:
 *  - the shoreline is where depth reaches 0 (follows the real terrain curve,
 *    not the voxel grid),
 *  - colour goes from turquoise shallows to deep blue,
 *  - an animated foam line runs along the shore,
 *  - under a cave roof or on land the depth is negative, so nothing is drawn.
 *
 * (The previous shared material set a per-object shore mask in onBeforeRender,
 * which three.js does not upload per draw, so the mask had been disabled.)
 */

const SEABED_SIZE = CHUNK_SIZE_XZ;
/** Heightmap sentinel for columns without a surface (treated as deep water). */
const NO_SURFACE = -900;

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vLocal;

  void main() {
    vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vLocal = position.xz;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform sampler3D uNoiseTexture;
  uniform sampler2D uSeabed;
  uniform float uHasSeabed;
  uniform float uWaterLevel;
  uniform float uChunkSize;
  uniform vec3 uColorShallow;
  uniform vec3 uColorDeep;
  uniform int uDebugMode;

  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vLocal;

  vec3 waveNormal(vec3 pos, float t) {
    vec3 p1 = pos * 0.02 + vec3(t * 0.010, t * 0.005, t * 0.020);
    vec3 p2 = pos * 0.05 - vec3(t * 0.016, 0.0, t * 0.012);
    vec3 p3 = pos * 0.13 + vec3(0.0, t * 0.03, t * 0.025);
    float a = texture(uNoiseTexture, p1).r - 0.5;
    float b = texture(uNoiseTexture, p2).g - 0.5;
    float c = texture(uNoiseTexture, p3).b - 0.5;
    return normalize(vec3(a * 0.55 + c * 0.25, 1.0, b * 0.55 + c * 0.25));
  }

  void main() {
    // Seabed height (world Y) at this pixel; texel i sits at local x = i.
    float depth = 40.0;
    if (uHasSeabed > 0.5) {
      vec2 uv = (vLocal + 0.5) / uChunkSize;
      float seabed = texture2D(uSeabed, uv).r;
      depth = uWaterLevel - seabed;
    }
    if (depth <= 0.0) discard; // land, or a roofed cave/pit: no water sheet

    if (uDebugMode == 1) { gl_FragColor = vec4(vec3(clamp(depth / 8.0, 0.0, 1.0)), 1.0); return; }
    if (uDebugMode == 3) { float sb = uWaterLevel - depth; gl_FragColor = vec4(fract(sb * 0.5), fract(depth * 0.25), 0.0, 1.0); return; }
    if (uDebugMode == 2) { gl_FragColor = vec4(uHasSeabed > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), 1.0); return; }

    vec3 viewDir = normalize(uCamPos - vWorldPos);
    vec3 n = waveNormal(vWorldPos, uTime);
    // Calm the surface in the shallows (short fetch, less chop).
    n = normalize(mix(vec3(0.0, 1.0, 0.0), n, smoothstep(0.0, 2.0, depth) * 0.7 + 0.3));

    float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);
    vec3 lightDir = normalize(uSunDir);
    vec3 halfVec = normalize(lightDir + viewDir);
    float sunUp = smoothstep(-0.05, 0.15, lightDir.y);
    // Tight glints: broad highlights bloomed into white blotches.
    float spec = pow(max(dot(n, halfVec), 0.0), 480.0) * 1.6 * sunUp;

    // Water body colour: absorption with depth (turquoise shallows -> deep blue).
    float depthT = 1.0 - exp(-depth * 0.28);
    vec3 body = mix(uColorShallow, uColorDeep, depthT);
    // Sky reflection approximated by the fog/sky colour.
    vec3 col = mix(body, uFogColor * 1.02, fresnel * 0.5) + vec3(spec);

    // Shore foam: an animated line where the water gets thin.
    float foamNoise = texture(uNoiseTexture, vec3(vWorldPos.xz * 0.25, uTime * 0.05)).r;
    // Thin and broken, right at the edge: a 55 cm band covered whole shallow
    // flats in white smears.
    float foamBand = 1.0 - smoothstep(0.03, 0.22, depth);
    float foamWave = 0.55 + 0.45 * sin(uTime * 1.6 - depth * 18.0 + foamNoise * 6.0);
    float foam = foamBand * foamWave * smoothstep(0.45, 0.7, foamNoise + foamBand * 0.3);
    col = mix(col, vec3(0.9, 0.93, 0.92), foam * 0.6);

    // Fog
    float dist = distance(uCamPos, vWorldPos);
    float fog = clamp((dist - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
    col = mix(col, uFogColor, pow(fog, 1.25) * 0.6);

    // Opacity: clear in the shallows so the seabed shows, denser with depth,
    // fading to zero exactly at the shoreline.
    float shoreFade = smoothstep(0.0, 0.35, depth);
    float alpha = mix(0.35, 0.88, depthT) + fresnel * 0.2;
    alpha = clamp(alpha * shoreFade + foam * 0.45, 0.0, 0.95);

    gl_FragColor = vec4(col, alpha);
  }
`;

// Shared (not cloned) uniform objects: updated once per frame for every chunk.
const sharedCamPos = { value: new THREE.Vector3() };
const sharedFogColor = { value: new THREE.Color('#87CEEB') };
const sharedDebugMode = { value: 0 };
let lastUpdateFrame = -1;

let template: THREE.ShaderMaterial | null = null;
const getTemplate = (): THREE.ShaderMaterial => {
  if (template) return template;
  template = new THREE.ShaderMaterial({
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      uSeabed: { value: null },
      uHasSeabed: { value: 0 },
      uWaterLevel: { value: WATER_LEVEL },
      uChunkSize: { value: CHUNK_SIZE_XZ },
      uColorShallow: { value: new THREE.Color('#5a978d') }, // muted teal, not tropical turquoise
      uColorDeep: { value: new THREE.Color('#16303b') },
      uNoiseTexture: { value: null },
    },
  });
  return template;
};

/** Build a per-chunk material that shares the compiled program and frame uniforms. */
const createChunkWaterMaterial = (seabed: THREE.Texture | null): THREE.ShaderMaterial => {
  const mat = getTemplate().clone();
  const u = mat.uniforms;
  u.uTime = sharedUniforms.uTime;
  u.uSunDir = sharedUniforms.uSunDir;
  u.uFogNear = sharedUniforms.uFogNear;
  u.uFogFar = sharedUniforms.uFogFar;
  u.uCamPos = sharedCamPos;
  u.uFogColor = sharedFogColor;
  u.uDebugMode = sharedDebugMode;
  u.uNoiseTexture = { value: getNoiseTexture() };
  u.uSeabed = { value: seabed };
  u.uHasSeabed = { value: seabed ? 1 : 0 };
  return mat;
};

/** Seabed (surface height, world Y) texture from the chunk's 32x32 height map. */
export const createSeabedTexture = (heights: Float32Array | undefined): THREE.DataTexture | null => {
  if (!heights || heights.length !== SEABED_SIZE * SEABED_SIZE) return null;
  const half = new Uint16Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    // Columns without a surface count as deep water (keeps filtering sane).
    const h = heights[i] < NO_SURFACE ? WATER_LEVEL - 40 : heights[i];
    half[i] = THREE.DataUtils.toHalfFloat(h);
  }
  // Half float: linear filtering is core in WebGL2 (32-bit float needs an extension).
  const tex = new THREE.DataTexture(half, SEABED_SIZE, SEABED_SIZE, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
};

// Debug: window.__waterDebug(1) shows water depth as greyscale, 0 = normal.
if (typeof window !== 'undefined') {
  (window as unknown as { __waterDebug?: (mode: number) => void }).__waterDebug = (mode: number) => {
    sharedDebugMode.value = mode;
  };
}

export interface WaterMaterialProps {
  /** Chunk surface heights (world Y, 32x32), i.e. chunk.grassHeightTex. */
  seabedHeights?: Float32Array;
}

export const WaterMaterial: React.FC<WaterMaterialProps> = React.memo(({ seabedHeights }) => {
  const seabed = useMemo(() => createSeabedTexture(seabedHeights), [seabedHeights]);
  const material = useMemo(() => createChunkWaterMaterial(seabed), [seabed]);

  useEffect(() => () => {
    material.dispose();
    seabed?.dispose();
  }, [material, seabed]);

  useFrame((state) => {
    if (lastUpdateFrame === state.gl.info.render.frame) return;
    lastUpdateFrame = state.gl.info.render.frame;
    frameProfiler.begin('water-material');
    sharedCamPos.value.copy(state.camera.position);
    const fog = state.scene.fog as THREE.Fog | null;
    if (fog?.color) sharedFogColor.value.copy(fog.color);
    frameProfiler.end('water-material');
  });

  return <primitive object={material} attach="material" />;
});
