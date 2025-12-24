import * as THREE from 'three';

/**
 * Shared uniforms that can be accessed by any material to avoid 
 * hundreds of redundant useFrame calls for time/lighting.
 */
export const sharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) }, // Unified name
    uFogColor: { value: new THREE.Color('#87CEEB') },
    uFogNear: { value: 20 },
    uFogFar: { value: 250 },
    uShaderFogStrength: { value: 0.9 },
    uShaderFogEnabled: { value: 1.0 },
    uHeightFogEnabled: { value: 1.0 },
    uHeightFogStrength: { value: 0.5 },
    uHeightFogRange: { value: 20.0 },
    uHeightFogOffset: { value: 10.0 },
    uTriplanarDetail: { value: 1.0 },
    uWetnessEnabled: { value: 1.0 },
    uMossEnabled: { value: 1.0 },
    uRoughnessMin: { value: 0.0 },
};

export interface SharedUniformUpdateParams {
    sunDir?: THREE.Vector3;
    fogColor?: THREE.Color;
    fogNear?: number;
    fogFar?: number;
    shaderFogStrength?: number;
    heightFogEnabled?: boolean;
    heightFogStrength?: number;
    heightFogRange?: number;
    heightFogOffset?: number;
    triplanarDetail?: number;
}

/**
 * Update these uniforms once per frame from a central location (e.g. VoxelTerrain.tsx)
 */
export const updateSharedUniforms = (state: { clock: THREE.Clock }, params?: SharedUniformUpdateParams) => {
    sharedUniforms.uTime.value = state.clock.getElapsedTime();
    if (!params) return;

    if (params.sunDir) {
        sharedUniforms.uSunDir.value.copy(params.sunDir);
        sharedUniforms.uSunDirection.value.copy(params.sunDir);
    }
    if (params.fogColor) sharedUniforms.uFogColor.value.copy(params.fogColor);
    if (params.fogNear !== undefined) sharedUniforms.uFogNear.value = params.fogNear;
    if (params.fogFar !== undefined) sharedUniforms.uFogFar.value = params.fogFar;
    if (params.shaderFogStrength !== undefined) sharedUniforms.uShaderFogStrength.value = params.shaderFogStrength;
    if (params.heightFogEnabled !== undefined) sharedUniforms.uHeightFogEnabled.value = params.heightFogEnabled ? 1.0 : 0.0;
    if (params.heightFogStrength !== undefined) sharedUniforms.uHeightFogStrength.value = params.heightFogStrength;
    if (params.heightFogRange !== undefined) sharedUniforms.uHeightFogRange.value = params.heightFogRange;
    if (params.heightFogOffset !== undefined) sharedUniforms.uHeightFogOffset.value = params.heightFogOffset;
    if (params.triplanarDetail !== undefined) sharedUniforms.uTriplanarDetail.value = params.triplanarDetail;
};
