
import React, { useState, Suspense, useEffect, useCallback } from 'react';
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

  const handleUnlock = useCallback(() => {
    setIsInteracting(false);
    setAction(null);
  }, []);

  return (
    <div className="w-full h-full relative bg-sky-300">
      <KeyboardControls map={keyboardMap}>
        <Canvas shadows camera={{ fov: 65, far: 150 }}>
          <color attach="background" args={['#b3d8f5']} />
          <fogExp2 attach="fog" args={[new THREE.Color('#b3d8f5'), 0.015]} />
          
          <Sky sunPosition={[50, 60, 50]} turbidity={0.6} rayleigh={0.5} mieCoefficient={0.005} mieDirectionalG={0.8} />
          
          <ambientLight intensity={0.6} color="#dbeaff" />
          <hemisphereLight args={['#ffffff', '#554433', 0.6]} />
          
          <directionalLight 
            position={[50, 80, 30]} 
            intensity={1.6} 
            color="#fffce0"
            castShadow 
            shadow-mapSize={[2048, 2048]}
            shadow-bias={-0.0005} 
            shadow-normalBias={0.05}
            shadow-camera-near={1}
            shadow-camera-far={150}
            shadow-camera-left={-60}
            shadow-camera-right={60}
            shadow-camera-top={60}
            shadow-camera-bottom={-60}
          />

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              <Player />
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting} 
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
