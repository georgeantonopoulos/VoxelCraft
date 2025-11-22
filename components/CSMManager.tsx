import React, { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CSM from 'three-csm';

interface CSMManagerProps {
  lightDirection: THREE.Vector3;
  onCSMCreated: (csm: CSM) => void;
}

export const CSMManager: React.FC<CSMManagerProps> = ({ lightDirection, onCSMCreated }) => {
  const { camera, scene } = useThree();
  const csmRef = useRef<CSM | null>(null);

  useEffect(() => {
    // Ensure direction is normalized
    const direction = lightDirection.clone().normalize();

    // Initialize CSM
    const csm = new CSM({
      maxFar: 400,
      cascades: 4,
      mode: 'practical',
      parent: scene,
      shadowMapSize: 2048,
      lightDirection: direction,
      camera: camera,
      lightIntensity: 0.5,
      lightColor: new THREE.Color('#fff7d1'),
      shadowBias: -0.00001, // Very slight negative bias
      lightMargin: 100
    });

    csmRef.current = csm;
    onCSMCreated(csm);

    return () => {
      csm.dispose();
      csmRef.current = null;
    };
  }, [camera, scene, lightDirection, onCSMCreated]);

  useFrame(() => {
    if (csmRef.current) {
      csmRef.current.update();
    }
  });

  return null;
};
