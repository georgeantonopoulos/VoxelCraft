
import React, { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Sky, PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { UI } from './components/UI';
import { Water } from './components/Water';
import * as THREE from 'three';

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

const App: React.FC = () => {
  const [action, setAction] = useState<'DIG' | 'BUILD' | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const sunDirection = useMemo(
    () => new THREE.Vector3(-50, -80, -30).normalize(),
    []
  );

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
            toneMapping: THREE.ACESFilmicToneMapping 
          }}
          camera={{ fov: 60, near: 0.1, far: 240 }}
        >
          <color attach="background" args={['#bed9f4']} />
          <fog attach="fog" args={['#c3d8ee', 55, 230]} />
          
          <Sky 
            sunPosition={[50, 70, 30]} 
            turbidity={1.2} 
            rayleigh={0.7} 
            mieCoefficient={0.009} 
            mieDirectionalG={0.84} 
            inclination={0.45}
            azimuth={0.15}
          />
          
          <ambientLight intensity={0.45} color="#dbeaff" />
          <hemisphereLight args={['#d7e6ff', '#523521', 0.5]} />
          
          <directionalLight 
            position={[50, 80, 30]} 
            intensity={1.45} 
            color="#fff7d1"
            castShadow 
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0003} 
            shadow-normalBias={0.03}
            shadow-camera-near={1}
            shadow-camera-far={220}
            shadow-camera-left={-90}
            shadow-camera-right={90}
            shadow-camera-top={90}
            shadow-camera-bottom={-90}
          />

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              <Player />
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
              />
              <Water />
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

export default App;
