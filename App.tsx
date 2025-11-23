import React, { useState, Suspense, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom, ToneMapping, N8AO } from '@react-three/postprocessing';
import * as THREE from 'three';

// Components
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { UI } from './components/UI';
import { Water } from './components/Water';
import { BedrockPlane } from './components/BedrockPlane';
import { TerrainService } from './services/terrainService';

// Keyboard Map
const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
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

const SunFollower: React.FC = () => {
  const { camera } = useThree();
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);

  // Sun direction: roughly matches [50, 100, 30] normalized
  const offset = useMemo(() => new THREE.Vector3(50, 100, 30), []);

  useFrame(() => {
    if (lightRef.current) {
        // Snap light to player position (quantized to avoid shadow jitter)
        // Quantize to e.g. 4 units
        const q = 4;
        const lx = Math.round(camera.position.x / q) * q;
        const lz = Math.round(camera.position.z / q) * q;
        
        lightRef.current.position.set(lx + offset.x, offset.y, lz + offset.z);
        target.position.set(lx, 0, lz);
        
        lightRef.current.target = target;
        lightRef.current.updateMatrixWorld();
        target.updateMatrixWorld();
    }
  });

  return (
    <>
      <directionalLight 
        ref={lightRef}
        intensity={2.2}
        color="#fffcf0" 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={0.04}
        // Expanded shadow bounds to cover view distance
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-200}
        shadow-camera-right={200}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
      />
      <primitive object={target} />
    </>
  );
};

const App: React.FC = () => {
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

          {/* --- 1. ATMOSPHERE & LIGHTING (Vibrant) --- */}
          
          {/* Sky Color: Bright Blue */}
          <color attach="background" args={['#87CEEB']} />
          
          {/* Fog: Subtle, far distance, matches sky */}
          <fog attach="fog" args={['#87CEEB', 50, 350]} />
          
          {/* Ambient: Bright base level */}
          <ambientLight intensity={0.6} color="#ffffff" />

          {/* Hemisphere: The "Secret" to outdoor lighting.
              Sky Color (Blue) vs Ground Color (Greenish)
          */}
          <hemisphereLight args={['#87CEEB', '#e3f0d5', 0.8]} />

          {/* Sun: Strong directional light */}
          <SunFollower />

          {/* --- 2. GAME WORLD --- */}
          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {spawnPos && <Player position={spawnPos} />}
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
              />
              <Water />
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
               <Bloom luminanceThreshold={1.2} mipmapBlur intensity={0.4} />

               {/* ToneMapping: Handles High Dynamic Range without washing out colors */}
               <ToneMapping />
            </EffectComposer>
          ) : (
            <primitive object={null} />
          )}

          <PointerLockControls onUnlock={handleUnlock} />
        </Canvas>

        <InteractionLayer setInteracting={setIsInteracting} setAction={setAction} />
        <UI />
      </KeyboardControls>
    </div>
  );
};

export default App;
