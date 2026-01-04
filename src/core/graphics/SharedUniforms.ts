import * as THREE from 'three';

/**
 * Shared uniforms that can be accessed by any material to avoid
 * hundreds of redundant useFrame calls for time/lighting.
 *
 * These uniforms are updated once per frame by VoxelTerrain.tsx via updateSharedUniforms().
 * Materials reference these directly instead of receiving values via props.
 */
export const sharedUniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) }, // Unified name
    uFogColor: { value: new THREE.Color('#87CEEB') },
    uFogNear: { value: 23 },
    uFogFar: { value: 85 },
    uShaderFogStrength: { value: 0.9 },
    uShaderFogEnabled: { value: 0.0 },
    uHeightFogEnabled: { value: 1.0 },
    uHeightFogStrength: { value: 0.35 },
    uHeightFogRange: { value: 50.0 },
    uHeightFogOffset: { value: 4.0 },
    uTriplanarDetail: { value: 1.0 },
    uWetnessEnabled: { value: 1.0 },
    uMossEnabled: { value: 1.0 },
    uRoughnessMin: { value: 0.0 },

    // Material debug/visual settings
    uWeightsView: { value: 0 },               // 0=off, 1=snow, 2=grass, 3=snowMinusGrass, 4=dominant

    // Biome-aware fog uniforms (interpolated from camera position)
    uBiomeFogDensityMul: { value: 1.0 },      // Multiplier for fog density
    uBiomeFogHeightMul: { value: 1.0 },       // Multiplier for height fog
    uBiomeFogTint: { value: new THREE.Vector3(0, 0, 0) },  // RGB tint offset
    uBiomeFogAerial: { value: 0.45 },         // Aerial perspective strength
    uBiomeFogEnabled: { value: 1.0 },         // Toggle for biome fog effects
};

export interface SharedUniformUpdateParams {
    sunDir?: THREE.Vector3;
    fogColor?: THREE.Color;
    fogNear?: number;
    fogFar?: number;
    shaderFogEnabled?: boolean;
    shaderFogStrength?: number;
    heightFogEnabled?: boolean;
    heightFogStrength?: number;
    heightFogRange?: number;
    heightFogOffset?: number;
    triplanarDetail?: number;
    wetnessEnabled?: boolean;
    mossEnabled?: boolean;
    roughnessMin?: number;
    weightsView?: number;
    // Biome fog parameters
    biomeFogDensityMul?: number;
    biomeFogHeightMul?: number;
    biomeFogTint?: THREE.Vector3;
    biomeFogAerial?: number;
    biomeFogEnabled?: boolean;
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
    if (params.shaderFogEnabled !== undefined) sharedUniforms.uShaderFogEnabled.value = params.shaderFogEnabled ? 1.0 : 0.0;
    if (params.shaderFogStrength !== undefined) sharedUniforms.uShaderFogStrength.value = params.shaderFogStrength;
    if (params.heightFogEnabled !== undefined) sharedUniforms.uHeightFogEnabled.value = params.heightFogEnabled ? 1.0 : 0.0;
    if (params.heightFogStrength !== undefined) sharedUniforms.uHeightFogStrength.value = params.heightFogStrength;
    if (params.heightFogRange !== undefined) sharedUniforms.uHeightFogRange.value = params.heightFogRange;
    if (params.heightFogOffset !== undefined) sharedUniforms.uHeightFogOffset.value = params.heightFogOffset;
    if (params.triplanarDetail !== undefined) sharedUniforms.uTriplanarDetail.value = params.triplanarDetail;
    if (params.wetnessEnabled !== undefined) sharedUniforms.uWetnessEnabled.value = params.wetnessEnabled ? 1.0 : 0.0;
    if (params.mossEnabled !== undefined) sharedUniforms.uMossEnabled.value = params.mossEnabled ? 1.0 : 0.0;
    if (params.roughnessMin !== undefined) sharedUniforms.uRoughnessMin.value = params.roughnessMin;
    if (params.weightsView !== undefined) sharedUniforms.uWeightsView.value = params.weightsView;

    // Biome fog parameters
    if (params.biomeFogDensityMul !== undefined) sharedUniforms.uBiomeFogDensityMul.value = params.biomeFogDensityMul;
    if (params.biomeFogHeightMul !== undefined) sharedUniforms.uBiomeFogHeightMul.value = params.biomeFogHeightMul;
    if (params.biomeFogTint) sharedUniforms.uBiomeFogTint.value.copy(params.biomeFogTint);
    if (params.biomeFogAerial !== undefined) sharedUniforms.uBiomeFogAerial.value = params.biomeFogAerial;
    if (params.biomeFogEnabled !== undefined) sharedUniforms.uBiomeFogEnabled.value = params.biomeFogEnabled ? 1.0 : 0.0;
};
