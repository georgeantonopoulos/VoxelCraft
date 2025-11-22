
import React, { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Sky, PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { UI } from './components/UI';
import { BedrockPlane } from './components/BedrockPlane';
import { TerrainService } from './services/terrainService';
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      ambientLight: any;
      pointLight: any;
      directionalLight: any;
      fog: any;
      fogExp2: any;
      hemisphereLight: any;
    }
  }
}

const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
];

const Sun = () => {
  const { scene } = useThree();

  const flareTexture = useMemo(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (ctx) {
          // Simple glow
          const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
          gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
          gradient.addColorStop(0.2, 'rgba(255, 240, 200, 0.4)');
          gradient.addColorStop(0.5, 'rgba(255, 200, 150, 0.1)');
          gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
          ctx.fillStyle = gradient;
          ctx.fillRect(0, 0, 64, 64);
      }
      return new THREE.CanvasTexture(canvas);
  }, []);

  useEffect(() => {
      const flare = new Lensflare();
      flare.position.set(500, 800, 300);

      flare.addElement(new LensflareElement(flareTexture, 500, 0, new THREE.Color(1,1,1)));
      flare.addElement(new LensflareElement(flareTexture, 200, 0.4, new THREE.Color(1,1,0.9)));
      flare.addElement(new LensflareElement(flareTexture, 120, 0.6, new THREE.Color(0.8,1,0.6)));
      flare.addElement(new LensflareElement(flareTexture, 80, 0.8, new THREE.Color(1,0.8,0.6)));

      scene.add(flare);

      return () => {
          scene.remove(flare);
          flare.dispose();
      };
  }, [flareTexture, scene]);

  return (
      <mesh position={[500, 800, 300]}>
          <sphereGeometry args={[40, 16, 16]} />
          <meshBasicMaterial color="#fff7d1" toneMapped={false} />
      </mesh>
  );
};

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

const App: React.FC = () => {
  const [action, setAction] = useState<'DIG' | 'BUILD' | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [spawnPos, setSpawnPos] = useState<[number, number, number] | null>(null);

  const sunDirection = useMemo(
    () => new THREE.Vector3(-50, -80, -30).normalize(),
    []
  );

  useEffect(() => {
      // Find safe spawn height
      const h = TerrainService.getHeightAt(16, 16);
      // Spawn slightly above surface
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
            antialias: true,
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.ACESFilmicToneMapping,
            powerPreference: "high-performance"
          }}
          camera={{ fov: 60, near: 0.1, far: 240 }}
        >
          <color attach="background" args={['#bed9f4']} />
          <fog attach="fog" args={['#c3d8ee', 35, 180]} />
          
          <Sky 
            sunPosition={[500, 800, 300]}
            turbidity={0.8}
            rayleigh={0.5}
            mieCoefficient={0.005}
            mieDirectionalG={0.8}
            inclination={0.48}
            azimuth={0.15}
          />

          <Sun />
          
          <ambientLight intensity={0.35} color="#dbeaff" />
          <hemisphereLight args={['#d7e6ff', '#523521', 0.5]} />
          
          <directionalLight 
            position={[150, 240, 90]}
            intensity={1.5}
            color="#fff7d1"
            castShadow 
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0005}
            shadow-normalBias={0.04}
            shadow-camera-near={10}
            shadow-camera-far={400}
            shadow-camera-left={-100}
            shadow-camera-right={100}
            shadow-camera-top={100}
            shadow-camera-bottom={-100}
          />

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {spawnPos && <Player position={spawnPos} />}
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
              />
              <BedrockPlane />
            </Physics>
          </Suspense>

          <PointerLockControls onUnlock={handleUnlock} />
        </Canvas>

        <InteractionLayer setInteracting={setIsInteracting} setAction={setAction} />
        <UI />
      </KeyboardControls>
    </div>
  );
};

export default App;
