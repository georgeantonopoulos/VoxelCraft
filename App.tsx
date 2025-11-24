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
 * Calculates sky gradient colors (top/zenith and bottom/horizon) based on sun height.
 * Returns colors that create a realistic sky gradient transitioning from zenith to horizon.
 */
const getSkyGradient = (sunY: number, radius: number): { top: THREE.Color, bottom: THREE.Color } => {
  const normalizedHeight = sunY / radius;
  
  // Night: Deep dark blue at top, slightly lighter at horizon
  const nightTop = new THREE.Color(0x020210); 
  const nightBottom = new THREE.Color(0x101025);

  // Sunrise/Sunset: Deep blue at top, vibrant orange/pink at horizon
  const sunsetTop = new THREE.Color(0x2c3e50);
  const sunsetBottom = new THREE.Color(0xff6b6b);

  // Day: Rich sky blue at top, pale blue at horizon
  const dayTop = new THREE.Color(0x1e90ff);
  const dayBottom = new THREE.Color(0x87CEEB);

  if (normalizedHeight < -0.1) {
    return { top: nightTop, bottom: nightBottom };
  } else if (normalizedHeight < 0.2) {
    const t = (normalizedHeight + 0.1) / 0.3; 
    const top = new THREE.Color().lerpColors(nightTop, sunsetTop, t);
    const bottom = new THREE.Color().lerpColors(nightBottom, sunsetBottom, t);
    return { top, bottom };
  } else if (normalizedHeight < 0.5) {
    const t = (normalizedHeight - 0.2) / 0.3;
    const top = new THREE.Color().lerpColors(sunsetTop, dayTop, t);
    const bottom = new THREE.Color().lerpColors(sunsetBottom, dayBottom, t);
    return { top, bottom };
  } else {
    return { top: dayTop, bottom: dayBottom };
  }
};

/**
 * SkyDome component that renders a gradient sky sphere.
 * The gradient transitions from top (zenith) to bottom (horizon) colors.
 */
const SkyDome: React.FC<{ 
  topColor: THREE.Color, 
  bottomColor: THREE.Color 
}> = ({ topColor, bottomColor }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const uniforms = useMemo(() => ({
    uTopColor: { value: new THREE.Color() },
    uBottomColor: { value: new THREE.Color() },
    uExponent: { value: 0.6 }
  }), []);

  useFrame((state) => {
    if (meshRef.current) {
      // Center sky dome on camera so it always surrounds the player
      meshRef.current.position.copy(state.camera.position);
      
      const material = meshRef.current.material as THREE.ShaderMaterial;
      material.uniforms.uTopColor.value.copy(topColor);
      material.uniforms.uBottomColor.value.copy(bottomColor);
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

const SunFollower: React.FC = () => {
  const { camera } = useThree();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sunMeshRef = useRef<THREE.Mesh>(null);
  const sunMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const glowMeshRef = useRef<THREE.Mesh>(null);
  const glowMaterialRef = useRef<THREE.ShaderMaterial>(null);
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

        // Update Visual Sun color and glow
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
           
           // Update glow - make it more visible during sunset
           if (glowMeshRef.current && glowMaterialRef.current) {
             // Position glow at sun location
             glowMeshRef.current.position.copy(sunMeshRef.current.position);
             
             // Make glow always face camera
             glowMeshRef.current.lookAt(camera.position);
             
             // Calculate glow intensity and size based on sun position
             const isSunset = normalizedHeight > -0.1 && normalizedHeight < 0.3;
             const glowScale = isSunset ? 5.0 : 3.5;
             const glowOpacity = isSunset ? 0.9 : 0.5;
             
             glowMeshRef.current.scale.setScalar(glowScale);
             
             // Glow color: warmer/more orange than sun core during sunset
             const glowColor = sunColor.clone();
             if (isSunset) {
               glowColor.lerp(new THREE.Color(0xff4500), 0.4); // More orange during sunset
             } else {
               glowColor.lerp(new THREE.Color(0xffd700), 0.2); // Slight golden tint during day
             }
             
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
      
      {/* Physical Sun Mesh */}
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
    
    // Use the same orbit calculation as SunFollower
    const speed = 0.025;
    const angle = t * speed;
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
