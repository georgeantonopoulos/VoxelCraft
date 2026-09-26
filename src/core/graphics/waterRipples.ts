import * as THREE from 'three';
import { sharedUniforms } from './SharedUniforms';

/**
 * Rings spreading on the water from things that touch it (wading, thrown
 * items). A small ring buffer of sources shared by every water chunk's
 * material: x, z, start time (sharedUniforms.uTime clock), strength.
 */
export const MAX_WATER_RIPPLES = 8;

export const waterRippleUniform = {
  value: Array.from({ length: MAX_WATER_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)),
};

let next = 0;

export const addWaterRipple = (x: number, z: number, strength = 1): void => {
  waterRippleUniform.value[next].set(x, z, sharedUniforms.uTime.value, strength);
  next = (next + 1) % MAX_WATER_RIPPLES;
};

// Debug: window.__waterRipple(x, z, strength) drops a ring on the water.
if (typeof window !== 'undefined') {
  (window as unknown as { __waterRipple?: typeof addWaterRipple }).__waterRipple = addWaterRipple;
}
