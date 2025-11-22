
import React, { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Sky, PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { UI } from './components/UI';
import { Water } from './components/Water';
import { BedrockPlane } from './components/BedrockPlane';
import { CSMManager } from './components/CSMManager';
import { TerrainService } from './services/terrainService';
import { GRAVITY } from './constants';
import * as THREE from 'three';
import { N8AOPostPass } from 'n8ao';
import type CSM from 'three-csm';

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

const Sun: React.FC<{ position: THREE.Vector3 }> = ({ position }) => {
  const color = useMemo(() => new THREE.Color(10, 9.5, 8.5), []);

  return (
    <mesh position={position.toArray()}>
      <sphereGeometry args={[40, 48, 48]} />
      <meshBasicMaterial color={color} toneMapped />
    </mesh>
  );
};

const Effects: React.FC = () => {
  const { scene, camera, size, viewport } = useThree();
  // @ts-ignore
  const dpr = useThree((state) => state.viewport.dpr);
  const aoPass = useMemo(() => new N8AOPostPass(scene, camera, size.width * dpr, size.height * dpr), [scene, camera, size, dpr]);

  useEffect(() => {
    aoPass.setSize(size.width * dpr, size.height * dpr);
    aoPass.configuration.aoRadius = 6.0;
    aoPass.configuration.distanceFalloff = 1.1;
    aoPass.configuration.intensity = 2.2;
    aoPass.configuration.halfRes = true;
    aoPass.configuration.gammaCorrection = false;
  }, [aoPass, size]);

  useEffect(() => {
    return () => {
      aoPass.dispose?.();
    };
  }, [aoPass]);

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <primitive object={aoPass} />
      <Bloom
        mipmapBlur
        intensity={0.3}
        luminanceThreshold={0.98}
        luminanceSmoothing={0.1}
        radius={0.3}
      />
    </EffectComposer>
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

  const sunPosition = useMemo(() => new THREE.Vector3(300, 200, 300), []);
  const sunDirection = useMemo(() => sunPosition.clone().normalize(), [sunPosition]);
  const csmLightDirection = useMemo(() => sunDirection.clone().multiplyScalar(-1), [sunDirection]);
  const [csm, setCsm] = useState<CSM | null>(null);

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
            toneMappingExposure: 0.85,
            powerPreference: "high-performance"
          }}
          camera={{ fov: 60, near: 0.1, far: 240 }}
        >
          <color attach="background" args={['#bed9f4']} />
          <fog attach="fog" args={['#c3d8ee', 35, 180]} />
          <CSMManager lightDirection={csmLightDirection} onCSMCreated={setCsm} />
          
          <Sky 
            sunPosition={sunPosition.toArray()}
            turbidity={0.8}
            rayleigh={0.5}
            mieCoefficient={0.005}
            mieDirectionalG={0.8}
            inclination={0.48}
            azimuth={0.15}
          />

          <Sun position={sunPosition} />
          
          <ambientLight intensity={0.2} color="#dbeaff" />
          <hemisphereLight args={['#d7e6ff', '#332211', 0.4]} />

          <Suspense fallback={null}>
            <Physics gravity={[0, GRAVITY, 0]}>
              {spawnPos && <Player position={spawnPos} />}
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
                csm={csm}
              />
              <Water sunDirection={sunDirection} csm={csm} />
              <BedrockPlane />
            </Physics>
          </Suspense>

          <Effects />
          <PointerLockControls onUnlock={handleUnlock} />
        </Canvas>

        <InteractionLayer setInteracting={setIsInteracting} setAction={setAction} />
        <UI />
      </KeyboardControls>
    </div>
  );
};

export default App;
