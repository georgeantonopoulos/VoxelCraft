import React, { useRef, useMemo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html, Grid, Environment } from '@react-three/drei';
import { useControls, button } from 'leva';

// Import model as URL
import lumabeeUrl from '@/assets/models/lumabee.glb?url';

import { BeeState } from './LumabeeCharacter';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface LumabeeGLTF extends GLTF {
  nodes: Record<string, THREE.Object3D>;
  materials: Record<string, THREE.Material>;
}

/**
 * Axis markers for visualizing directions
 */
const DirectionMarker: React.FC<{
  direction: THREE.Vector3;
  color: string;
  label: string;
  length?: number;
}> = ({ direction, color, label, length = 2 }) => {
  const arrowRef = useRef<THREE.ArrowHelper>(null);

  useEffect(() => {
    if (arrowRef.current) {
      arrowRef.current.setDirection(direction.clone().normalize());
      arrowRef.current.setLength(length, length * 0.2, length * 0.1);
    }
  }, [direction, length]);

  return (
    <group>
      <arrowHelper
        ref={arrowRef}
        args={[direction.clone().normalize(), new THREE.Vector3(0, 0, 0), length, color, length * 0.2, length * 0.1]}
      />
      <Html position={direction.clone().normalize().multiplyScalar(length + 0.3)}>
        <div style={{
          color,
          fontSize: '12px',
          fontWeight: 'bold',
          textShadow: '0 0 3px black',
          whiteSpace: 'nowrap'
        }}>
          {label}
        </div>
      </Html>
    </group>
  );
};

/**
 * State indicator label
 */
const StateLabel: React.FC<{ state: BeeState; stateTime: number }> = ({ state, stateTime }) => (
  <Html position={[0, 2.5, 0]} center>
    <div style={{
      background: 'rgba(0,0,0,0.8)',
      color: '#00ff88',
      padding: '8px 16px',
      borderRadius: '4px',
      fontFamily: 'monospace',
      fontSize: '14px',
      textAlign: 'center'
    }}>
      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>{state}</div>
      <div style={{ color: '#aaa', fontSize: '11px' }}>{stateTime.toFixed(1)}s</div>
    </div>
  </Html>
);

/**
 * The debug bee model with orientation controls
 */
const DebugBee: React.FC<{
  modelYawOffset: number;
  modelPitchOffset: number;
  modelRollOffset: number;
  simulatedYaw: number;
  simulatedPitch: number;
  simulatedRoll: number;
  showAxes: boolean;
  showModelForward: boolean;
  showWorldForward: boolean;
  showVelocity: boolean;
  animateHover: boolean;
  animateState: BeeState;
  hoverAmplitude: number;
  hoverFrequency: number;
  scale: number;
}> = ({
  modelYawOffset,
  modelPitchOffset,
  modelRollOffset,
  simulatedYaw,
  simulatedPitch,
  simulatedRoll,
  showAxes,
  showModelForward,
  showWorldForward,
  showVelocity,
  animateHover,
  animateState,
  hoverAmplitude,
  hoverFrequency,
  scale
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useGLTF(lumabeeUrl) as unknown as LumabeeGLTF;
  const [stateTime, setStateTime] = useState(0);

  // Clone model
  const modelClone = useMemo(() => {
    const clone = scene.clone();
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => mat.clone());
        } else {
          mesh.material = mesh.material.clone();
        }
      }
    });
    return clone;
  }, [scene]);

  // Simulated velocity direction (where the bee would be flying)
  const velocityDir = useMemo(() => {
    const euler = new THREE.Euler(simulatedPitch, simulatedYaw, 0, 'YXZ');
    const quat = new THREE.Quaternion().setFromEuler(euler);
    return new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  }, [simulatedYaw, simulatedPitch]);

  // Animation loop
  useFrame((state) => {
    if (!groupRef.current) return;

    const dt = state.clock.getDelta();
    setStateTime(prev => prev + dt);

    // Hover bobbing animation
    if (animateHover) {
      const hoverOffset = Math.sin(state.clock.elapsedTime * hoverFrequency) * hoverAmplitude;
      groupRef.current.position.y = hoverOffset;
    } else {
      groupRef.current.position.y = 0;
    }

    // Apply simulated flight rotation to outer group
    // This simulates what the bee's rotation would be during flight
    const flightEuler = new THREE.Euler(simulatedPitch, simulatedYaw, simulatedRoll, 'YXZ');
    groupRef.current.quaternion.setFromEuler(flightEuler);
  });

  return (
    <group ref={groupRef}>
      {/* State label */}
      <StateLabel state={animateState} stateTime={stateTime} />

      {/* World axes at bee position */}
      {showAxes && (
        <>
          <DirectionMarker direction={new THREE.Vector3(1, 0, 0)} color="#ff4444" label="X+" length={1.5} />
          <DirectionMarker direction={new THREE.Vector3(0, 1, 0)} color="#44ff44" label="Y+" length={1.5} />
          <DirectionMarker direction={new THREE.Vector3(0, 0, 1)} color="#4444ff" label="Z+" length={1.5} />
        </>
      )}

      {/* World forward (-Z) direction */}
      {showWorldForward && (
        <DirectionMarker
          direction={new THREE.Vector3(0, 0, -1)}
          color="#00ffff"
          label="World Forward (-Z)"
          length={3}
        />
      )}

      {/* Velocity/flight direction */}
      {showVelocity && (
        <DirectionMarker
          direction={velocityDir}
          color="#ffff00"
          label="Flight Dir"
          length={3.5}
        />
      )}

      {/* Inner group for model base rotation offset (this is what MODEL_YAW_OFFSET affects) */}
      <group
        rotation={[modelPitchOffset, modelYawOffset, modelRollOffset]}
      >
        {/* Model forward direction (what the bee mesh considers "forward") */}
        {showModelForward && (
          <DirectionMarker
            direction={new THREE.Vector3(0, 0, -1)}
            color="#ff00ff"
            label="Model Forward"
            length={2.5}
          />
        )}

        {/* The actual bee model */}
        <primitive object={modelClone} scale={scale} />

        {/* Glow for harvest state */}
        {animateState === BeeState.HARVEST && (
          <pointLight
            intensity={0.8}
            distance={3.0}
            color="#ffcc00"
            castShadow={false}
          />
        )}
      </group>
    </group>
  );
};

/**
 * Camera controller for better viewing
 */
const CameraController: React.FC = () => {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(3, 2, 5);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return <OrbitControls makeDefault enableDamping dampingFactor={0.1} />;
};

/**
 * Main debug scene component
 */
const BeeDebugSceneContent: React.FC = () => {
  // Model orientation offsets (what you want to tune)
  // Default yaw of Math.PI assumes model was authored with +Z forward (Blender default)
  // and needs to be rotated 180° to face -Z (Three.js forward)
  const modelControls = useControls('Model Orientation', {
    modelYawOffset: {
      value: Math.PI,  // Start with 180° - most likely correct for Blender exports
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
      label: 'Yaw Offset (Y rot)'
    },
    modelPitchOffset: {
      value: 0,
      min: -Math.PI / 2,
      max: Math.PI / 2,
      step: 0.01,
      label: 'Pitch Offset (X rot)'
    },
    modelRollOffset: {
      value: 0,
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
      label: 'Roll Offset (Z rot)'
    },
    scale: {
      value: 0.15,
      min: 0.05,
      max: 0.5,
      step: 0.01,
      label: 'Model Scale'
    }
  });

  // Simulated flight rotation (to test how model looks while flying)
  const flightControls = useControls('Simulated Flight', {
    simulatedYaw: {
      value: 0,
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
      label: 'Flight Yaw'
    },
    simulatedPitch: {
      value: 0,
      min: -Math.PI / 4,
      max: Math.PI / 4,
      step: 0.01,
      label: 'Flight Pitch'
    },
    simulatedRoll: {
      value: 0,
      min: -Math.PI / 4,
      max: Math.PI / 4,
      step: 0.01,
      label: 'Banking Roll'
    },
    bankAngle: {
      value: Math.PI / 6,
      min: 0,
      max: Math.PI / 3,
      step: 0.01,
      label: 'Max Bank Angle'
    }
  });

  // Animation controls
  const animControls = useControls('Animation', {
    animateHover: {
      value: true,
      label: 'Hover Bobbing'
    },
    hoverAmplitude: {
      value: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      label: 'Hover Amplitude'
    },
    hoverFrequency: {
      value: 2.0,
      min: 0.5,
      max: 5,
      step: 0.1,
      label: 'Hover Frequency'
    },
    animateState: {
      value: BeeState.IDLE,
      options: Object.values(BeeState),
      label: 'Animation State'
    }
  });

  // Visibility controls
  const visControls = useControls('Visibility', {
    showAxes: { value: true, label: 'Show XYZ Axes' },
    showWorldForward: { value: true, label: 'Show World Forward' },
    showModelForward: { value: true, label: 'Show Model Forward' },
    showVelocity: { value: true, label: 'Show Flight Direction' }
  });

  // Export controls
  useControls('Export Values', () => ({
    copyToClipboard: button(() => {
      const values = {
        MODEL_YAW_OFFSET: modelControls.modelYawOffset,
        MODEL_PITCH_OFFSET: modelControls.modelPitchOffset,
        MODEL_ROLL_OFFSET: modelControls.modelRollOffset,
        SCALE: modelControls.scale,
        // Include as code snippet
        codeSnippet: `
// Bee model orientation offsets
const MODEL_YAW_OFFSET = ${modelControls.modelYawOffset.toFixed(4)}; // Radians
const MODEL_PITCH_OFFSET = ${modelControls.modelPitchOffset.toFixed(4)}; // Radians
const MODEL_ROLL_OFFSET = ${modelControls.modelRollOffset.toFixed(4)}; // Radians
const SCALE = ${modelControls.scale.toFixed(4)};

// Apply in JSX:
<group rotation={[MODEL_PITCH_OFFSET, MODEL_YAW_OFFSET, MODEL_ROLL_OFFSET]}>
  <primitive object={modelClone} scale={SCALE} />
</group>
`
      };
      navigator.clipboard.writeText(JSON.stringify(values, null, 2));
      alert('Values copied to clipboard!\n\n' + values.codeSnippet);
    }),
    resetToDefaults: button(() => {
      // This will reset via Leva's internal state
      window.location.reload();
    })
  }));

  return (
    <>
      {/* Environment for PBR materials to reflect properly */}
      <Environment preset="sunset" background={false} />

      {/* Lighting - increased for better visibility */}
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 5]} intensity={2} castShadow />
      <directionalLight position={[-5, 5, -5]} intensity={1} />
      <directionalLight position={[0, -5, 0]} intensity={0.3} /> {/* Fill light from below */}

      {/* Ground grid for reference */}
      <Grid
        position={[0, -1, 0]}
        args={[20, 20]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#444466"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#6666aa"
        fadeDistance={50}
        fadeStrength={1}
        followCamera={false}
      />

      {/* Reference ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.01, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1a2e" />
      </mesh>

      {/* The debug bee */}
      <DebugBee
        modelYawOffset={modelControls.modelYawOffset}
        modelPitchOffset={modelControls.modelPitchOffset}
        modelRollOffset={modelControls.modelRollOffset}
        simulatedYaw={flightControls.simulatedYaw}
        simulatedPitch={flightControls.simulatedPitch}
        simulatedRoll={flightControls.simulatedRoll}
        showAxes={visControls.showAxes}
        showModelForward={visControls.showModelForward}
        showWorldForward={visControls.showWorldForward}
        showVelocity={visControls.showVelocity}
        animateHover={animControls.animateHover}
        animateState={animControls.animateState as BeeState}
        hoverAmplitude={animControls.hoverAmplitude}
        hoverFrequency={animControls.hoverFrequency}
        scale={modelControls.scale}
      />

      {/* Camera controls */}
      <CameraController />
    </>
  );
};

/**
 * Usage instructions overlay
 */
const Instructions: React.FC = () => (
  <div style={{
    position: 'absolute',
    bottom: '20px',
    left: '20px',
    background: 'rgba(0,0,0,0.85)',
    color: '#fff',
    padding: '16px',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '12px',
    maxWidth: '400px',
    zIndex: 1000
  }}>
    <h3 style={{ margin: '0 0 12px 0', color: '#00ff88' }}>🐝 Bee Debug Interface</h3>
    <div style={{ marginBottom: '8px' }}>
      <strong>Goal:</strong> Align the <span style={{ color: '#ff00ff' }}>Model Forward</span> arrow
      with the <span style={{ color: '#ffff00' }}>Flight Direction</span> arrow.
    </div>
    <ul style={{ margin: '0', paddingLeft: '20px', lineHeight: '1.6' }}>
      <li><strong>Model Orientation:</strong> Adjust offsets until bee nose points where flight arrow goes</li>
      <li><strong>Simulated Flight:</strong> Test different flight directions to verify</li>
      <li><strong>Orbit:</strong> Click + drag to rotate camera view</li>
      <li><strong>Zoom:</strong> Scroll wheel</li>
      <li><strong>Export:</strong> Click "Copy to Clipboard" when done to get values</li>
    </ul>
    <div style={{ marginTop: '12px', color: '#888' }}>
      Access via: <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px' }}>?debug=bee</kbd> in URL
    </div>
  </div>
);

/**
 * Full-page debug scene for bee orientation tuning
 * Access via: ?debug=bee or import directly for testing
 */
export const BeeDebugScene: React.FC = () => {
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a1a' }}>
      <Canvas shadows camera={{ fov: 50 }}>
        <BeeDebugSceneContent />
      </Canvas>
      <Instructions />
    </div>
  );
};

export default BeeDebugScene;
