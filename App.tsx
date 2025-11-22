import React, { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Sky, PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { VoxelTerrain } from './components/VoxelTerrain';
import { Player } from './components/Player';
import { UI } from './components/UI';
import { Water } from './components/Water';
import { BedrockPlane } from './components/BedrockPlane';
import { TerrainService } from './services/terrainService';
import * as THREE from 'three';
import { CSMManager } from './components/CSMManager';
import { EffectComposer, Bloom, ToneMapping } from '@react-three/postprocessing';
import { N8AOPostPass } from 'n8ao';

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
  return (
      <mesh position={[500, 800, 300]}>
          <sphereGeometry args={[40, 16, 16]} />
          <meshBasicMaterial color={[10, 10, 10]} toneMapped={false} />
      </mesh>
  );
};

const PostProcessing = () => {
    const { scene, camera } = useThree();
    const n8ao = useMemo(() => {
        const p = new N8AOPostPass(scene, camera);
        p.configuration.aoRadius = 2.5;
        p.configuration.intensity = 3.0;
        p.configuration.color = new THREE.Color(0, 0, 0);
        p.setQualityMode('High');
        return p;
    }, [scene, camera]);

    return (
        <EffectComposer disableNormalPass>
            <primitive object={n8ao} />
            <Bloom luminanceThreshold={1} mipmapBlur intensity={0.5} />
            <ToneMapping />
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
  const [csm, setCsm] = useState<any>(null);

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
            toneMapping: THREE.NoToneMapping,
            powerPreference: "high-performance"
          }}
          camera={{ fov: 60, near: 0.1, far: 240 }}
        >
          <color attach="background" args={['#bed9f4']} />
          
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
          
          {/* CSM Manager handles shadows and directional light */}
          <CSMManager lightDirection={sunDirection} onCSMCreated={setCsm} />

          <PostProcessing />

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {spawnPos && <Player position={spawnPos} />}
              <VoxelTerrain 
                action={action}
                isInteracting={isInteracting}
                sunDirection={sunDirection}
                csm={csm}
              />
              <Water />
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
