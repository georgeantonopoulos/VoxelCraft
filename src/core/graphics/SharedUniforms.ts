import * as THREE from 'three';

/**
 * Shared uniforms that can be accessed by any material to avoid 
 * hundreds of redundant useFrame calls for time/lighting.
 */
export const sharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
};

/**
 * Update these uniforms once per frame from a central location (e.g. App.tsx)
 */
export const updateSharedUniforms = (state: { clock: THREE.Clock }, sunDir?: THREE.Vector3) => {
    sharedUniforms.uTime.value = state.clock.getElapsedTime();
    if (sunDir) sharedUniforms.uSunDir.value.copy(sunDir);
};
