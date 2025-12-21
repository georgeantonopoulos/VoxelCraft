import React, { useState, Suspense, useEffect, useCallback, useMemo } from 'react';
import { MapDebug } from '@/ui/MapDebug';
import { Canvas } from '@react-three/fiber';
import { PointerLockControls, KeyboardControls } from '@react-three/drei';
import { Physics } from '@react-three/rapier';
import { Leva } from 'leva';
import * as THREE from 'three';

// Core & State
import { DynamicEnvironmentIBL } from '@core/graphics/DynamicEnvironmentIBL';
import { useSettingsStore } from '@state/SettingsStore';

// Features
import { VoxelTerrain } from '@features/terrain/components/VoxelTerrain';
import { Player } from '@features/player/Player';
import { FloraPlacer } from '@features/flora/components/FloraPlacer';
import { BedrockPlane } from '@features/terrain/components/BedrockPlane';
import { AmbientLife } from '@features/environment/AmbientLife';
import { FirstPersonTools } from '@features/interaction/components/FirstPersonTools';
import { PhysicsItemRenderer } from '@features/interaction/components/PhysicsItemRenderer';
import { InteractionHandler } from '@features/interaction/logic/InteractionHandler';
import { InventoryInput } from '@features/interaction/components/InventoryInput';
import { SparkSystem } from '@features/interaction/components/SparkSystem';
import { BubbleSystem } from '@features/environment/BubbleSystem';
import { CraftingInterface } from '@features/crafting/components/CraftingInterface';
import { useCraftingStore } from '@state/CraftingStore';

// Environment Features (Refactored)
import { AtmosphereManager } from '@features/environment/components/AtmosphereManager';
import { CinematicComposer } from '@features/environment/components/CinematicComposer';
import { PerformanceMonitor } from '@features/environment/components/PerformanceMonitor';
import { CinematicCamera } from '@features/environment/components/CinematicCamera';

// UI
import { HUD as UI } from '@ui/HUD';
import { StartupScreen } from '@ui/StartupScreen';
import { WorldSelectionScreen } from '@ui/WorldSelectionScreen';
import { SettingsMenu } from '@/ui/SettingsMenu';
import { TouchControls } from '@/ui/TouchControls';
import { DebugControls } from '@/ui/DebugControls';

import { TouchCameraControls } from '@features/player/TouchCameraControls';
import { TerrainService } from '@features/terrain/logic/terrainService';

// Logic
import { BiomeManager, BiomeType, WorldType } from '@features/terrain/logic/BiomeManager';

// Keyboard Map
const keyboardMap = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'shift', keys: ['Shift'] },
];

const App: React.FC = () => {
  const [gameStarted, setGameStarted] = useState(false);
  const [terrainLoaded, setTerrainLoaded] = useState(false);
  const [spawnPos, setSpawnPos] = useState<[number, number, number] | null>(null);
  const [worldType, setWorldType] = useState<WorldType | null>(null);

  // Graphics & Input Settings (Zustand)
  const resolutionScale = useSettingsStore(s => s.resolutionScale);
  const inputMode = useSettingsStore(s => s.inputMode);
  const debugShadowsEnabled = useSettingsStore(s => s.shadows);
  const setDebugShadowsEnabled = useSettingsStore(s => s.setShadows);
  const aoEnabled = useSettingsStore(s => s.ao);
  const setAoEnabled = useSettingsStore(s => s.setAo);
  const bloomEnabled = useSettingsStore(s => s.bloom);
  const setBloomEnabled = useSettingsStore(s => s.setBloom);
  const viewDistance = useSettingsStore(s => s.viewDistance);

  // Crafting State
  const isCraftingOpen = useCraftingStore(s => s.isOpen);

  // Debug Local State (Leva managed)
  const [triplanarDetail, setTriplanarDetail] = useState(1.0);
  const [postProcessingEnabled, setPostProcessingEnabled] = useState(true);
  const [aoIntensity, setAoIntensity] = useState(2.0);
  const [terrainShaderFogEnabled, setTerrainShaderFogEnabled] = useState(true);
  const [terrainShaderFogStrength, setTerrainShaderFogStrength] = useState(0.9);
  const [terrainThreeFogEnabled, setTerrainThreeFogEnabled] = useState(true);
  const [terrainFadeEnabled, setTerrainFadeEnabled] = useState(true);
  const [terrainWetnessEnabled, setTerrainWetnessEnabled] = useState(true);
  const [terrainMossEnabled, setTerrainMossEnabled] = useState(true);
  const [terrainRoughnessMin, setTerrainRoughnessMin] = useState(0.0);
  const [bedrockPlaneEnabled, setBedrockPlaneEnabled] = useState(true);
  const [terrainPolygonOffsetEnabled, setTerrainPolygonOffsetEnabled] = useState(false);
  const [terrainPolygonOffsetFactor, setTerrainPolygonOffsetFactor] = useState(-1.0);
  const [terrainPolygonOffsetUnits, setTerrainPolygonOffsetUnits] = useState(-1.0);
  const [levaScale, setLevaScale] = useState(1.15);
  const [levaWidth, setLevaWidth] = useState(520);
  const [terrainChunkTintEnabled, setTerrainChunkTintEnabled] = useState(false);
  const [terrainWireframeEnabled, setTerrainWireframeEnabled] = useState(false);
  const [terrainWeightsView, setTerrainWeightsView] = useState('off');
  const [caOffset, setCaOffset] = useState(0.00001);
  const [vignetteDarkness, setVignetteDarkness] = useState(0.5);

  const [fogNear, setFogNear] = useState(20);
  const [fogFar, setFogFar] = useState(160);
  const [atmosphereHaze, setAtmosphereHaze] = useState(0.35);
  const [atmosphereBrightness, setAtmosphereBrightness] = useState(1.0);
  const [sunIntensityMul, setSunIntensityMul] = useState(1.5);
  const [ambientIntensityMul, setAmbientIntensityMul] = useState(1.0);
  const [moonIntensityMul, setMoonIntensityMul] = useState(1.7);
  const [iblEnabled, setIblEnabled] = useState(false);
  const [iblIntensity, setIblIntensity] = useState(0.4);
  const [exposureSurface, setExposureSurface] = useState(0.6);
  const [exposureCaveMax, setExposureCaveMax] = useState(1.3);
  const [exposureUnderwater, setExposureUnderwater] = useState(0.8);
  const [bloomIntensity, setBloomIntensity] = useState(0.6);
  const [bloomThreshold, setBloomThreshold] = useState(0.4);

  const [heightFogEnabled, setHeightFogEnabled] = useState(true);
  const [heightFogStrength, setHeightFogStrength] = useState(0.5);
  const [heightFogRange, setHeightFogRange] = useState(24.0);
  const [heightFogOffset, setHeightFogOffset] = useState(12.0);

  // Sun Shadow Params
  const [sunShadowBias, setSunShadowBias] = useState(-0.0005);
  const [sunShadowNormalBias, setSunShadowNormalBias] = useState(0.02);
  const [sunShadowMapSize, setSunShadowMapSize] = useState(2048);
  const [sunShadowCamSize, setSunShadowCamSize] = useState(200);

  // Sun Orbit Params
  const [sunOrbitRadius, setSunOrbitRadius] = useState(300);
  const [sunOrbitSpeed, setSunOrbitSpeed] = useState(0.025);
  const [sunTimeOffset, setSunTimeOffset] = useState(0.0);

  const orbitConfig = useMemo(() => ({
    radius: sunOrbitRadius,
    speed: sunOrbitSpeed / 2.0,
    offset: sunTimeOffset
  }), [sunOrbitRadius, sunOrbitSpeed, sunTimeOffset]);

  const sunDirection = useMemo(() => new THREE.Vector3(), []);

  // Flags from URL
  const skipPost = useMemo(() => new URLSearchParams(window.location.search).has('noPP'), []);
  const debugMode = useMemo(() => new URLSearchParams(window.location.search).has('debug'), []);
  const mapMode = useMemo(() => new URLSearchParams(window.location.search).get('mode') === 'map', []);
  const autoStart = useMemo(() => new URLSearchParams(window.location.search).has('autostart'), []);

  // Initial Logic & Fallback Spawning
  const findSpawnForBiome = useCallback((target: BiomeType): { x: number; z: number } | null => {
    const MAX_RADIUS = 4096;
    const STEP = 64;
    for (let r = 0; r <= MAX_RADIUS; r += STEP) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = 16 + Math.cos(a) * r;
        const z = 16 + Math.sin(a) * r;
        if (BiomeManager.getBiomeAt(x, z) === target) return { x, z };
      }
    }
    return null;
  }, []);

  useEffect(() => {
    if (!worldType) return;
    BiomeManager.setWorldType(worldType);
    const params = new URLSearchParams(window.location.search);
    const requestedBiome = params.get('vcSpawnBiome') as BiomeType | null;

    let targetX = 16, targetZ = 16;
    if (requestedBiome) {
      const hit = findSpawnForBiome(requestedBiome);
      if (hit) { targetX = hit.x; targetZ = hit.z; }
    }

    // Instant surface scan
    const y = TerrainService.getHeightAt(targetX, targetZ);
    setSpawnPos([targetX, y + 2.5, targetZ]);
    if (autoStart) setGameStarted(true);
  }, [worldType, findSpawnForBiome, autoStart]);

  useEffect(() => {
    document.documentElement.style.setProperty('--vc-leva-scale', String(levaScale));
  }, [levaScale]);

  const handleUnlock = useCallback(() => {
    // We no longer quit the game on unlock. 
    // This allows the player to use the settings menu or just regain cursor control
    // without losing their progress in the world.
    console.log('[App] Pointer unlocked');
  }, []);

  if (mapMode) return <MapDebug />;

  return (
    <div className="w-full h-full relative bg-sky-300">
      {debugMode && (
        <style>{`#leva__root { transform: scale(var(--vc-leva-scale, 1)); transform-origin: top right; }`}</style>
      )}
      <Leva
        hidden={!debugMode}
        theme={{ sizes: { rootWidth: `${levaWidth}px` }, fontSizes: { root: '14px' } }}
      />
      {debugMode && (
        <DebugControls
          setDebugShadowsEnabled={setDebugShadowsEnabled}
          setTriplanarDetail={setTriplanarDetail}
          setPostProcessingEnabled={setPostProcessingEnabled}
          setAoEnabled={setAoEnabled}
          setAoIntensity={setAoIntensity}
          setBloomEnabled={setBloomEnabled}
          setBloomIntensity={setBloomIntensity}
          setBloomThreshold={setBloomThreshold}
          setExposureSurface={setExposureSurface}
          setExposureCaveMax={setExposureCaveMax}
          setExposureUnderwater={setExposureUnderwater}
          setFogNear={setFogNear}
          setFogFar={setFogFar}
          setAtmosphereHaze={setAtmosphereHaze}
          setAtmosphereBrightness={setAtmosphereBrightness}
          setSunIntensityMul={setSunIntensityMul}
          setAmbientIntensityMul={setAmbientIntensityMul}
          setMoonIntensityMul={setMoonIntensityMul}
          setIblEnabled={setIblEnabled}
          setIblIntensity={setIblIntensity}
          setTerrainShaderFogEnabled={setTerrainShaderFogEnabled}
          setTerrainShaderFogStrength={setTerrainShaderFogStrength}
          setTerrainThreeFogEnabled={setTerrainThreeFogEnabled}
          setTerrainFadeEnabled={setTerrainFadeEnabled}
          setTerrainWetnessEnabled={setTerrainWetnessEnabled}
          setTerrainMossEnabled={setTerrainMossEnabled}
          setTerrainRoughnessMin={setTerrainRoughnessMin}
          setBedrockPlaneEnabled={setBedrockPlaneEnabled}
          setTerrainPolygonOffsetEnabled={setTerrainPolygonOffsetEnabled}
          setTerrainPolygonOffsetFactor={setTerrainPolygonOffsetFactor}
          setTerrainPolygonOffsetUnits={setTerrainPolygonOffsetUnits}
          setLevaScale={setLevaScale}
          setLevaWidth={setLevaWidth}
          setTerrainChunkTintEnabled={setTerrainChunkTintEnabled}
          setTerrainWireframeEnabled={setTerrainWireframeEnabled}
          setTerrainWeightsView={setTerrainWeightsView}
          setCaOffset={setCaOffset}
          setVignetteDarkness={setVignetteDarkness}
          setSunShadowBias={setSunShadowBias}
          setSunShadowNormalBias={setSunShadowNormalBias}
          setSunShadowMapSize={setSunShadowMapSize}
          setSunShadowCamSize={setSunShadowCamSize}
          setSunOrbitRadius={setSunOrbitRadius}
          setSunOrbitSpeed={setSunOrbitSpeed}
          setSunTimeOffset={setSunTimeOffset}
          values={{
            debugShadowsEnabled, triplanarDetail, postProcessingEnabled, aoEnabled, bloomEnabled, aoIntensity,
            bloomIntensity, bloomThreshold, exposureSurface, exposureCaveMax, exposureUnderwater,
            fogNear, fogFar, atmosphereHaze, atmosphereBrightness, sunIntensityMul, ambientIntensityMul, moonIntensityMul,
            iblEnabled, iblIntensity, terrainShaderFogEnabled, terrainShaderFogStrength,
            terrainThreeFogEnabled, terrainFadeEnabled, terrainWetnessEnabled, terrainMossEnabled,
            terrainRoughnessMin, bedrockPlaneEnabled, terrainPolygonOffsetEnabled,
            terrainPolygonOffsetFactor, terrainPolygonOffsetUnits, levaScale, levaWidth,
            terrainChunkTintEnabled, terrainWireframeEnabled, terrainWeightsView,
            caOffset, vignetteDarkness, sunShadowBias, sunShadowNormalBias,
            sunShadowMapSize, sunShadowCamSize, sunOrbitRadius, sunOrbitSpeed, sunTimeOffset,
            heightFogEnabled, heightFogStrength, heightFogRange, heightFogOffset
          }}
          setHeightFogEnabled={setHeightFogEnabled}
          setHeightFogStrength={setHeightFogStrength}
          setHeightFogRange={setHeightFogRange}
          setHeightFogOffset={setHeightFogOffset}
        />
      )}

      {!worldType ? (
        <WorldSelectionScreen onSelect={setWorldType} />
      ) : (
        !gameStarted && (
          <StartupScreen
            loaded={terrainLoaded}
            onEnter={() => setGameStarted(true)}
          />
        )
      )}

      <KeyboardControls map={keyboardMap}>
        <Canvas
          shadows={debugShadowsEnabled}
          dpr={resolutionScale * (typeof window !== 'undefined' ? window.devicePixelRatio : 1)}
          gl={{
            antialias: false,
            outputColorSpace: THREE.SRGBColorSpace,
            toneMapping: THREE.NoToneMapping
          }}
          camera={{ fov: 75, near: 0.1, far: 2000 }}
        >
          <PerformanceMonitor visible={debugMode} />

          <AtmosphereManager
            sunDirection={sunDirection}
            sunIntensityMul={sunIntensityMul}
            sunShadowBias={sunShadowBias}
            sunShadowNormalBias={sunShadowNormalBias}
            sunShadowMapSize={sunShadowMapSize}
            sunShadowCamSize={sunShadowCamSize}
            ambientIntensityMul={ambientIntensityMul}
            moonIntensityMul={moonIntensityMul}
            fogNear={fogNear}
            fogFar={fogFar}
            hazeAmount={atmosphereHaze}
            brightness={atmosphereBrightness}
            viewDistance={viewDistance}
            orbitConfig={orbitConfig}
          />

          {iblEnabled && (
            <DynamicEnvironmentIBL sunDirection={sunDirection} enabled={iblEnabled} intensity={iblIntensity} />
          )}

          <Suspense fallback={null}>
            <Physics gravity={[0, -20, 0]}>
              {gameStarted && spawnPos && <Player position={spawnPos} />}
              {!gameStarted && <CinematicCamera spawnPos={spawnPos} />}
              <AmbientLife enabled={gameStarted} />
              {worldType && (
                <VoxelTerrain
                  sunDirection={sunDirection}
                  triplanarDetail={triplanarDetail}
                  terrainShaderFogEnabled={terrainShaderFogEnabled}
                  terrainShaderFogStrength={terrainShaderFogStrength}
                  terrainThreeFogEnabled={terrainThreeFogEnabled}
                  terrainFadeEnabled={terrainFadeEnabled}
                  terrainWetnessEnabled={terrainWetnessEnabled}
                  terrainMossEnabled={terrainMossEnabled}
                  terrainRoughnessMin={terrainRoughnessMin}
                  terrainPolygonOffsetEnabled={terrainPolygonOffsetEnabled}
                  terrainPolygonOffsetFactor={terrainPolygonOffsetFactor}
                  terrainPolygonOffsetUnits={terrainPolygonOffsetUnits}
                  terrainChunkTintEnabled={terrainChunkTintEnabled}
                  terrainWireframeEnabled={terrainWireframeEnabled}
                  terrainWeightsView={terrainWeightsView}
                  fogNear={fogNear}
                  fogFar={fogFar}
                  heightFogEnabled={heightFogEnabled}
                  heightFogStrength={heightFogStrength}
                  heightFogRange={heightFogRange}
                  heightFogOffset={heightFogOffset}
                  initialSpawnPos={spawnPos}
                  onInitialLoad={() => setTerrainLoaded(true)}
                  worldType={worldType}
                />
              )}
              <FloraPlacer />
              {bedrockPlaneEnabled && <BedrockPlane />}
              <PhysicsItemRenderer />
              <InteractionHandler />
            </Physics>
            <FirstPersonTools />
          </Suspense>

          <CinematicComposer
            aoEnabled={aoEnabled}
            aoIntensity={aoIntensity}
            bloomEnabled={bloomEnabled}
            bloomThreshold={bloomThreshold}
            bloomIntensity={bloomIntensity}
            exposureSurface={exposureSurface}
            exposureCaveMax={exposureCaveMax}
            exposureUnderwater={exposureUnderwater}
            caOffset={caOffset}
            vignetteDarkness={vignetteDarkness}
            skipPost={skipPost || !postProcessingEnabled}
          />

          {gameStarted && inputMode === 'mouse' && !isCraftingOpen && <PointerLockControls onUnlock={handleUnlock} />}
          {gameStarted && inputMode === 'touch' && <TouchCameraControls />}

          <SparkSystem />
          <BubbleSystem />
        </Canvas>

        {gameStarted && (
          <>
            <InventoryInput enabled={gameStarted} />
            <UI />
          </>
        )}
      </KeyboardControls>

      {gameStarted && <CraftingInterface />}

      <TouchControls />
      <SettingsMenu />
    </div>
  );
};

export default App;
