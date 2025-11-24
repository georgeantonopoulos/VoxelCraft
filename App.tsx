import React, { useState, Suspense, useEffect, useCallback, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, ToneMapping, N8AO } from '@react-three/postprocessing';
import * as THREE from 'three';

// Components
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { UI } from './components/UI';
import { StartupScreen } from './components/StartupScreen';
import { BedrockPlane } from './components/BedrockPlane';
import { TerrainService } from './services/terrainService';

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

const DebugGL: React.FC<{ skipPost: boolean }> = ({ skipPost }) => {
  const { gl, camera } = useThree();
  const lastLog = useRef(0);

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (now - lastLog.current < 2.0) return; // Log every 2s
    lastLog.current = now;

    const info = gl.info;
    console.log('[DebugGL] Stats:', {
       calls: info.render.calls,
       triangles: info.render.triangles,
       textures: info.memory.textures,
       geometries: info.memory.geometries,
       camPos: camera.position.toArray().map(v => Math.round(v * 10) / 10),
       camRot: camera.rotation.toArray().slice(0, 3).map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v),
       skipPost
    });
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
 * Calculates sun color based on sun height (Y position).
 * Returns a color that transitions smoothly between:
 * - Night (sun below horizon): blue and darker
 * - Sunrise/sunset (sun near horizon): orange/pink
 * - Day (sun high): white/yellow
 */
const getSunColor = (sunY: number, radius: number): THREE.Color => {
  // Normalize sun height: -1 (fully below) to 1 (noon)
  const normalizedHeight = sunY / radius;
  
  // Define color states
  const nightColor = new THREE.Color(0x4a5a7a); // Blue, darker
  const sunriseSunsetColor = new THREE.Color(0xff8c5a); // Orange/pink
  const dayColor = new THREE.Color(0xfffcf0); // White/yellow
  
  // Determine which phase we're in
  if (normalizedHeight < -0.1) {
    // Night: sun is below horizon
    return nightColor;
  } else if (normalizedHeight < 0.2) {
    // Sunrise/sunset: sun is near horizon
    // Smooth transition from night to sunrise/sunset
    const t = (normalizedHeight + 0.1) / 0.3; // 0 to 1 as sun rises
    const color = new THREE.Color();
    color.lerpColors(nightColor, sunriseSunsetColor, t);
    return color;
  } else if (normalizedHeight < 0.5) {
    // Transition from sunrise/sunset to day
    const t = (normalizedHeight - 0.2) / 0.3; // 0 to 1 as sun gets higher
    const color = new THREE.Color();
    color.lerpColors(sunriseSunsetColor, dayColor, t);
    return color;
  } else {
    // Day: sun is high
    return dayColor;
  }
};

/**
 * Calculates sky/fog color based on sun height (Y position).
 * Returns a color that transitions smoothly between:
 * - Night (sun below horizon): dark blue/purple
 * - Sunrise/sunset (sun near horizon): warm orange/pink
 * - Day (sun high): light blue
 */
const getSkyColor = (sunY: number, radius: number): THREE.Color => {
  // Normalize sun height: -1 (fully below) to 1 (noon)
  const normalizedHeight = sunY / radius;
  
  // Define sky color states (softer and more atmospheric than sun colors)
  const nightSkyColor = new THREE.Color(0x2a2a4a); // Dark blue/purple
  const sunriseSunsetSkyColor = new THREE.Color(0xffb380); // Warm orange/pink (lighter than sun)
  const daySkyColor = new THREE.Color(0x87CEEB); // Light blue (sky blue)
  
  // Determine which phase we're in
  if (normalizedHeight < -0.1) {
    // Night: sun is below horizon
    return nightSkyColor;
  } else if (normalizedHeight < 0.2) {
    // Sunrise/sunset: sun is near horizon
    // Smooth transition from night to sunrise/sunset
    const t = (normalizedHeight + 0.1) / 0.3; // 0 to 1 as sun rises
    const color = new THREE.Color();
    color.lerpColors(nightSkyColor, sunriseSunsetSkyColor, t);
    return color;
  } else if (normalizedHeight < 0.5) {
    // Transition from sunrise/sunset to day
    const t = (normalizedHeight - 0.2) / 0.3; // 0 to 1 as sun gets higher
    const color = new THREE.Color();
    color.lerpColors(sunriseSunsetSkyColor, daySkyColor, t);
    return color;
  } else {
    // Day: sun is high
    return daySkyColor;
  }
};

const SunFollower: React.FC = () => {
  const { camera } = useThree();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sunMeshRef = useRef<THREE.Mesh>(null);
  const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (lightRef.current) {
        const t = clock.getElapsedTime();
        
        // Slow orbit (Cycle every ~8-10 minutes)
        const speed = 0.025; // 1/4th of previous 0.1
        const angle = t * speed;

        // Radius of orbit relative to player
        const radius = 300; // Farther away for scale

        const sx = Math.sin(angle) * radius;
        const sy = Math.cos(angle) * radius; 
        const sz = 30; 

        // Snap light center to player
        const q = 4;
        const lx = Math.round(camera.position.x / q) * q;
        const lz = Math.round(camera.position.z / q) * q;
        
        const px = lx + sx;
        const py = sy;
        const pz = lz + sz;

        lightRef.current.position.set(px, py, pz);
        target.position.set(lx, 0, lz);
        
        lightRef.current.target = target;
        lightRef.current.updateMatrixWorld();
        target.updateMatrixWorld();
        
        // Calculate sun color based on height
        const sunColor = getSunColor(sy, radius);
        
        // Update light color
        lightRef.current.color.copy(sunColor);
        
        // Adjust intensity: fade out when below horizon, slightly dimmer at night
        const normalizedHeight = sy / radius;
        if (normalizedHeight < -0.1) {
          // Night: darker
          lightRef.current.intensity = 0.3;
        } else if (normalizedHeight < 0.2) {
          // Sunrise/sunset: moderate intensity
          lightRef.current.intensity = Math.max(0.4, (normalizedHeight + 0.1) / 0.3 * 0.8 + 0.4);
        } else {
          // Day: full intensity
          lightRef.current.intensity = Math.max(0.5, (normalizedHeight / radius) * 3.5 + 0.5);
        }

        // Update Visual Sun color
        if (sunMeshRef.current) {
           // Place sun mesh far away but in same direction
           // Use a fixed distance so it doesn't clip into terrain
           const sunDist = 350; 
           sunMeshRef.current.position.set(
              lx + Math.sin(angle) * sunDist, 
              Math.cos(angle) * sunDist, 
              lz + sz
           );
           sunMeshRef.current.lookAt(camera.position);
           
           // Update sun mesh color (slightly brighter than light for visibility)
           const sunMeshColor = sunColor.clone();
           if (normalizedHeight < -0.1) {
             // Night: make sun mesh slightly visible but dim
             sunMeshColor.multiplyScalar(0.5);
           } else {
             // Day/sunrise: bright sun
             sunMeshColor.multiplyScalar(1.2);
           }
           
           // Access material via ref or mesh
           const material = sunMaterialRef.current || (sunMeshRef.current.material as THREE.MeshBasicMaterial);
           if (material) {
             material.color.copy(sunMeshColor);
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
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
      />
      <primitive object={target} />
      
      {/* Physical Sun Mesh with Glow - Disable fog so it's always visible */}
      <mesh ref={sunMeshRef}>
         <sphereGeometry args={[15, 32, 32]} />
         <meshBasicMaterial 
           ref={sunMaterialRef}
           color="#fffee0" 
           toneMapped={false} 
           fog={false} 
         />
      </mesh>
    </>
  );
};

/**
 * Controls fog, background, and hemisphere light colors based on sun position.
 * Updates both the scene fog and canvas background to match the time of day.
 */
const AtmosphereController: React.FC = () => {
  const { scene } = useThree();
  const hemisphereLightRef = useRef<THREE.HemisphereLight>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    
    // Use the same orbit calculation as SunFollower
    const speed = 0.025;
    const angle = t * speed;
    const radius = 300;
    const sy = Math.cos(angle) * radius;
    
    // Calculate sky color based on sun position
    const skyColor = getSkyColor(sy, radius);
    
    // Update background color
    if (!scene.background) {
      scene.background = new THREE.Color();
    }
    if (scene.background instanceof THREE.Color) {
      scene.background.copy(skyColor);
    }
    
    // Update fog color
    const fog = scene.fog as THREE.Fog | undefined;
    if (fog) {
      fog.color.copy(skyColor);
    }
    
    // Update hemisphere light colors to match atmosphere
    if (hemisphereLightRef.current) {
      const normalizedHeight = sy / radius;
      if (normalizedHeight < -0.1) {
        // Night: darker sky, darker ground
        hemisphereLightRef.current.color.copy(skyColor);
        hemisphereLightRef.current.groundColor.set(0x1a1a2a);
      } else if (normalizedHeight < 0.2) {
        // Sunrise/sunset: warm sky, darker ground
        hemisphereLightRef.current.color.copy(skyColor);
        hemisphereLightRef.current.groundColor.set(0x3a2a2a);
      } else {
        // Day: bright sky, darker ground for contrast
        hemisphereLightRef.current.color.copy(skyColor);
        hemisphereLightRef.current.groundColor.set(0x2a2a4a);
      }
    }
  });

  return (
    <hemisphereLight 
      ref={hemisphereLightRef}
      args={['#87CEEB', '#2a2a4a', 0.5]} 
    />
  );
};

const CinematicCamera: React.FC<{ spawnPos: [number, number, number] | null }> = ({ spawnPos }) => {
  const { camera } = useThree();
  const angle = useRef(0);

  useFrame((state, delta) => {
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

  return (
    <div className="w-full h-full relative bg-sky-300">
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
          camera={{ fov: 60, near: 0.1, far: 400 }}
        >
          <DebugGL skipPost={skipPost} />

          {/* --- 1. ATMOSPHERE & LIGHTING (Aetherial & Immersive) --- */}
          
          {/* Sky Color: Initial value, will be updated by AtmosphereController */}
          <color attach="background" args={['#87CEEB']} />
          
          {/* Fog: Start closer for depth, fade to sky color - color updated by AtmosphereController */}
          <fog attach="fog" args={['#87CEEB', 30, 300]} />
          
          {/* Ambient: Softer base to let point lights shine */}
          <ambientLight intensity={0.3} color="#ccccff" />

          {/* Atmosphere Controller: Updates fog, background, and hemisphere light colors */}
          <AtmosphereController />

          {/* Sun: Strong directional light */}
          <SunFollower />
          
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
              <BedrockPlane />
            </Physics>
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
