import React, { useState, Suspense, useEffect, useCallback, useMemo, useRef } from 'react';
import { MapDebug } from '@/ui/MapDebug';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, ToneMapping, N8AO } from '@react-three/postprocessing';
import { useControls, Leva } from 'leva';
import * as THREE from 'three';

// Components
// Components
import { VoxelTerrain } from '@features/terrain/components/VoxelTerrain';
import { Player } from '@features/player/Player';
import { FloraPlacer } from '@features/flora/components/FloraPlacer';
import { HUD as UI } from '@ui/HUD';
import { StartupScreen } from '@ui/StartupScreen';
import { BedrockPlane } from '@features/terrain/components/BedrockPlane';
import { TerrainService } from '@features/terrain/logic/terrainService';
import { setSnapEpsilon } from '@/constants';
import { useWorldStore } from '@state/WorldStore';
import { FirstPersonTools } from '@features/interaction/components/FirstPersonTools';

// Keyboard Map
const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'shift', keys: ['Shift'] },
];

const InteractionLayer: React.FC<{
  setInteracting: (v: boolean) => void,
  setAction: (a: 'DIG' | 'BUILD' | null) => void
}> = ({ setInteracting, setAction }) => {
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Only allow interaction if we are locked (gameplay) OR if we are clicking canvas (handled by pointer lock check)
      // But typically we want to interact when locked.
      if (!document.pointerLockElement) return;
      if (e.button === 0) setAction('DIG');
      if (e.button === 2) setAction('BUILD');
      setInteracting(true);
    };

    const handleMouseUp = () => {
      setInteracting(false);
      setAction(null);
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', (e) => e.preventDefault());
    };
  }, [setInteracting, setAction]);

  return null;
};

const DebugControls = () => {
  useControls({
    snapEpsilon: {
      value: 0.02,
      min: 0.01,
      max: 0.15,
      step: 0.01,
      onChange: (v) => setSnapEpsilon(v),
      label: 'Snap Epsilon (Hysteresis)'
    }
  });
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


const SunFollower: React.FC = () => {
  const { camera } = useThree();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sunMeshRef = useRef<THREE.Mesh>(null);
  const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const glowMeshRef = useRef<THREE.Mesh>(null);
  const glowMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

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
      const t = clock.getElapsedTime();

      // Slow orbit (Cycle every ~8-10 minutes)
      const speed = 0.025; // 1/4th of previous 0.1

      // Non-linear angle mapping to make day longer and night shorter
      const angle = calculateOrbitAngle(t, speed);

      // Radius of orbit relative to player
      const radius = 300;
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

      // Calculate sun color based on height
      const sunColor = getSunColor(sy, radius);

      // Update light color
      lightRef.current.color.copy(sunColor);

      // Adjust intensity: fade out smoothly when below horizon
      const normalizedHeight = sy / radius;
      if (normalizedHeight < -0.15) {
        // Deep night: darker
        lightRef.current.intensity = 0.1;
      } else if (normalizedHeight < 0.0) {
        // Transition from Night to Sunset
        const t = (normalizedHeight + 0.15) / 0.15; // 0 to 1
        lightRef.current.intensity = 0.1 + (0.4 - 0.1) * t;
      } else if (normalizedHeight < 0.3) {
        // Sunset to Day
        const t = normalizedHeight / 0.3; // 0 to 1
        lightRef.current.intensity = 0.4 + (1.0 - 0.4) * t;
      } else {
        // Day: full intensity
        lightRef.current.intensity = 1.0;
      }

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
          const glowOpacity = isSunset ? 0.9 : (normalizedHeight < -0.15 ? 0.2 : 0.5);

          glowMeshRef.current.scale.setScalar(glowScale);

          const glowColor = getSunGlowColor(normalizedHeight, sunColor);
          glowMaterialRef.current.uniforms.uColor.value.copy(glowColor);
          glowMaterialRef.current.uniforms.uOpacity.value = glowOpacity;
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
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
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

      {/* Sun Glow Billboard - Always faces camera, more visible during sunset */}
      <mesh ref={glowMeshRef}>
        <planeGeometry args={[40, 40]} />
        <shaderMaterial
          ref={glowMaterialRef}
          transparent
          depthWrite={false}
          fog={false}
          uniforms={{
            uColor: { value: new THREE.Color() },
            uOpacity: { value: 0.5 }
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
            varying vec2 vUv;
            void main() {
              float d = distance(vUv, vec2(0.5));
              float glow = 1.0 - smoothstep(0.0, 0.5, d);
              glow = pow(glow, 2.5);
              gl_FragColor = vec4(uColor, glow * uOpacity);
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
const MoonFollower: React.FC = () => {
  const { camera } = useThree();
  const moonMeshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!moonMeshRef.current || !lightRef.current) return;

    const t = clock.getElapsedTime();
    const radius = 300; // Distance from player
    const speed = 0.025; // MUST match Sun speed to stay opposite

    // ROTATION: Exact opposite of Sun (add Math.PI for 180° offset)
    const angle = calculateOrbitAngle(t, speed, Math.PI);

    // Calculate position
    const x = Math.sin(angle) * radius;
    const y = Math.cos(angle) * radius;

    // Position the moon relative to the camera (so you can't walk past it)
    const px = camera.position.x + x;
    const py = y; // Keep height absolute relative to horizon
    const pz = camera.position.z + 30; // Slight Z offset

    // Apply positions
    moonMeshRef.current.position.set(px, py, pz);

    // Move the directional light with the mesh
    lightRef.current.position.set(px, py, pz);
    target.position.set(camera.position.x, 0, camera.position.z);
    lightRef.current.target = target;
    lightRef.current.updateMatrixWorld();

    // VISIBILITY: Only visible when above the horizon
    const isAboveHorizon = py > -50; // Buffer of -50 allows it to set smoothly
    moonMeshRef.current.visible = isAboveHorizon;
    lightRef.current.intensity = isAboveHorizon ? 0.2 : 0; // Dim light
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

      {/* Simple White Sphere */}
      <mesh ref={moonMeshRef}>
        <sphereGeometry args={[20, 32, 32]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </>
  );
};

/**
 * Controls fog, background, hemisphere light colors, and sky gradient based on sun position.
 * Renders the SkyDome with dynamic gradients and updates fog to match horizon color.
 */
const AtmosphereController: React.FC = () => {
  const { scene } = useThree();
  const hemisphereLightRef = useRef<THREE.HemisphereLight>(null);
  const gradientRef = useRef<{ top: THREE.Color, bottom: THREE.Color }>({
    top: new THREE.Color('#87CEEB'),
    bottom: new THREE.Color('#87CEEB')
  });

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    // Use the same non-linear orbit calculation as SunFollower
    const speed = 0.025;
    const angle = calculateOrbitAngle(t, speed);
    const radius = 300;
    const sy = Math.cos(angle) * radius;

    // Calculate sky gradient colors based on sun position
    const { top, bottom } = getSkyGradient(sy, radius);

    // Update gradient ref for SkyDome
    gradientRef.current.top.copy(top);
    gradientRef.current.bottom.copy(bottom);

    // Update fog color to match horizon (bottom) color for seamless blending
    const fog = scene.fog as THREE.Fog | undefined;
    if (fog) {
      fog.color.copy(bottom);
    }

    // Update hemisphere light colors to match atmosphere
    if (hemisphereLightRef.current) {
      const normalizedHeight = sy / radius;
      hemisphereLightRef.current.color.copy(top);

      if (normalizedHeight < -0.1) {
        // Night: darker ground
        hemisphereLightRef.current.groundColor.set(0x1a1a2a);
      } else if (normalizedHeight < 0.2) {
        // Sunrise/sunset: warmer ground
        hemisphereLightRef.current.groundColor.set(0x3a2a2a);
      } else {
        // Day: darker ground for contrast
        hemisphereLightRef.current.groundColor.set(0x2a2a4a);
      }
    }
  });

  return (
    <>
      <hemisphereLight
        ref={hemisphereLightRef}
        args={['#87CEEB', '#2a2a4a', 0.5]}
      />
      <SkyDomeRefLink gradientRef={gradientRef} />
    </>
  );
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

  useEffect(() => {
    console.log('[WorldStore] Initialized', useWorldStore.getState());
  }, []);

  // Sun direction for shadows (High Noon-ish for vibrancy)
  const sunDirection = useMemo(() => new THREE.Vector3(50, 100, 30).normalize(), []);

  useEffect(() => {
    const h = TerrainService.getHeightAt(16, 16);
    setSpawnPos([16, h + 5, 16]);
  }, []);

  const handleUnlock = useCallback(() => {
    setIsInteracting(false);
    setAction(null);
  }, []);

  if (mapMode) {
    return <MapDebug />;
  }

  return (
    <div className="w-full h-full relative bg-sky-300">
      {/* Leva controls - visible only in debug mode or if you prefer always on in dev */}
      <Leva hidden={!debugMode} />
      {debugMode && <DebugControls />}

      {!gameStarted && (
        <StartupScreen
          loaded={terrainLoaded}
          onEnter={() => setGameStarted(true)}
        />
      )}
      <KeyboardControls map={keyboardMap}>
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{
            antialias: false, // Post-processing handles AA usually, keeps edges crisp
            outputColorSpace: THREE.SRGBColorSpace,
            // CRITICAL: Disable default tone mapping so EffectComposer can handle it
            toneMapping: THREE.NoToneMapping
          }}
          camera={{ fov: 75, near: 0.1, far: 400 }}
        >
          <DebugGL skipPost={skipPost} />

          {/* --- 1. ATMOSPHERE & LIGHTING (Aetherial & Immersive) --- */}

          {/* Background: Fallback color, SkyDome renders gradient sky */}
          <color attach="background" args={['#87CEEB']} />

          {/* Fog: Strong fog starting close to camera to hide terrain generation - color updated by AtmosphereController */}
          <fog attach="fog" args={['#87CEEB', 15, 150]} />

          {/* Ambient: Softer base to let point lights shine */}
          <ambientLight intensity={0.3} color="#ccccff" />

          {/* Atmosphere Controller: Renders gradient SkyDome and updates fog/hemisphere light colors */}
          <AtmosphereController />

          {/* Sun: Strong directional light */}
          <SunFollower />

          {/* Moon: Subtle night lighting */}
          <MoonFollower />

          {/* --- 2. GAME WORLD --- */}

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {gameStarted && spawnPos && <Player position={spawnPos} />}
              {!gameStarted && <CinematicCamera spawnPos={spawnPos} />}

              <VoxelTerrain
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
                onInitialLoad={() => setTerrainLoaded(true)}
              />
              <FloraPlacer />
              <BedrockPlane />
            </Physics>
            {/* Add FirstPersonTools here, outside Physics but inside Canvas/Suspense if needed, or just inside Canvas */}
            <FirstPersonTools />
          </Suspense>

          {/* --- 3. POST-PROCESSING (Vibrant Polish) --- */}
          {!skipPost ? (
            <EffectComposer>
              {/* N8AO: Adds depth to the voxels without darkening the whole screen too much.
                   distanceFalloff helps prevent artifacts at sky/infinity. 
                   halfRes fixes black frame issues on high-DPI/Mac devices.
               */}
              <N8AO
                halfRes
                quality="performance"
                intensity={2.0}
                color="black"
                aoRadius={2.0}
                distanceFalloff={200}
                screenSpaceRadius={false}
              />

              {/* Bloom: Gentle glow for sky and water highlights */}
              <Bloom luminanceThreshold={0.8} mipmapBlur intensity={0.6} />

              {/* ToneMapping: Handles High Dynamic Range without washing out colors */}
              <ToneMapping />
            </EffectComposer>
          ) : (
            <primitive object={null} />
          )}

          {gameStarted && <PointerLockControls onUnlock={handleUnlock} />}
        </Canvas>

        {gameStarted && (
          <>
            <InteractionLayer setInteracting={setIsInteracting} setAction={setAction} />
            <UI />
          </>
        )}
      </KeyboardControls>
    </div>
  );
};

export default App;
