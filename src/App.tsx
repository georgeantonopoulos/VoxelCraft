import React, { useState, Suspense, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapDebug } from '@/ui/MapDebug';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, ToneMapping, N8AO, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import { useControls, Leva, folder, button } from 'leva';
import * as THREE from 'three';
import { DynamicEnvironmentIBL } from '@core/graphics/DynamicEnvironmentIBL';

// Components
// Components
import { VoxelTerrain } from '@features/terrain/components/VoxelTerrain';
import { Player } from '@features/player/Player';
import { FloraPlacer } from '@features/flora/components/FloraPlacer';
import { HUD as UI } from '@ui/HUD';
import { StartupScreen } from '@ui/StartupScreen';
import { BedrockPlane } from '@features/terrain/components/BedrockPlane';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { AmbientLife } from '@features/environment/AmbientLife';
import { setSnapEpsilon } from '@/constants';
import { useWorldStore } from '@state/WorldStore';
import { FirstPersonTools } from '@features/interaction/components/FirstPersonTools';
import { PhysicsItemRenderer } from '@features/interaction/components/PhysicsItemRenderer';
import { InteractionHandler } from '@features/interaction/logic/InteractionHandler';
import { InventoryInput } from '@features/interaction/components/InventoryInput';
import { WorldSelectionScreen } from '@ui/WorldSelectionScreen';
import { BiomeManager, BiomeType, WorldType } from '@features/terrain/logic/BiomeManager';
import { useEnvironmentStore } from '@state/EnvironmentStore';
import { terrainRuntime } from '@features/terrain/logic/TerrainRuntime';
import { useSettingsStore } from '@state/SettingsStore';
import { useInputStore } from '@/state/InputStore';
import { SettingsMenu } from '@/ui/SettingsMenu';
import { TouchControls } from '@/ui/TouchControls';
import { TouchCameraControls } from '@features/player/TouchCameraControls';

// Keyboard Map
const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'shift', keys: ['Shift'] },
];

// Removed InteractionLayer (Logic moved to InteractionHandler.tsx)

const DebugControls: React.FC<{
  setDebugShadowsEnabled: (v: boolean) => void;
  setTriplanarDetail: (v: number) => void;
  setPostProcessingEnabled: (v: boolean) => void;
  setAoEnabled: (v: boolean) => void;
  setAoIntensity: (v: number) => void;
  setBloomIntensity: (v: number) => void;
  setBloomThreshold: (v: number) => void;
  setExposureSurface: (v: number) => void;
  setExposureCaveMax: (v: number) => void;
  setExposureUnderwater: (v: number) => void;
  setFogNear: (v: number) => void;
  setFogFar: (v: number) => void;
  setSunIntensityMul: (v: number) => void;
  setAmbientIntensityMul: (v: number) => void;
  setMoonIntensityMul: (v: number) => void;
  setIblEnabled: (v: boolean) => void;
  setIblIntensity: (v: number) => void;
  setTerrainShaderFogEnabled: (v: boolean) => void;
  setTerrainShaderFogStrength: (v: number) => void;
  setTerrainThreeFogEnabled: (v: boolean) => void;
  setTerrainFadeEnabled: (v: boolean) => void;
  setTerrainWetnessEnabled: (v: boolean) => void;
  setTerrainMossEnabled: (v: boolean) => void;
  setTerrainRoughnessMin: (v: number) => void;
  setBedrockPlaneEnabled: (v: boolean) => void;
  setTerrainPolygonOffsetEnabled: (v: boolean) => void;
  setTerrainPolygonOffsetFactor: (v: number) => void;
  setTerrainPolygonOffsetUnits: (v: number) => void;
  setLevaScale: (v: number) => void;
  setLevaWidth: (v: number) => void;
  setTerrainChunkTintEnabled: (v: boolean) => void;
  setTerrainWireframeEnabled: (v: boolean) => void;
  setTerrainWeightsView: (v: string) => void;
  setCaOffset: (v: number) => void;
  setVignetteDarkness: (v: number) => void;
  // Sun Shadow Params
  setSunShadowBias: (v: number) => void;
  setSunShadowNormalBias: (v: number) => void;
  setSunShadowMapSize: (v: number) => void;
  setSunShadowCamSize: (v: number) => void;
  // Sun Orbit Params
  setSunOrbitRadius: (v: number) => void;
  setSunOrbitSpeed: (v: number) => void;
  setSunTimeOffset: (v: number) => void;
  // STATE VALUES PROPS (needed for export)
  values: any;
}> = (props) => {
  useControls(
    {
      'Scene Lighting': folder({
        Sun: folder({
          'Properties': folder({
            sunIntensity: { value: 1.5, min: 0.0, max: 2.5, step: 0.01, onChange: props.setSunIntensityMul, label: 'Intensity' },
            radius: { value: 300, min: 50, max: 1000, step: 10, onChange: props.setSunOrbitRadius, label: 'Orbit Radius' },
            speed: { value: 0.025, min: 0.0, max: 0.5, step: 0.001, onChange: props.setSunOrbitSpeed, label: 'Orbit Speed' },
            timeOffset: { value: 0.0, min: 0.0, max: Math.PI * 2, step: 0.05, onChange: props.setSunTimeOffset, label: 'Time Offset' }
          }),
          'Shadows': folder({
            shadowsEnabled: { value: true, onChange: (v) => props.setDebugShadowsEnabled(!!v), label: 'Enabled' },
            sunBias: { value: -0.0005, min: -0.01, max: 0.01, step: 0.0001, onChange: props.setSunShadowBias, label: 'Bias' },
            sunNormalBias: { value: 0.02, min: 0.0, max: 0.2, step: 0.001, onChange: props.setSunShadowNormalBias, label: 'Normal Bias' },
            sunMapSize: {
              value: 2048,
              options: { '1024': 1024, '2048': 2048, '4096': 4096 },
              onChange: (v) => props.setSunShadowMapSize(Number(v)),
              label: 'Map Size'
            },
            sunCamSize: { value: 200, min: 50, max: 500, step: 10, onChange: props.setSunShadowCamSize, label: 'Cam Size' },
          })
        }),
        Moon: folder({
          moonIntensity: { value: 1.7, min: 0.0, max: 3.0, step: 0.01, onChange: props.setMoonIntensityMul, label: 'Intensity' },
        }),
        Ambient: folder({
          ambientIntensity: { value: 1.0, min: 0.0, max: 2.5, step: 0.01, onChange: props.setAmbientIntensityMul, label: 'Intensity' },
        }),
        IBL: folder({
          iblEnabled: { value: false, onChange: (v) => props.setIblEnabled(!!v), label: 'Enabled' },
          iblIntensity: { value: 0.4, min: 0.0, max: 2.0, step: 0.01, onChange: props.setIblIntensity, label: 'Intensity' },
        }),
        Fog: folder({
          fogNear: { value: 20, min: 0, max: 120, step: 1, onChange: props.setFogNear, label: 'Near' },
          fogFar: { value: 160, min: 20, max: 600, step: 5, onChange: props.setFogFar, label: 'Far' },
        })
      }, { collapsed: false }),

      'Post Processing': folder({
        ppEnabled: { value: true, onChange: (v) => props.setPostProcessingEnabled(!!v), label: 'Master Switch' },
        bloomIntensity: { value: 0.6, min: 0.0, max: 2.0, step: 0.01, onChange: props.setBloomIntensity, label: 'Bloom Int' },
        bloomThreshold: { value: 0.4, min: 0.0, max: 1.5, step: 0.01, onChange: props.setBloomThreshold, label: 'Bloom Thresh' },
        exposureSurface: { value: 0.6, min: 0.2, max: 1.5, step: 0.01, onChange: props.setExposureSurface, label: 'Exp Surface' },
        exposureCaveMax: { value: 1.3, min: 0.4, max: 2.5, step: 0.01, onChange: props.setExposureCaveMax, label: 'Exp Cave' },
        exposureUnderwater: { value: 0.8, min: 0.2, max: 1.2, step: 0.01, onChange: props.setExposureUnderwater, label: 'Exp Underwater' },
        aoEnabled: { value: true, onChange: (v) => props.setAoEnabled(!!v), label: 'AO Enabled' },
        aoIntensity: { value: 2.0, min: 0.0, max: 6.0, step: 0.1, onChange: props.setAoIntensity, label: 'AO Intensity' },
        caOffset: { value: 0.002, min: 0.0, max: 0.01, step: 0.0001, onChange: props.setCaOffset, label: 'Chrom. Abb.' },
        vignetteDarkness: { value: 0.5, min: 0.0, max: 1.0, step: 0.05, onChange: props.setVignetteDarkness, label: 'Vignette' },
      }, { collapsed: true }),

      'Terrain': folder({
        Material: folder({
          triplanarDetail: { value: 1.0, min: 0.0, max: 1.0, step: 0.01, onChange: props.setTriplanarDetail, label: 'Detail Mix' },
          terrainWetness: { value: true, onChange: (v) => props.setTerrainWetnessEnabled(!!v), label: 'Wetness' },
          terrainMoss: { value: true, onChange: (v) => props.setTerrainMossEnabled(!!v), label: 'Moss' },
          terrainRoughnessMin: { value: 0.0, min: 0.0, max: 1.0, step: 0.01, onChange: props.setTerrainRoughnessMin, label: 'Roughness Min' },
        }),
        Rendering: folder({
          chunkTint: { value: false, onChange: (v) => props.setTerrainChunkTintEnabled(!!v), label: 'Chunk Tint' },
          wireframe: { value: false, onChange: (v) => props.setTerrainWireframeEnabled(!!v), label: 'Wireframe' },
          weightsView: { value: 'off', options: { Off: 'off', Snow: 'snow', Grass: 'grass', 'Snow - Grass': 'snowMinusGrass', Dominant: 'dominant' }, onChange: (v) => props.setTerrainWeightsView(String(v)), label: 'Weights View' },
          terrainFade: { value: true, onChange: (v) => props.setTerrainFadeEnabled(!!v), label: 'Chunk Fade' },
          shaderFog: { value: true, onChange: (v) => props.setTerrainShaderFogEnabled(!!v), label: 'Shader Fog' },
          shaderFogStr: { value: 0.9, min: 0.0, max: 1.5, step: 0.05, onChange: props.setTerrainShaderFogStrength, label: 'Fog Strength' },
          threeFog: { value: true, onChange: (v) => props.setTerrainThreeFogEnabled(!!v), label: 'Three Fog' },
        }),
        Debug: folder({
          bedrock: { value: true, onChange: (v) => props.setBedrockPlaneEnabled(!!v), label: 'Bedrock Plane' },
          polyOffset: { value: false, onChange: (v) => props.setTerrainPolygonOffsetEnabled(!!v), label: 'Poly Offset' },
          poFactor: { value: -1.0, min: -10.0, max: 10.0, step: 0.1, onChange: props.setTerrainPolygonOffsetFactor, label: 'PO Factor' },
          poUnits: { value: -1.0, min: -10.0, max: 10.0, step: 0.1, onChange: props.setTerrainPolygonOffsetUnits, label: 'PO Units' },
          snapEpsilon: { value: 0.02, min: 0.01, max: 0.15, step: 0.01, onChange: setSnapEpsilon, label: 'Snap Epsilon' }
        })
      }, { collapsed: true }),

      'Tools': folder({
        'Copy Config': button((get) => {
          const config = { ...props.values };
          console.log('[DebugConfig] JSON:', JSON.stringify(config, null, 2));
          navigator.clipboard.writeText(JSON.stringify(config, null, 2))
            .then(() => alert('Configuration copied to clipboard!'))
            .catch((err) => console.error('Failed to copy config:', err));
        })
      }, { collapsed: false }),

      'UI': folder({
        levaWidth: { value: 520, min: 320, max: 900, step: 10, onChange: props.setLevaWidth, label: 'Width' },
        levaScale: { value: 1.15, min: 0.8, max: 1.8, step: 0.05, onChange: props.setLevaScale, label: 'Scale' },
      }, { collapsed: true })
    },
    []
  );
  return null;
};

const DebugGL: React.FC<{ skipPost: boolean }> = ({ skipPost }) => {
  const { gl, camera } = useThree();
  const lastLog = useRef(0);

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (now - lastLog.current < 2.0) return; // Log every 2s
    lastLog.current = now;

    const info = gl.info;
    // console.log('[DebugGL] Stats:', {
    //   calls: info.render.calls,
    //   triangles: info.render.triangles,
    //   textures: info.memory.textures,
    //   geometries: info.memory.geometries,
    //   camPos: camera.position.toArray().map(v => Math.round(v * 10) / 10),
    //   camRot: camera.rotation.toArray().slice(0, 3).map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v),
    //   skipPost
    // });
  });

  useEffect(() => {
    console.log('[DebugGL] skipPostProcessing', skipPost);
    console.log('[DebugGL] GL Capabilities', {
      maxTextureSize: gl.capabilities.maxTextureSize,
      isWebGL2: gl.capabilities.isWebGL2
    });
  }, [skipPost, gl]);

  return null;
};

/**
 * Calculates the non-linear orbit angle for sun/moon to make day longer and night shorter.
 * Maps linear time progression to angle progression where day (sun above horizon) takes
 * ~70% of the cycle and night takes ~30%.
 * @param t - Elapsed time in seconds
 * @param speed - Base orbit speed
 * @param offset - Optional angle offset (e.g., Math.PI for moon to stay opposite sun)
 * @returns The calculated orbit angle
 */
const calculateOrbitAngle = (t: number, speed: number, offset: number = 0): number => {
  const cycleTime = t * speed;
  const normalizedCycle = (cycleTime % (Math.PI * 2)) / (Math.PI * 2); // 0 to 1

  // Stretch day (when sun is above horizon): spend ~70% of cycle in day, ~30% in night
  // Day corresponds to angles where cos(angle) > 0, i.e., -π/2 to π/2
  let angle;
  if (normalizedCycle < 0.35) {
    // First half of day: map 0-0.35 to -π/2 to 0
    angle = -Math.PI / 2 + (normalizedCycle / 0.35) * (Math.PI / 2);
  } else if (normalizedCycle < 0.65) {
    // Second half of day: map 0.35-0.65 to 0 to π/2
    angle = ((normalizedCycle - 0.35) / 0.3) * (Math.PI / 2);
  } else {
    // Night: map 0.65-1.0 to π/2 to 3π/2 (faster through night)
    angle = Math.PI / 2 + ((normalizedCycle - 0.65) / 0.35) * Math.PI;
  }

  // Add full cycle offset
  angle += Math.floor(cycleTime / (Math.PI * 2)) * Math.PI * 2;

  return angle + offset;
};

/**
 * Calculates sun color based on sun height (Y position).
 * Returns a color that transitions smoothly between:
 * - Night (sun below horizon): blue and darker
 * - Sunrise/sunset (sun near horizon): orange (not pink)
 * - Day (sun high): white/yellow
 */
const getSunColor = (sunY: number, radius: number): THREE.Color => {
  // Normalize sun height: -1 (fully below) to 1 (noon)
  const normalizedHeight = sunY / radius;

  // Define color states
  const nightColor = new THREE.Color(0x4a5a7a); // Blue, darker
  const sunriseSunsetColor = new THREE.Color(0xff7f42); // Orange (more orange, less pink)
  const dayColor = new THREE.Color(0xfffcf0); // White/yellow

  // Determine which phase we're in
  if (normalizedHeight < -0.15) {
    // Deep night: sun is well below horizon
    return nightColor;
  } else if (normalizedHeight < 0.0) {
    // Transition from Night to Sunset
    const t = (normalizedHeight + 0.15) / 0.15; // 0 at -0.15, 1 at 0.0
    return new THREE.Color().lerpColors(nightColor, sunriseSunsetColor, t);
  } else if (normalizedHeight < 0.3) {
    // Transition from Sunset to Day
    const t = normalizedHeight / 0.3; // 0 at 0.0, 1 at 0.3
    return new THREE.Color().lerpColors(sunriseSunsetColor, dayColor, t);
  } else {
    // Day: sun is high
    return dayColor;
  }
};

/**
 * Generates the halo color for the sun billboard so it remains tonally synced
 * with the main sun color while still allowing subtle warmth/cool adjustments
 * for different times of day.
 */
const getSunGlowColor = (normalizedHeight: number, sunColor: THREE.Color): THREE.Color => {
  const glowColor = sunColor.clone();
  const nightGlow = new THREE.Color(0x4a5a7a);
  const warmGlow = new THREE.Color(0xff9b4a);
  const dayHighlight = new THREE.Color(0xfff4d6);

  if (normalizedHeight < -0.15) {
    glowColor.lerp(nightGlow, 0.7).multiplyScalar(0.45);
    return glowColor;
  }

  if (normalizedHeight < 0.0) {
    const t = THREE.MathUtils.clamp((normalizedHeight + 0.15) / 0.15, 0, 1);
    glowColor.lerp(nightGlow, 1 - t).multiplyScalar(0.5 + 0.4 * t);
    return glowColor;
  }

  if (normalizedHeight < 0.3) {
    glowColor.lerp(warmGlow, 0.35).multiplyScalar(1.15);
    return glowColor;
  }

  return glowColor.lerp(dayHighlight, 0.2).multiplyScalar(1.05);
};

/**
 * Calculates sky gradient colors (top/zenith and bottom/horizon) based on sun height.
 * Returns colors that create a realistic sky gradient transitioning from zenith to horizon.
 */
const getSkyGradient = (sunY: number, radius: number): { top: THREE.Color, bottom: THREE.Color } => {
  const normalizedHeight = sunY / radius;

  // Night: Deep dark blue at top, slightly lighter at horizon
  const nightTop = new THREE.Color(0x020210);
  const nightBottom = new THREE.Color(0x101025);

  // Sunrise/Sunset: Deep blue at top, vibrant orange at horizon (less pink)
  const sunsetTop = new THREE.Color(0x2c3e50);
  const sunsetBottom = new THREE.Color(0xff8c42);

  // Day: Rich sky blue at top, pale blue at horizon
  const dayTop = new THREE.Color(0x1e90ff);
  const dayBottom = new THREE.Color(0x87CEEB);

  if (normalizedHeight < -0.15) {
    return { top: nightTop, bottom: nightBottom };
  } else if (normalizedHeight < 0.0) {
    // Transition from Night to Sunset
    const t = (normalizedHeight + 0.15) / 0.15; // 0 at -0.15, 1 at 0.0
    return {
      top: new THREE.Color().lerpColors(nightTop, sunsetTop, t),
      bottom: new THREE.Color().lerpColors(nightBottom, sunsetBottom, t)
    };
  } else if (normalizedHeight < 0.3) {
    // Transition from Sunset to Day
    const t = normalizedHeight / 0.3; // 0 at 0.0, 1 at 0.3
    return {
      top: new THREE.Color().lerpColors(sunsetTop, dayTop, t),
      bottom: new THREE.Color().lerpColors(sunsetBottom, dayBottom, t)
    };
  } else {
    return { top: dayTop, bottom: dayBottom };
  }
};

/**
 * SkyDome component that renders a gradient sky sphere.
 * The gradient transitions from top (zenith) to bottom (horizon) colors.
 */


const SunFollower: React.FC<{
  sunDirection?: THREE.Vector3;
  intensityMul?: number;
  shadowConfig?: {
    bias: number;
    normalBias: number;
    mapSize: number;
    camSize: number;
  };
  orbitConfig?: {
    radius: number;
    speed: number;
    offset: number;
  };
}> = ({
  sunDirection,
  intensityMul = 1.0,
  shadowConfig = {
    bias: -0.0005,
    normalBias: 0.02,
    mapSize: 2048,
    camSize: 200
  },
  orbitConfig = { radius: 300, speed: 0.025, offset: 0 }
}) => {
    const { camera } = useThree();
    const lightRef = useRef<THREE.DirectionalLight>(null);
    const sunMeshRef = useRef<THREE.Mesh>(null);
    const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
    const glowMeshRef = useRef<THREE.Mesh>(null);
    const glowMaterialRef = useRef<THREE.ShaderMaterial>(null);
    const target = useMemo(() => new THREE.Object3D(), []);
    const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);

    // Smooth position tracking to prevent choppy updates
    const smoothSunPos = useRef(new THREE.Vector3());
    const lastCameraPos = useRef(new THREE.Vector3());

    // Initialize smooth position tracking
    useEffect(() => {
      lastCameraPos.current.copy(camera.position);
      smoothSunPos.current.set(0, 0, 0);
    }, [camera]);

    useFrame(({ clock }) => {
      if (lightRef.current) {
        const t = clock.getElapsedTime() + orbitConfig.offset;
        const { radius, speed } = orbitConfig;

        // Non-linear angle mapping to make day longer and night shorter
        const angle = calculateOrbitAngle(t, speed);

        // Radius of orbit relative to player
        const sx = Math.sin(angle) * radius;
        const sy = Math.cos(angle) * radius;
        const sz = 30;

        // Smooth sun position relative to camera to prevent choppy updates
        const cameraDelta = camera.position.clone().sub(lastCameraPos.current);
        smoothSunPos.current.add(cameraDelta);
        lastCameraPos.current.copy(camera.position);

        // Calculate smooth sun position (only for visual sun, light stays snapped for performance)
        const sunDist = 350;
        const targetSunPos = new THREE.Vector3(
          smoothSunPos.current.x + Math.sin(angle) * sunDist,
          Math.cos(angle) * sunDist,
          smoothSunPos.current.z + sz
        );

        // Light position: snap to grid for performance (shadows don't need smooth movement)
        const q = 4;
        const lx = Math.round(camera.position.x / q) * q;
        const lz = Math.round(camera.position.z / q) * q;

        lightRef.current.position.set(lx + sx, sy, lz + sz);
        target.position.set(lx, 0, lz);

        lightRef.current.target = target;
        lightRef.current.updateMatrixWorld();
        target.updateMatrixWorld();

        // Expose the live sun direction for water/terrain shading and dynamic IBL.
        // We update a mutable Vector3 to avoid React state churn.
        if (sunDirection) {
          sunDirection.set(
            lightRef.current.position.x - target.position.x,
            lightRef.current.position.y - target.position.y,
            lightRef.current.position.z - target.position.z
          ).normalize();
        }

        // Calculate sun color based on height
        const sunColor = getSunColor(sy, radius);

        // Update light color
        lightRef.current.color.copy(sunColor);

        // Adjust intensity: fade out smoothly when below horizon
        const normalizedHeight = sy / radius;
        let baseIntensity = 1.0;
        if (normalizedHeight < -0.15) {
          // Deep night: darker
          baseIntensity = 0.1;
        } else if (normalizedHeight < 0.0) {
          // Transition from Night to Sunset
          const t = (normalizedHeight + 0.15) / 0.15; // 0 to 1
          baseIntensity = 0.1 + (0.4 - 0.1) * t;
        } else if (normalizedHeight < 0.3) {
          // Sunset to Day
          const t = normalizedHeight / 0.3; // 0 to 1
          baseIntensity = 0.4 + (1.0 - 0.4) * t;
        } else {
          // Day: full intensity
          baseIntensity = 1.0;
        }

        // Underground: keep outside readable by not hard-killing the sun globally.
        // We only dim moderately at depth to reduce "sun in caves" artifacts.
        const depthFade = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
        const sunDimming = THREE.MathUtils.lerp(1.0, 0.45, depthFade);
        lightRef.current.intensity = baseIntensity * sunDimming * intensityMul;

        // Update Visual Sun color and glow
        if (sunMeshRef.current) {
          // Use smooth position for visual sun to prevent choppy updates
          sunMeshRef.current.position.copy(targetSunPos);
          sunMeshRef.current.lookAt(camera.position);

          // Update sun material color
          if (sunMaterialRef.current) {
            const sunMeshColor = sunColor.clone();
            if (normalizedHeight < -0.15) {
              // Deep night: make sun mesh dim
              sunMeshColor.multiplyScalar(0.4);
            } else if (normalizedHeight < 0.0) {
              // Transition from sunset to night - fade smoothly
              const t = (normalizedHeight + 0.15) / 0.15;
              sunMeshColor.multiplyScalar(0.4 + (1.2 - 0.4) * t);
            } else {
              // Day/sunrise: bright sun core
              sunMeshColor.multiplyScalar(1.5);
            }

            // Underground: dim visual sun a bit (avoid glow leaks), but keep it visible when looking out.
            const depthFade2 = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
            sunMeshColor.multiplyScalar(THREE.MathUtils.lerp(1.0, 0.35, depthFade2));

            sunMaterialRef.current.color.copy(sunMeshColor);
          }

          // Update glow - make it more visible during sunset
          if (glowMeshRef.current && glowMaterialRef.current) {
            // Position glow at sun location (using smooth position)
            glowMeshRef.current.position.copy(targetSunPos);

            // Make glow always face camera
            glowMeshRef.current.lookAt(camera.position);

            // Calculate glow intensity and size based on sun position
            const isSunset = normalizedHeight >= 0.0 && normalizedHeight < 0.3;
            const glowScale = isSunset ? 5.0 : 3.5;
            const glowOpacityBase = isSunset ? 0.9 : (normalizedHeight < -0.15 ? 0.2 : 0.5);

            // Underground: reduce glow strength to keep caves moodier
            const depthFade3 = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
            const glowOpacity = glowOpacityBase * THREE.MathUtils.lerp(1.0, 0.25, depthFade3);

            glowMeshRef.current.scale.setScalar(glowScale);

            const glowColor = getSunGlowColor(normalizedHeight, sunColor);
            glowMaterialRef.current.uniforms.uColor.value.copy(glowColor);
            glowMaterialRef.current.uniforms.uOpacity.value = glowOpacity;
            // Animate rays
            glowMaterialRef.current.uniforms.uTime.value = t;
          }
        }
      }
    });

    return (
      <>
        <directionalLight
          ref={lightRef}
          color="#fffcf0"
          castShadow
          shadow-bias={shadowConfig.bias}
          shadow-normalBias={shadowConfig.normalBias}
          shadow-mapSize={[shadowConfig.mapSize, shadowConfig.mapSize]}
          shadow-camera-near={10}
          shadow-camera-far={500}
          shadow-camera-left={-shadowConfig.camSize}
          shadow-camera-right={shadowConfig.camSize}
          shadow-camera-top={shadowConfig.camSize}
          shadow-camera-bottom={-shadowConfig.camSize}
        />
        <primitive object={target} />

        {/* Physical Sun Mesh - Bright solid core */}
        <mesh ref={sunMeshRef}>
          <sphereGeometry args={[15, 32, 32]} />
          <meshBasicMaterial
            ref={sunMaterialRef}
            color="#fffee0"
            toneMapped={false}
            fog={false}
          />
        </mesh>

        {/* Sun Glow Billboard - High-quality atmospheric scattering simulation */}
        <mesh ref={glowMeshRef}>
          <planeGeometry args={[250, 250]} />
          <shaderMaterial
            ref={glowMaterialRef}
            transparent
            depthWrite={false}
            fog={false}
            blending={THREE.AdditiveBlending}
            uniforms={{
              uColor: { value: new THREE.Color() },
              uOpacity: { value: 0.25 },
              uTime: { value: 0 }
            }}
            vertexShader={`
            varying vec2 vUv;
            void main() {
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
            fragmentShader={`
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec2 vUv;

            // Pseudo-random
            float hash(float n) { return fract(sin(n) * 43758.5453123); }

            // Value noise for softer, cloud-like rays
            float noise(float p) {
                float fl = floor(p);
                float fc = fract(p);
                return mix(hash(fl), hash(fl + 1.0), fc);
            }

            void main() {
              vec2 centered = vUv - 0.5;
              float dist = length(centered);
              
              // 0. Hard circular clip to standard plane (safety)
              if (dist > 0.5) discard;

              // 1. Core Glow (Tiighter to match smaller rays)
              float core = 1.0 / (dist * 25.0 + 0.8);
              core = pow(core, 2.8);

              // 2. Volumetric Ray Simulation
              float angle = atan(centered.y, centered.x);
              float t = uTime * 0.05;
              
              // Layered noise for variation
              float raysA = noise(angle * 8.0 + t) * 0.5 + 0.5;
              float raysB = noise(angle * 16.0 - t * 1.5); // Range -0.5 to 1.5
              
              // Combine layers (straighter, sharper rays)
              float rays = raysA * 0.6 + raysB * 0.4;
              
              // **Ray Variation & Tip Fade**:
              // Mask rays to be VERY short (1/3rd size: fade start 0.03, fade end 0.09)
              float rayMask = smoothstep(0.02, 0.05, dist) * (1.0 - smoothstep(0.05, 0.09, dist));
              
              // Per-ray length variation
              float lengthVar = noise(angle * 3.0 + 52.0); 
              rayMask *= smoothstep(0.09, 0.05 + 0.03 * lengthVar, dist);

              // Anisotropy: Sharpen the beams
              rays = pow(max(0.0, rays), 4.0); 

              float totalLight = core * 0.75 + rays * rayMask * 0.65;
              
              // Clamp opacity
              float alpha = smoothstep(0.0, 1.0, totalLight) * uOpacity;

              // Color: Core is white-hot, rays are atmospheric
              vec3 finalColor = mix(uColor, vec3(1.0, 1.0, 0.95), core * 0.9);

              gl_FragColor = vec4(finalColor, alpha);
            }
          `}
          />
        </mesh>
      </>
    );
  };

/**
 * Simple moon component that orbits exactly opposite to the sun.
 * Uses "game physics" - moon and sun are counter-weights on a rotating stick.
 * Moon is visible when above horizon and provides subtle night lighting.
 */
const MoonFollower: React.FC<{
  intensityMul?: number;
  orbitConfig?: {
    radius: number;
    speed: number;
    offset: number;
  };
}> = ({
  intensityMul = 1.0,
  orbitConfig = { radius: 300, speed: 0.025, offset: 0 }
}) => {
    const { camera } = useThree();
    const moonMeshRef = useRef<THREE.Mesh>(null);
    const lightRef = useRef<THREE.DirectionalLight>(null);
    const target = useMemo(() => new THREE.Object3D(), []);
    const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);

    useFrame(({ clock }) => {
      if (!moonMeshRef.current || !lightRef.current) return;

      const t = clock.getElapsedTime() + orbitConfig.offset;
      const { radius, speed } = orbitConfig;

      // ROTATION: Exact opposite of Sun (add Math.PI for 180° offset)
      const angle = calculateOrbitAngle(t, speed, Math.PI);

      // --- VISUAL MOON (Mesh) ---
      // Push the moon mesh far away (1200 units) so it doesn't clip through 
      // terrain/mountains, but keep it properly scaled so it looks realistic.
      // Real moon is ~0.5 degrees. Radius 12 @ Dist 1200 ~= 0.57 degrees.
      const visualDistance = 1200;

      const vx = Math.sin(angle) * visualDistance;
      const vy = Math.cos(angle) * visualDistance;

      // Position relative to camera so it's always "at infinity"
      const mPx = camera.position.x + vx;
      const mPy = vy;
      const mPz = camera.position.z + 30; // Keep same Z plane offset

      moonMeshRef.current.position.set(mPx, mPy, mPz);
      // Ensure specific render order if needed, but distance usually sorts it.

      // --- LIGHTING (Physics) ---
      // Keep light at the configured orbital radius for consistent shadow map behavior
      const lx = Math.sin(angle) * radius;
      const ly = Math.cos(angle) * radius;

      const lPx = camera.position.x + lx;
      const lPy = ly;
      const lPz = camera.position.z + 30;

      lightRef.current.position.set(lPx, lPy, lPz);
      target.position.set(camera.position.x, 0, camera.position.z);
      lightRef.current.target = target;
      lightRef.current.updateMatrixWorld();

      // VISIBILITY: Only visible when above the horizon
      const isAboveHorizon = mPy > -150; // Buffer allows it to "set" below visual horizon
      moonMeshRef.current.visible = isAboveHorizon;

      // Underground: keep outside moon/sky readable but reduce cave bleed.
      const depthFade = THREE.MathUtils.smoothstep(undergroundBlend, 0.2, 1.0);
      const moonDimming = THREE.MathUtils.lerp(1.0, 0.35, depthFade);

      // Light intensity check - use the mathematical height (ly) not visual height
      lightRef.current.intensity = (ly > -50) ? 0.2 * moonDimming * intensityMul : 0;

      if (undergroundBlend > 0.85) moonMeshRef.current.visible = false;
    });

    return (
      <>
        <directionalLight
          ref={lightRef}
          color="#b8d4f0"
          intensity={0.2}
          castShadow={false}
        />
        <primitive object={target} />

        {/* Small White Sphere - fog={false} so scene fog doesn't hide the moon */}
        <mesh ref={moonMeshRef}>
          <sphereGeometry args={[12, 32, 32]} />
          <meshBasicMaterial color="#ffffff" fog={false} />
        </mesh>
      </>
    );
  };

/**
 * Controls fog, background, hemisphere light colors, and sky gradient based on sun position.
 * Renders the SkyDome with dynamic gradients and updates fog to match horizon color.
 */
const AtmosphereController: React.FC<{ baseFogNear: number; baseFogFar: number }> = ({ baseFogNear, baseFogFar }) => {
  const { scene, camera } = useThree();
  const hemisphereLightRef = useRef<THREE.HemisphereLight>(null);
  const gradientRef = useRef<{ top: THREE.Color, bottom: THREE.Color }>({
    top: new THREE.Color('#87CEEB'),
    bottom: new THREE.Color('#87CEEB')
  });

  // Smooth underground detection to avoid flicker near cave mouths
  const isUndergroundRef = useRef(false);
  const undergroundBlendRef = useRef(0);
  const lastSentBlendRef = useRef(0);
  const setUndergroundBlend = useEnvironmentStore((s) => s.setUndergroundBlend);
  const setUndergroundState = useEnvironmentStore((s) => s.setUndergroundState);

  // Smooth underwater detection to avoid flicker at the waterline.
  // Uses runtime voxel water queries at the camera position.
  const isUnderwaterRef = useRef(false);
  const underwaterBlendRef = useRef(0);
  const lastSentUnderwaterBlendRef = useRef(0);
  const setUnderwaterBlend = useEnvironmentStore((s) => s.setUnderwaterBlend);
  const setUnderwaterState = useEnvironmentStore((s) => s.setUnderwaterState);

  // Cave palette is used only for ground bounce/ambient cues.
  const caveGround = useMemo(() => new THREE.Color('#14101a'), []);

  // Underwater palette: cooler and denser (applied after sky/cave palette).
  const waterTop = useMemo(() => new THREE.Color('#061526'), []);
  const waterBottom = useMemo(() => new THREE.Color('#063047'), []);

  useFrame((state, delta) => {
    const t = state.clock.getElapsedTime();

    // Use the same non-linear orbit calculation as SunFollower
    const speed = 0.025;
    const angle = calculateOrbitAngle(t, speed);
    const radius = 300;
    const sy = Math.cos(angle) * radius;

    // Calculate sky gradient colors based on sun position
    const { top, bottom } = getSkyGradient(sy, radius);

    // --- Underground detection ---
    // Use TerrainService height approximation as a proxy for "surface above".
    const surfaceY = TerrainService.getHeightAt(camera.position.x, camera.position.z);
    const depthFromSurface = surfaceY - camera.position.y;

    // Hysteresis band: used for discrete "entered cave" events (torch, SFX).
    const nextIsUnderground = isUndergroundRef.current
      ? depthFromSurface > 3.0
      : depthFromSurface > 6.0;
    if (nextIsUnderground !== isUndergroundRef.current) {
      isUndergroundRef.current = nextIsUnderground;
      // Record the toggle time so other systems can delay effects (e.g., torch slide-in).
      setUndergroundState(nextIsUnderground, t);
    }

    // Continuous underground blend: 0 near surface -> 1 deep underground.
    // This makes lighting transition gradual as you move deeper into enclosed space.
    const targetBlend = THREE.MathUtils.clamp(
      THREE.MathUtils.smoothstep(depthFromSurface, 2.0, 18.0),
      0,
      1
    );
    undergroundBlendRef.current = THREE.MathUtils.damp(
      undergroundBlendRef.current,
      targetBlend,
      6.0,
      delta
    );

    // Push blend into store only when meaningfully changed.
    const blend = undergroundBlendRef.current;
    if (Math.abs(blend - lastSentBlendRef.current) > 0.01) {
      lastSentBlendRef.current = blend;
      setUndergroundBlend(blend);
    }

    // --- Underwater detection ---
    const nextIsUnderwater = terrainRuntime.isLiquidAtWorld(
      camera.position.x,
      camera.position.y,
      camera.position.z
    );
    if (nextIsUnderwater !== isUnderwaterRef.current) {
      isUnderwaterRef.current = nextIsUnderwater;
      setUnderwaterState(nextIsUnderwater, t);
    }

    const targetUnderwaterBlend = nextIsUnderwater ? 1.0 : 0.0;
    underwaterBlendRef.current = THREE.MathUtils.lerp(
      underwaterBlendRef.current,
      targetUnderwaterBlend,
      0.08
    );

    const uwBlend = underwaterBlendRef.current;
    if (Math.abs(uwBlend - lastSentUnderwaterBlendRef.current) > 0.01) {
      lastSentUnderwaterBlendRef.current = uwBlend;
      setUnderwaterBlend(uwBlend);
    }

    // Keep sky/fog driven by the sun even when underground so looking out remains bright.
    // Underwater is the only state that should override the whole palette.
    const finalTop = top.clone().lerp(waterTop, uwBlend);
    const finalBottom = bottom.clone().lerp(waterBottom, uwBlend);

    // Update gradient ref for SkyDome
    gradientRef.current.top.copy(finalTop);
    gradientRef.current.bottom.copy(finalBottom);

    // Update fog color to match horizon (bottom) color for seamless blending
    const fog = scene.fog as THREE.Fog | undefined;
    if (fog) {
      fog.color.copy(finalBottom);

      // Underground: adjust fog distances gradually with depth (but keep outdoor color).
      const caveNear = THREE.MathUtils.lerp(baseFogNear, Math.max(2.0, baseFogNear * 0.66), blend);
      const caveFar = THREE.MathUtils.lerp(baseFogFar, baseFogFar * 1.2, blend);

      // Underwater: much denser fog to sell immersion.
      fog.near = THREE.MathUtils.lerp(caveNear, 2.0, uwBlend);
      fog.far = THREE.MathUtils.lerp(caveFar, 60.0, uwBlend);
    }

    // Background color follows the same mix (still acts as fallback)
    if (scene.background && scene.background instanceof THREE.Color) {
      scene.background.copy(finalBottom);
    }

    // Update hemisphere light colors to match atmosphere
    if (hemisphereLightRef.current) {
      const normalizedHeight = sy / radius;
      hemisphereLightRef.current.color.copy(finalTop);

      if (normalizedHeight < -0.1) {
        // Night: darker ground
        hemisphereLightRef.current.groundColor
          .set(0x1a1a2a)
          .lerp(caveGround, blend)
          .lerp(waterBottom, uwBlend);
      } else if (normalizedHeight < 0.2) {
        // Sunrise/sunset: warmer ground
        hemisphereLightRef.current.groundColor
          .set(0x3a2a2a)
          .lerp(caveGround, blend)
          .lerp(waterBottom, uwBlend);
      } else {
        // Day: darker ground for contrast
        hemisphereLightRef.current.groundColor
          .set(0x2a2a4a)
          .lerp(caveGround, blend)
          .lerp(waterBottom, uwBlend);
      }
    }
  });

  return (
    <>
      {/* Ambient is controlled separately (see AmbientController) */}
      <hemisphereLight
        ref={hemisphereLightRef}
        args={['#87CEEB', '#2a2a4a', 0.5]}
      />
      <SkyDomeRefLink gradientRef={gradientRef} />
    </>
  );
};

/**
 * AmbientController
 * Keeps surface ambient as-is, but smoothly darkens and cools it underground.
 * This helps caves feel less flat while preserving overground readability.
 */
const AmbientController: React.FC<{ intensityMul?: number }> = ({ intensityMul = 1.0 }) => {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
  const surfaceAmbient = useMemo(() => new THREE.Color('#ccccff'), []);
  const caveAmbient = useMemo(() => new THREE.Color('#556070'), []);

  useFrame(() => {
    if (!ambientRef.current) return;

    // Underground: reduce ambient so emissives and local lights carry caves.
    // Slightly higher cave floor to avoid pitch-black walls.
    ambientRef.current.intensity = THREE.MathUtils.lerp(0.3, 0.14, undergroundBlend) * intensityMul;
    ambientRef.current.color.copy(surfaceAmbient).lerp(caveAmbient, undergroundBlend);
  });

  return (
    <ambientLight ref={ambientRef} intensity={0.3} color="#ccccff" />
  );
};

/**
 * ExposureToneMapping
 * Simple exposure shift so when you're in a dark cavern, looking outside remains bright/over-exposed.
 * We raise exposure with underground depth; underwater keeps a lower exposure for readability.
 */
const ExposureToneMapping: React.FC<{
  surfaceExposure: number;
  caveExposureMax: number;
  underwaterExposure: number;
}> = ({ surfaceExposure, caveExposureMax, underwaterExposure }) => {
  const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
  const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

  // Cave: higher exposure to adapt to darkness (outside sky clips brighter).
  const caveExposure = THREE.MathUtils.lerp(surfaceExposure, caveExposureMax, undergroundBlend);
  // Underwater: reduce exposure slightly to avoid blowing out fog.
  const exposure = THREE.MathUtils.lerp(caveExposure, underwaterExposure, underwaterBlend);

  return <ToneMapping exposure={exposure} />;
};

/**
 * Helper component to bridge the gradient ref to SkyDome.
 * Updates SkyDome colors without triggering React re-renders.
 */
const SkyDomeRefLink: React.FC<{
  gradientRef: React.MutableRefObject<{ top: THREE.Color, bottom: THREE.Color }>
}> = ({ gradientRef }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Create stable uniform references
  const uniforms = useMemo(() => ({
    uTopColor: { value: new THREE.Color('#87CEEB') },
    uBottomColor: { value: new THREE.Color('#87CEEB') },
    uExponent: { value: 0.6 }
  }), []);

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.copy(state.camera.position);

      // Update uniforms from gradient ref
      uniforms.uTopColor.value.copy(gradientRef.current.top);
      uniforms.uBottomColor.value.copy(gradientRef.current.bottom);
    }
  });

  return (
    <mesh ref={meshRef} scale={[400, 400, 400]}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uTopColor;
          uniform vec3 uBottomColor;
          uniform float uExponent;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition).y;
            float p = max(0.0, (h + 0.2) / 1.2);
            p = pow(p, uExponent);
            gl_FragColor = vec4(mix(uBottomColor, uTopColor, p), 1.0);
          }
        `}
      />
    </mesh>
  );
};

const CinematicCamera: React.FC<{ spawnPos: [number, number, number] | null }> = ({ spawnPos }) => {
  const { camera } = useThree();
  const angle = useRef(0);

  useFrame((_state, delta) => {
    angle.current += delta * 0.05; // Slow rotation
    const radius = 60;
    const centerX = 16;
    const centerZ = 16;

    const targetY = spawnPos ? spawnPos[1] : 20;
    const camY = targetY + 40; // Fly above

    const x = centerX + Math.sin(angle.current) * radius;
    const z = centerZ + Math.cos(angle.current) * radius;

    camera.position.lerp(new THREE.Vector3(x, camY, z), 0.1);
    camera.lookAt(centerX, targetY, centerZ);
  });

  return null;
};

const App: React.FC = () => {
  const [gameStarted, setGameStarted] = useState(false);
  const [terrainLoaded, setTerrainLoaded] = useState(false);
  const [action, setAction] = useState<'DIG' | 'BUILD' | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [spawnPos, setSpawnPos] = useState<[number, number, number] | null>(null);
  const [worldType, setWorldType] = useState<WorldType | null>(null);

  // Graphics & Input Settings
  const resolutionScale = useSettingsStore(s => s.resolutionScale);
  const inputMode = useSettingsStore(s => s.inputMode);
  const debugShadowsEnabled = useSettingsStore(s => s.shadows);
  const setDebugShadowsEnabled = useSettingsStore(s => s.setShadows);
  const aoEnabled = useSettingsStore(s => s.ao);
  const setAoEnabled = useSettingsStore(s => s.setAo);
  const bloomEnabled = useSettingsStore(s => s.bloom);
  const viewDistance = useSettingsStore(s => s.viewDistance);

  const [triplanarDetail, setTriplanarDetail] = useState(1.0);
  const [postProcessingEnabled, setPostProcessingEnabled] = useState(true);
  const [aoIntensity, setAoIntensity] = useState(2.0);
  const [terrainShaderFogEnabled, setTerrainShaderFogEnabled] = useState(true);
  const [terrainShaderFogStrength, setTerrainShaderFogStrength] = useState(0.9);
  const [terrainThreeFogEnabled, setTerrainThreeFogEnabled] = useState(true);
  const [terrainFadeEnabled, setTerrainFadeEnabled] = useState(true);
  const [terrainWetnessEnabled, setTerrainWetnessEnabled] = useState(true);
  const [terrainMossEnabled, setTerrainMossEnabled] = useState(true);
  const [terrainRoughnessMin, setTerrainRoughnessMin] = useState(0.0);
  const [bedrockPlaneEnabled, setBedrockPlaneEnabled] = useState(true);
  const [terrainPolygonOffsetEnabled, setTerrainPolygonOffsetEnabled] = useState(false);
  const [terrainPolygonOffsetFactor, setTerrainPolygonOffsetFactor] = useState(-1.0);
  const [terrainPolygonOffsetUnits, setTerrainPolygonOffsetUnits] = useState(-1.0);
  const [levaScale, setLevaScale] = useState(1.15);
  const [levaWidth, setLevaWidth] = useState(520);
  const [terrainChunkTintEnabled, setTerrainChunkTintEnabled] = useState(false);
  const [terrainWireframeEnabled, setTerrainWireframeEnabled] = useState(false);
  const [terrainWeightsView, setTerrainWeightsView] = useState('off');
  // Debug lighting controls (Leva in ?debug).
  // Defaults match the requested screenshot.
  const [fogNear, setFogNear] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('vcFogNear');
    const n = v != null ? Number(v) : 20;
    return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 0, 200) : 20;
  });
  const [fogFar, setFogFar] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get('vcFogFar');
    const n = v != null ? Number(v) : 160;
    return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 20, 800) : 160;
  });
  const [sunIntensityMul, setSunIntensityMul] = useState(1.5);
  const [ambientIntensityMul, setAmbientIntensityMul] = useState(1.0);
  const [moonIntensityMul, setMoonIntensityMul] = useState(1.7);
  // IBL: disabled by default (can be re-enabled later via debug if desired).
  const [iblEnabled, setIblEnabled] = useState(false);
  const [iblIntensity, setIblIntensity] = useState(0.4);
  const [exposureSurface, setExposureSurface] = useState(0.6);
  const [exposureCaveMax, setExposureCaveMax] = useState(1.3);
  const [exposureUnderwater, setExposureUnderwater] = useState(0.8);
  const [bloomIntensity, setBloomIntensity] = useState(0.6);
  const [bloomThreshold, setBloomThreshold] = useState(0.4);
  const [caOffset, setCaOffset] = useState(0.00001); // Subtle default (Simulates slight lens/motion imperfection)
  const [vignetteDarkness, setVignetteDarkness] = useState(0.5);

  // Sun Shadow Params
  const [sunShadowBias, setSunShadowBias] = useState(-0.0005);
  const [sunShadowNormalBias, setSunShadowNormalBias] = useState(0.02);
  const [sunShadowMapSize, setSunShadowMapSize] = useState(2048);
  const [sunShadowCamSize, setSunShadowCamSize] = useState(200);

  // Sun Orbit Params
  const [sunOrbitRadius, setSunOrbitRadius] = useState(300);
  const [sunOrbitSpeed, setSunOrbitSpeed] = useState(0.025);
  const [sunTimeOffset, setSunTimeOffset] = useState(0.0);
  const skipPost = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('noPP');
  }, []);
  const debugMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  }, []);
  const mapMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'map';
  }, []);
  const autoStart = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('autostart');
  }, []);

  useEffect(() => {
    console.log('[WorldStore] Initialized', useWorldStore.getState());
  }, []);

  // Debug/automation hooks (used by scripted visual inspection).
  // These are intentionally global so external tools can poll readiness without DOM coupling.
  useEffect(() => {
    (window as any).__vcTerrainLoaded = terrainLoaded;
    (window as any).__vcGameStarted = gameStarted;
  }, [terrainLoaded, gameStarted]);

  useEffect(() => {
    // Keep the title informative so screenshots/logs can be correlated to load state.
    document.title = `VoxelCraft ${terrainLoaded ? 'Loaded' : 'Loading'} ${gameStarted ? 'Started' : 'Menu'}`;
  }, [terrainLoaded, gameStarted]);

  // Sun direction is updated live by SunFollower (mutable vector).
  // This keeps water highlights + future IBL in sync with the actual sun orbit.
  const sunDirection = useMemo(() => new THREE.Vector3(50, 100, 30).normalize(), []);

  /**
   * Finds a deterministic-ish spawn point for a requested biome by scanning a small area
   * around the origin. This exists purely for debugging/verification (e.g. headless captures).
   */
  const findSpawnForBiome = useCallback((target: BiomeType): { x: number; z: number } | null => {
    const MAX_RADIUS = 4096;
    const STEP = 64;
    const originX = 16;
    const originZ = 16;

    // Spiral-ish scan (rings) so we find close hits first.
    for (let r = 0; r <= MAX_RADIUS; r += STEP) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = originX + Math.cos(a) * r;
        const z = originZ + Math.sin(a) * r;
        const biome = BiomeManager.getBiomeAt(x, z);
        if (biome === target) return { x, z };
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedBiome = params.get('vcSpawnBiome') as BiomeType | null;

    let x = 16;
    let z = 16;

    if (requestedBiome) {
      const found = findSpawnForBiome(requestedBiome);
      if (found) {
        x = found.x;
        z = found.z;
      }
    }

    const h = TerrainService.getHeightAt(x, z);
    setSpawnPos([x, h + 5, z]);
  }, [findSpawnForBiome]);

  // Debug flow: allow bypassing the world selection + enter click for automated checks.
  useEffect(() => {
    if (!autoStart) return;
    if (!worldType) setWorldType(WorldType.DEFAULT);
  }, [autoStart, worldType]);

  useEffect(() => {
    if (!autoStart) return;
    if (!worldType) return;
    if (!terrainLoaded) return;
    if (!gameStarted) setGameStarted(true);
  }, [autoStart, worldType, terrainLoaded, gameStarted]);

  const handleUnlock = useCallback(() => {
    setIsInteracting(false);
    setAction(null);
  }, []);

  if (mapMode) {
    return <MapDebug />;
  }

  // Leva UI scaling is applied via CSS transform on the Leva root.
  useEffect(() => {
    document.documentElement.style.setProperty('--vc-leva-scale', String(levaScale));
  }, [levaScale]);

  return (
    <div className="w-full h-full relative bg-sky-300">
      {/* Leva sizing/scaling helpers for readability in debug mode */}
      {debugMode && (
        <style>{`
          #leva__root {
            transform: scale(var(--vc-leva-scale, 1));
            transform-origin: top right;
          }
        `}</style>
      )}
      {/* Leva controls - visible only in debug mode or if you prefer always on in dev */}
      <Leva
        hidden={!debugMode}
        theme={{
          // Wider + slightly larger base text for readability.
          sizes: { rootWidth: `${levaWidth}px` },
          fontSizes: { root: '14px' }
        }}
      />
      {debugMode && (
        <DebugControls
          setDebugShadowsEnabled={setDebugShadowsEnabled}
          setTriplanarDetail={setTriplanarDetail}
          setPostProcessingEnabled={setPostProcessingEnabled}
          setAoEnabled={setAoEnabled}
          setAoIntensity={setAoIntensity}
          setBloomIntensity={setBloomIntensity}
          setBloomThreshold={setBloomThreshold}
          setExposureSurface={setExposureSurface}
          setExposureCaveMax={setExposureCaveMax}
          setExposureUnderwater={setExposureUnderwater}
          setFogNear={setFogNear}
          setFogFar={setFogFar}
          setSunIntensityMul={setSunIntensityMul}
          setAmbientIntensityMul={setAmbientIntensityMul}
          setMoonIntensityMul={setMoonIntensityMul}
          setIblEnabled={setIblEnabled}
          setIblIntensity={setIblIntensity}
          setTerrainShaderFogEnabled={setTerrainShaderFogEnabled}
          setTerrainShaderFogStrength={setTerrainShaderFogStrength}
          setTerrainThreeFogEnabled={setTerrainThreeFogEnabled}
          setTerrainFadeEnabled={setTerrainFadeEnabled}
          setTerrainWetnessEnabled={setTerrainWetnessEnabled}
          setTerrainMossEnabled={setTerrainMossEnabled}
          setTerrainRoughnessMin={setTerrainRoughnessMin}
          setBedrockPlaneEnabled={setBedrockPlaneEnabled}
          setTerrainPolygonOffsetEnabled={setTerrainPolygonOffsetEnabled}
          setTerrainPolygonOffsetFactor={setTerrainPolygonOffsetFactor}
          setTerrainPolygonOffsetUnits={setTerrainPolygonOffsetUnits}
          setLevaScale={setLevaScale}
          setLevaWidth={setLevaWidth}
          setTerrainChunkTintEnabled={setTerrainChunkTintEnabled}
          setTerrainWireframeEnabled={setTerrainWireframeEnabled}
          setTerrainWeightsView={setTerrainWeightsView}
          setCaOffset={setCaOffset}
          setVignetteDarkness={setVignetteDarkness}
          setSunShadowBias={setSunShadowBias}
          setSunShadowNormalBias={setSunShadowNormalBias}
          setSunShadowMapSize={setSunShadowMapSize}
          setSunShadowCamSize={setSunShadowCamSize}
          setSunOrbitRadius={setSunOrbitRadius}
          setSunOrbitSpeed={setSunOrbitSpeed}
          setSunTimeOffset={setSunTimeOffset}
          values={{
            debugShadowsEnabled,
            triplanarDetail,
            postProcessingEnabled,
            aoEnabled,
            aoIntensity,
            bloomIntensity,
            bloomThreshold,
            exposureSurface,
            exposureCaveMax,
            exposureUnderwater,
            fogNear,
            fogFar,
            sunIntensityMul,
            ambientIntensityMul,
            moonIntensityMul,
            iblEnabled,
            iblIntensity,
            terrainShaderFogEnabled,
            terrainShaderFogStrength,
            terrainThreeFogEnabled,
            terrainFadeEnabled,
            terrainWetnessEnabled,
            terrainMossEnabled,
            terrainRoughnessMin,
            bedrockPlaneEnabled,
            terrainPolygonOffsetEnabled,
            terrainPolygonOffsetFactor,
            terrainPolygonOffsetUnits,
            levaScale,
            levaWidth,
            terrainChunkTintEnabled,
            terrainWireframeEnabled,
            terrainWeightsView,
            caOffset,
            vignetteDarkness,
            sunShadowBias,
            sunShadowNormalBias,
            sunShadowMapSize,
            sunShadowCamSize,
            sunOrbitRadius,
            sunOrbitSpeed,
            sunTimeOffset
          }}
        />
      )}

      {!worldType ? (
        <WorldSelectionScreen onSelect={setWorldType} />
      ) : (
        !gameStarted && (
          <StartupScreen
            loaded={terrainLoaded}
            onEnter={() => setGameStarted(true)}
          />
        )
      )}
      <KeyboardControls map={keyboardMap}>
        <Canvas
          // Debug: allow toggling shadows to isolate shadow-map shimmer vs shader noise.
          shadows={debugShadowsEnabled}
          dpr={resolutionScale * (typeof window !== 'undefined' ? window.devicePixelRatio : 1)}
          gl={{
            antialias: false, // Post-processing handles AA usually, keeps edges crisp
            outputColorSpace: THREE.SRGBColorSpace,
            // CRITICAL: Disable default tone mapping so EffectComposer can handle it
            toneMapping: THREE.NoToneMapping
          }}
          // Keep far plane large enough to include the Sun/Moon (r=300) + buffer
          camera={{ fov: 75, near: 0.1, far: 600 }}
        >
          <DebugGL skipPost={skipPost} />

          {/* --- 1. ATMOSPHERE & LIGHTING (Aetherial & Immersive) --- */}

          {/* Background: Fallback color, SkyDome renders gradient sky */}
          <color attach="background" args={['#87CEEB']} />

          {/* Fog: Strong fog starting close to camera to hide terrain generation - color updated by AtmosphereController */}
          <fog attach="fog" args={['#87CEEB', fogNear, fogFar * viewDistance]} />

          {/* Ambient: Softer base to let point lights shine */}
          <AmbientController intensityMul={ambientIntensityMul} />

          {/* Atmosphere Controller: Renders gradient SkyDome and updates fog/hemisphere light colors */}
          <AtmosphereController baseFogNear={fogNear} baseFogFar={fogFar * viewDistance} />

          {/* Sun: Strong directional light */}
          <SunFollower
            sunDirection={sunDirection}
            intensityMul={sunIntensityMul}
            shadowConfig={{
              bias: sunShadowBias,
              normalBias: sunShadowNormalBias,
              mapSize: sunShadowMapSize,
              camSize: sunShadowCamSize
            }}
            orbitConfig={{
              radius: sunOrbitRadius,
              speed: sunOrbitSpeed,
              offset: sunTimeOffset
            }}
          />

          {/* Moon: Subtle night lighting */}
          <MoonFollower
            intensityMul={moonIntensityMul}
            orbitConfig={{
              radius: sunOrbitRadius,
              speed: sunOrbitSpeed,
              offset: sunTimeOffset
            }}
          />

          {/* Dynamic IBL: time-of-day aware environment reflections for PBR materials. */}
          <DynamicEnvironmentIBL sunDirection={sunDirection} enabled={iblEnabled} intensity={iblIntensity} />

          {/* --- 2. GAME WORLD --- */}

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {gameStarted && spawnPos && <Player position={spawnPos} />}
              {!gameStarted && <CinematicCamera spawnPos={spawnPos} />}

              {/* Ambient life: fireflies + distant fog deer silhouettes (no new assets). */}
              <AmbientLife enabled={gameStarted} />

              {worldType && (
                <VoxelTerrain
                  action={action}
                  isInteracting={isInteracting}
                  sunDirection={sunDirection}
                  triplanarDetail={triplanarDetail}
                  terrainShaderFogEnabled={terrainShaderFogEnabled}
                  terrainShaderFogStrength={terrainShaderFogStrength}
                  terrainThreeFogEnabled={terrainThreeFogEnabled}
                  terrainFadeEnabled={terrainFadeEnabled}
                  terrainWetnessEnabled={terrainWetnessEnabled}
                  terrainMossEnabled={terrainMossEnabled}
                  terrainRoughnessMin={terrainRoughnessMin}
                  terrainPolygonOffsetEnabled={terrainPolygonOffsetEnabled}
                  terrainPolygonOffsetFactor={terrainPolygonOffsetFactor}
                  terrainPolygonOffsetUnits={terrainPolygonOffsetUnits}
                  terrainChunkTintEnabled={terrainChunkTintEnabled}
                  terrainWireframeEnabled={terrainWireframeEnabled}
                  terrainWeightsView={terrainWeightsView}
                  onInitialLoad={() => setTerrainLoaded(true)}
                  worldType={worldType}
                />
              )}
              <FloraPlacer />
              {bedrockPlaneEnabled && <BedrockPlane />}
              <PhysicsItemRenderer />
            </Physics>
            {/* Add FirstPersonTools here, outside Physics but inside Canvas/Suspense if needed, or just inside Canvas */}
            <FirstPersonTools />
          </Suspense>

          {/* --- 3. POST-PROCESSING (Vibrant Polish) --- */}
          {/* Debug: allow toggling postprocessing to isolate N8AO/bloom shimmer vs base shading. */}
          {!skipPost && postProcessingEnabled ? (
            <EffectComposer>
              {/* N8AO: Adds depth to the voxels without darkening the whole screen too much.
                   distanceFalloff helps prevent artifacts at sky/infinity. 
                   halfRes fixes black frame issues on high-DPI/Mac devices.
               */}
              {aoEnabled && (
                <N8AO
                  halfRes
                  quality="performance"
                  intensity={aoIntensity}
                  color="black"
                  aoRadius={2.0}
                  distanceFalloff={200}
                  screenSpaceRadius={false}
                />
              )}

              {/* Bloom: Gentle glow for sky and water highlights */}
              {bloomEnabled && <Bloom luminanceThreshold={bloomThreshold} mipmapBlur intensity={bloomIntensity} />}

              {/* ToneMapping: Exposure shifts in caves for natural "looking out" brightness */}
              <ExposureToneMapping
                surfaceExposure={exposureSurface}
                caveExposureMax={exposureCaveMax}
                underwaterExposure={exposureUnderwater}
              />

              {/* Cinematic Polish: Chromatic Aberration simulates lens imperfection, giving a subtle "motion" feel at edges without velocity cost */}
              <ChromaticAberration
                offset={[caOffset * 0.1, caOffset * 0.1]}
                radialModulation={true}
                modulationOffset={0}
              />

              {/* Vignette: Focuses eyes on center, premium feel */}
              <Vignette eskil={false} offset={0.1} darkness={vignetteDarkness} />
            </EffectComposer>
          ) : null}

          {gameStarted && inputMode === 'mouse' && <PointerLockControls onUnlock={handleUnlock} />}
          {gameStarted && inputMode === 'touch' && <TouchCameraControls />}
        </Canvas>

        {gameStarted && (
          <>
            <InteractionHandler setInteracting={setIsInteracting} setAction={setAction} />
            <InventoryInput enabled={gameStarted} />
            <UI />
          </>
        )}
      </KeyboardControls>
      <TouchControls />
      <SettingsMenu />
    </div>
  );
};

export default App;
