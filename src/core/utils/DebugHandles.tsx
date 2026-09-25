import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * Exposes the live three.js scene/camera/renderer as `window.__three` for
 * console and automated diagnostics (e.g. scanning geometry for NaN normals).
 */
export const DebugHandles: React.FC = () => {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const w = window as unknown as { __three?: unknown };
    w.__three = { scene, camera, gl, THREE };
    return () => { delete w.__three; };
  }, [scene, camera, gl]);
  return null;
};
