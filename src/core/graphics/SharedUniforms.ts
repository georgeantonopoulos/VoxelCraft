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
    uBiomeFogAerial: { value: 0.25 },         // Aerial perspective strength
    uBiomeFogEnabled: { value: 1.0 },         // Toggle for biome fog effects

    // Fragment normal perturbation (Phase 1 AAA terrain improvement)
    // Now uses cheap triplanar-derived detail (no extra texture samples)
    uFragmentNormalStrength: { value: 0.6 },  // 0.0=off, 0.4-0.7=good, 1.0=strong
    uFragmentNormalScale: { value: 0.5 },     // Intensity multiplier (0.3-0.7 typical)

    // Global Illumination (voxel light grid)
    uGIEnabled: { value: 1.0 },               // Toggle for GI (0 = off, 1 = on)
    uGIIntensity: { value: 5.0 },             // GI strength multiplier (higher = more visible indirect light)

    // Color grading (in-shader, not post-processing)
    uTerrainSaturation: { value: 1.5 },       // 1.0=neutral, >1=more saturated, <1=desaturated

    // Humidity Spreading System (Sacred Grove terraforming)
    // Up to 8 grown trees can influence nearby terrain to transform from RED_SAND to GRASS
    // NOTE: Array uniforms in Three.js must be arrays of the proper type (Vector2, not Float32Array)
    uGrownTreeCount: { value: 0 },            // Number of active grown trees (0-8)
    uGrownTreePositions: { value: Array.from({ length: 8 }, () => new THREE.Vector2(0, 0)) },  // XZ positions
    uGrownTreeAges: { value: new Array(8).fill(0) },        // Time since growth (seconds) for each tree
    uHumiditySpreadRate: { value: 0.5 },      // Blocks per second of humidity spread
    uHumidityMaxRadius: { value: 64.0 },      // Maximum spread radius
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
    // Fragment normal perturbation
    fragmentNormalStrength?: number;
    fragmentNormalScale?: number;
    // Global Illumination
    giEnabled?: boolean;
    giIntensity?: number;
    // Color grading
    terrainSaturation?: number;
    // Humidity Spreading
    grownTreeCount?: number;
    grownTreePositions?: THREE.Vector2[];  // Array of Vector2 for proper Three.js uniform binding
    grownTreeAges?: number[];              // Array of numbers
    humiditySpreadRate?: number;
    humidityMaxRadius?: number;
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

    // Fragment normal perturbation
    if (params.fragmentNormalStrength !== undefined) sharedUniforms.uFragmentNormalStrength.value = params.fragmentNormalStrength;
    if (params.fragmentNormalScale !== undefined) sharedUniforms.uFragmentNormalScale.value = params.fragmentNormalScale;

    // Global Illumination
    if (params.giEnabled !== undefined) sharedUniforms.uGIEnabled.value = params.giEnabled ? 1.0 : 0.0;
    if (params.giIntensity !== undefined) sharedUniforms.uGIIntensity.value = params.giIntensity;

    // Color grading
    if (params.terrainSaturation !== undefined) sharedUniforms.uTerrainSaturation.value = params.terrainSaturation;

    // Humidity Spreading
    if (params.grownTreeCount !== undefined) sharedUniforms.uGrownTreeCount.value = params.grownTreeCount;
    if (params.grownTreePositions) {
        // Copy Vector2 values into the uniform array (mutate in place to maintain reference)
        const uniformArr = sharedUniforms.uGrownTreePositions.value;
        for (let i = 0; i < Math.min(params.grownTreePositions.length, 8); i++) {
            uniformArr[i].copy(params.grownTreePositions[i]);
        }
    }
    if (params.grownTreeAges) {
        // Copy age values into the uniform array
        const uniformArr = sharedUniforms.uGrownTreeAges.value;
        for (let i = 0; i < Math.min(params.grownTreeAges.length, 8); i++) {
            uniformArr[i] = params.grownTreeAges[i];
        }
    }
    if (params.humiditySpreadRate !== undefined) sharedUniforms.uHumiditySpreadRate.value = params.humiditySpreadRate;
    if (params.humidityMaxRadius !== undefined) sharedUniforms.uHumidityMaxRadius.value = params.humidityMaxRadius;
};
