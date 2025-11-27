import React, { useState, Suspense, useEffect, useCallback, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, ToneMapping, N8AO } from '@react-three/postprocessing';
import { useControls, Leva } from 'leva';
import * as THREE from 'three';

// Components
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { FloraPlacer } from './components/FloraPlacer';
import { UI } from './components/UI';
import { StartupScreen } from './components/StartupScreen';
import { BedrockPlane } from './components/BedrockPlane';
import { useGameStore } from './services/GameManager';
import { TerrainService } from './services/terrainService';
import { setSnapEpsilon } from './constants';

// Keyboard Map
const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'shift', keys: ['Shift'] },
  { name: 'place', keys: ['e', 'E'] },
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
    if (now - lastLog.current < 2.0) return;
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

const calculateOrbitAngle = (t: number, speed: number, offset: number = 0): number => {
  const cycleTime = t * speed;
  const normalizedCycle = (cycleTime % (Math.PI * 2)) / (Math.PI * 2);
  let angle;
  if (normalizedCycle < 0.35) {
    angle = -Math.PI / 2 + (normalizedCycle / 0.35) * (Math.PI / 2);
  } else if (normalizedCycle < 0.65) {
    angle = ((normalizedCycle - 0.35) / 0.3) * (Math.PI / 2);
  } else {
    angle = Math.PI / 2 + ((normalizedCycle - 0.65) / 0.35) * Math.PI;
  }
  angle += Math.floor(cycleTime / (Math.PI * 2)) * Math.PI * 2;
  return angle + offset;
};

const getSunColor = (sunY: number, radius: number): THREE.Color => {
  const normalizedHeight = sunY / radius;
  const nightColor = new THREE.Color(0x4a5a7a);
  const sunriseSunsetColor = new THREE.Color(0xff7f42);
  const dayColor = new THREE.Color(0xfffcf0);
  if (normalizedHeight < -0.15) {
    return nightColor;
  } else if (normalizedHeight < 0.0) {
    const t = (normalizedHeight + 0.15) / 0.15;
    return new THREE.Color().lerpColors(nightColor, sunriseSunsetColor, t);
  } else if (normalizedHeight < 0.3) {
    const t = normalizedHeight / 0.3;
    return new THREE.Color().lerpColors(sunriseSunsetColor, dayColor, t);
  } else {
    return dayColor;
  }
};

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

const getSkyGradient = (sunY: number, radius: number): { top: THREE.Color, bottom: THREE.Color } => {
  const normalizedHeight = sunY / radius;
  const nightTop = new THREE.Color(0x020210); 
  const nightBottom = new THREE.Color(0x101025);
  const sunsetTop = new THREE.Color(0x2c3e50);
  const sunsetBottom = new THREE.Color(0xff8c42);
  const dayTop = new THREE.Color(0x1e90ff);
  const dayBottom = new THREE.Color(0x87CEEB);

  if (normalizedHeight < -0.15) {
    return { top: nightTop, bottom: nightBottom };
  } else if (normalizedHeight < 0.0) {
    const t = (normalizedHeight + 0.15) / 0.15;
    return {
      top: new THREE.Color().lerpColors(nightTop, sunsetTop, t),
      bottom: new THREE.Color().lerpColors(nightBottom, sunsetBottom, t)
    };
  } else if (normalizedHeight < 0.3) {
    const t = normalizedHeight / 0.3;
    return {
      top: new THREE.Color().lerpColors(sunsetTop, dayTop, t),
      bottom: new THREE.Color().lerpColors(sunsetBottom, dayBottom, t)
    };
  } else {
    return { top: dayTop, bottom: dayBottom };
  }
};

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
  
  const smoothSunPos = useRef(new THREE.Vector3());
  const lastCameraPos = useRef(new THREE.Vector3());

  useEffect(() => {
    lastCameraPos.current.copy(camera.position);
    smoothSunPos.current.set(0, 0, 0);
  }, [camera]);

  useFrame(({ clock }) => {
    if (lightRef.current) {
        const t = clock.getElapsedTime();
        const speed = 0.025;
        const angle = calculateOrbitAngle(t, speed);
        const radius = 300;
        const sx = Math.sin(angle) * radius;
        const sy = Math.cos(angle) * radius; 
        const sz = 30; 

        const cameraDelta = camera.position.clone().sub(lastCameraPos.current);
        smoothSunPos.current.add(cameraDelta);
        lastCameraPos.current.copy(camera.position);
        
        const sunDist = 350;
        const targetSunPos = new THREE.Vector3(
          smoothSunPos.current.x + Math.sin(angle) * sunDist,
          Math.cos(angle) * sunDist,
          smoothSunPos.current.z + sz
        );

        const q = 4;
        const lx = Math.round(camera.position.x / q) * q;
        const lz = Math.round(camera.position.z / q) * q;
        
        lightRef.current.position.set(lx + sx, sy, lz + sz);
        target.position.set(lx, 0, lz);
        
        lightRef.current.target = target;
        lightRef.current.updateMatrixWorld();
        target.updateMatrixWorld();
        
        const sunColor = getSunColor(sy, radius);
        lightRef.current.color.copy(sunColor);
        
        const normalizedHeight = sy / radius;
        if (normalizedHeight < -0.15) {
          lightRef.current.intensity = 0.1;
        } else if (normalizedHeight < 0.0) {
          const t = (normalizedHeight + 0.15) / 0.15;
          lightRef.current.intensity = 0.1 + (0.4 - 0.1) * t; 
        } else if (normalizedHeight < 0.3) {
          const t = normalizedHeight / 0.3;
          lightRef.current.intensity = 0.4 + (1.0 - 0.4) * t;
        } else {
          lightRef.current.intensity = 1.0;
        }

        if (sunMeshRef.current) {
           sunMeshRef.current.position.copy(targetSunPos);
           sunMeshRef.current.lookAt(camera.position);
           
           if (sunMaterialRef.current) {
             const sunMeshColor = sunColor.clone();
             if (normalizedHeight < -0.15) {
               sunMeshColor.multiplyScalar(0.4);
             } else if (normalizedHeight < 0.0) {
               const t = (normalizedHeight + 0.15) / 0.15;
               sunMeshColor.multiplyScalar(0.4 + (1.2 - 0.4) * t);
             } else {
               sunMeshColor.multiplyScalar(1.5);
             }
             sunMaterialRef.current.color.copy(sunMeshColor);
           }
           
          if (glowMeshRef.current && glowMaterialRef.current) {
            glowMeshRef.current.position.copy(targetSunPos);
            glowMeshRef.current.lookAt(camera.position);
            
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
        shadow-bias={-0.001} 
        shadow-normalBias={0.08}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
      />
      <primitive object={target} />
      
      <mesh ref={sunMeshRef}>
         <sphereGeometry args={[15, 32, 32]} />
         <meshBasicMaterial 
           ref={sunMaterialRef}
           color="#fffee0" 
           toneMapped={false} 
           fog={false}
         />
      </mesh>
      
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

const MoonFollower: React.FC = () => {
  const { camera } = useThree();
  const moonMeshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!moonMeshRef.current || !lightRef.current) return;

    const t = clock.getElapsedTime();
    const radius = 300;
    const speed = 0.025;
    const angle = calculateOrbitAngle(t, speed, Math.PI);
    const x = Math.sin(angle) * radius;
    const y = Math.cos(angle) * radius;
    const px = camera.position.x + x;
    const py = y;
    const pz = camera.position.z + 30;

    moonMeshRef.current.position.set(px, py, pz);
    lightRef.current.position.set(px, py, pz);
    target.position.set(camera.position.x, 0, camera.position.z);
    lightRef.current.target = target;
    lightRef.current.updateMatrixWorld();

    const isAboveHorizon = py > -50;
    moonMeshRef.current.visible = isAboveHorizon;
    lightRef.current.intensity = isAboveHorizon ? 0.2 : 0;
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

      <mesh ref={moonMeshRef}>
        <sphereGeometry args={[20, 32, 32]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </>
  );
};

const AtmosphereController: React.FC = () => {
  const { scene } = useThree();
  const hemisphereLightRef = useRef<THREE.HemisphereLight>(null);
  const gradientRef = useRef<{ top: THREE.Color, bottom: THREE.Color }>({
    top: new THREE.Color('#87CEEB'),
    bottom: new THREE.Color('#87CEEB')
  });

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const speed = 0.025;
    const angle = calculateOrbitAngle(t, speed);
    const radius = 300;
    const sy = Math.cos(angle) * radius;
    const { top, bottom } = getSkyGradient(sy, radius);
    
    gradientRef.current.top.copy(top);
    gradientRef.current.bottom.copy(bottom);
    
    const fog = scene.fog as THREE.Fog | undefined;
    if (fog) {
      fog.color.copy(bottom);
    }
    
    if (hemisphereLightRef.current) {
      const normalizedHeight = sy / radius;
      hemisphereLightRef.current.color.copy(top);
      
      if (normalizedHeight < -0.1) {
        hemisphereLightRef.current.groundColor.set(0x1a1a2a);
      } else if (normalizedHeight < 0.2) {
        hemisphereLightRef.current.groundColor.set(0x3a2a2a);
      } else {
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

const SkyDomeRefLink: React.FC<{ 
  gradientRef: React.MutableRefObject<{ top: THREE.Color, bottom: THREE.Color }> 
}> = ({ gradientRef }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  
  const uniforms = useMemo(() => ({
    uTopColor: { value: new THREE.Color('#87CEEB') },
    uBottomColor: { value: new THREE.Color('#87CEEB') },
    uExponent: { value: 0.6 }
  }), []);
  
  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.position.copy(state.camera.position);
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
     angle.current += delta * 0.05;
     const radius = 60;
     const centerX = 16;
     const centerZ = 16;
     
     const targetY = spawnPos ? spawnPos[1] : 20;
     const camY = targetY + 40;

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
  const placeFlora = useGameStore(s => s.placeFlora);

  const handleInitialLoad = useCallback(() => {
    setTerrainLoaded(true);
  }, []);

  const skipPost = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('noPP');
  }, []);
  const debugMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('debug');
  }, []);

  const sunDirection = useMemo(() => new THREE.Vector3(50, 100, 30).normalize(), []);

  useEffect(() => {
      setSpawnPos([10, 20, 10]);
  }, []);

  const handleUnlock = useCallback(() => {
    setIsInteracting(false);
    setAction(null);
  }, []);

  return (
    <div className="w-full h-full relative bg-sky-300">
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
            antialias: false,
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.NoToneMapping
          }}
          camera={{ fov: 60, near: 0.1, far: 400 }}
        >
          {gameStarted && <DebugGL skipPost={skipPost} />}
          
          <color attach="background" args={['#87CEEB']} />
          {/* <fog attach="fog" args={['#87CEEB', 15, 150]} /> */}
          <ambientLight intensity={2.0} color="#ccccff" />
          {/* <AtmosphereController /> */}
          <SunFollower />
          <MoonFollower />
          
          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {gameStarted && spawnPos && <Player position={spawnPos} onPlaceFlora={placeFlora} />}
              {!gameStarted && <CinematicCamera spawnPos={spawnPos} />}
              
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
                onInitialLoad={handleInitialLoad}
              />
              <FloraPlacer />
              <BedrockPlane />
            </Physics>
          </Suspense>

          {!skipPost ? (
            <EffectComposer>
               <N8AO 
                 halfRes
                 quality="performance"
                 intensity={2.0} 
                 color="black" 
                 aoRadius={2.0} 
                 distanceFalloff={200}
                 screenSpaceRadius={false}
               />
               <Bloom luminanceThreshold={0.8} mipmapBlur intensity={0.6} />
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