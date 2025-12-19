import React from 'react';
import { useControls, folder, button } from 'leva';
import { setSnapEpsilon } from '@/constants';

export const DebugControls: React.FC<{
    setDebugShadowsEnabled: (v: boolean) => void;
    setTriplanarDetail: (v: number) => void;
    setPostProcessingEnabled: (v: boolean) => void;
    setAoEnabled: (v: boolean) => void;
    setAoIntensity: (v: number) => void;
    setBloomEnabled: (v: boolean) => void;
    setBloomIntensity: (v: number) => void;
    setBloomThreshold: (v: number) => void;
    setExposureSurface: (v: number) => void;
    setExposureCaveMax: (v: number) => void;
    setExposureUnderwater: (v: number) => void;
    setFogNear: (v: number) => void;
    setFogFar: (v: number) => void;
    setSunIntensityMul: (v: number) => void;
    setAmbientIntensityMul: (v: number) => void;
    setMoonIntensityMul: (v: number) => void;
    setIblEnabled: (v: boolean) => void;
    setIblIntensity: (v: number) => void;
    setTerrainShaderFogEnabled: (v: boolean) => void;
    setTerrainShaderFogStrength: (v: number) => void;
    setTerrainThreeFogEnabled: (v: boolean) => void;
    setTerrainFadeEnabled: (v: boolean) => void;
    setTerrainWetnessEnabled: (v: boolean) => void;
    setTerrainMossEnabled: (v: boolean) => void;
    setTerrainRoughnessMin: (v: number) => void;
    setBedrockPlaneEnabled: (v: boolean) => void;
    setTerrainPolygonOffsetEnabled: (v: boolean) => void;
    setTerrainPolygonOffsetFactor: (v: number) => void;
    setTerrainPolygonOffsetUnits: (v: number) => void;
    setLevaScale: (v: number) => void;
    setLevaWidth: (v: number) => void;
    setTerrainChunkTintEnabled: (v: boolean) => void;
    setTerrainWireframeEnabled: (v: boolean) => void;
    setTerrainWeightsView: (v: string) => void;
    setCaOffset: (v: number) => void;
    setVignetteDarkness: (v: number) => void;
    // Sun Shadow Params
    setSunShadowBias: (v: number) => void;
    setSunShadowNormalBias: (v: number) => void;
    setSunShadowMapSize: (v: number) => void;
    setSunShadowCamSize: (v: number) => void;
    // Sun Orbit Params
    setSunOrbitRadius: (v: number) => void;
    setSunOrbitSpeed: (v: number) => void;
    setSunTimeOffset: (v: number) => void;
    // STATE VALUES PROPS (needed for export)
    values: any;
}> = (props) => {
    useControls(
        {
            'Scene Lighting': folder({
                Sun: folder({
                    'Properties': folder({
                        sunIntensity: { value: 1.5, min: 0.0, max: 2.5, step: 0.01, onChange: props.setSunIntensityMul, label: 'Intensity' },
                        radius: { value: 300, min: 50, max: 1000, step: 10, onChange: props.setSunOrbitRadius, label: 'Orbit Radius' },
                        speed: { value: 0.025, min: 0.0, max: 0.5, step: 0.001, onChange: props.setSunOrbitSpeed, label: 'Orbit Speed' },
                        timeOffset: { value: 0.0, min: 0.0, max: Math.PI * 2, step: 0.05, onChange: props.setSunTimeOffset, label: 'Time Offset' }
                    }),
                    'Shadows': folder({
                        shadowsEnabled: { value: true, onChange: (v) => props.setDebugShadowsEnabled(!!v), label: 'Enabled' },
                        sunBias: { value: -0.0005, min: -0.01, max: 0.01, step: 0.0001, onChange: props.setSunShadowBias, label: 'Bias' },
                        sunNormalBias: { value: 0.02, min: 0.0, max: 0.2, step: 0.001, onChange: props.setSunShadowNormalBias, label: 'Normal Bias' },
                        sunMapSize: {
                            value: 2048,
                            options: { '1024': 1024, '2048': 2048, '4096': 4096 },
                            onChange: (v) => props.setSunShadowMapSize(Number(v)),
                            label: 'Map Size'
                        },
                        sunCamSize: { value: 200, min: 50, max: 500, step: 10, onChange: props.setSunShadowCamSize, label: 'Cam Size' },
                    })
                }),
                Moon: folder({
                    moonIntensity: { value: 1.7, min: 0.0, max: 3.0, step: 0.01, onChange: props.setMoonIntensityMul, label: 'Intensity' },
                }),
                Ambient: folder({
                    ambientIntensity: { value: 1.0, min: 0.0, max: 2.5, step: 0.01, onChange: props.setAmbientIntensityMul, label: 'Intensity' },
                }),
                IBL: folder({
                    iblEnabled: { value: false, onChange: (v) => props.setIblEnabled(!!v), label: 'Enabled' },
                    iblIntensity: { value: 0.4, min: 0.0, max: 2.0, step: 0.01, onChange: props.setIblIntensity, label: 'Intensity' },
                }),
                Fog: folder({
                    fogNear: { value: 20, min: 0, max: 120, step: 1, onChange: props.setFogNear, label: 'Near' },
                    fogFar: { value: 160, min: 20, max: 600, step: 5, onChange: props.setFogFar, label: 'Far' },
                })
            }, { collapsed: false }),

            'Post Processing': folder({
                ppEnabled: { value: true, onChange: (v) => props.setPostProcessingEnabled(!!v), label: 'Master Switch' },
                bloomEnabled: { value: true, onChange: (v) => props.setBloomEnabled(!!v), label: 'Bloom Enabled' },
                bloomIntensity: { value: 0.6, min: 0.0, max: 2.0, step: 0.01, onChange: props.setBloomIntensity, label: 'Bloom Int' },
                bloomThreshold: { value: 0.4, min: 0.0, max: 1.5, step: 0.01, onChange: props.setBloomThreshold, label: 'Bloom Thresh' },
                exposureSurface: { value: 0.6, min: 0.2, max: 1.5, step: 0.01, onChange: props.setExposureSurface, label: 'Exp Surface' },
                exposureCaveMax: { value: 1.3, min: 0.4, max: 2.5, step: 0.01, onChange: props.setExposureCaveMax, label: 'Exp Cave' },
                exposureUnderwater: { value: 0.8, min: 0.2, max: 1.2, step: 0.01, onChange: props.setExposureUnderwater, label: 'Exp Underwater' },
                aoEnabled: { value: true, onChange: (v) => props.setAoEnabled(!!v), label: 'AO Enabled' },
                aoIntensity: { value: 2.0, min: 0.0, max: 6.0, step: 0.1, onChange: props.setAoIntensity, label: 'AO Intensity' },
                caOffset: { value: 0.002, min: 0.0, max: 0.01, step: 0.0001, onChange: props.setCaOffset, label: 'Chrom. Abb.' },
                vignetteDarkness: { value: 0.5, min: 0.0, max: 1.0, step: 0.05, onChange: props.setVignetteDarkness, label: 'Vignette' },
            }, { collapsed: true }),

            'Terrain': folder({
                Material: folder({
                    triplanarDetail: { value: 1.0, min: 0.0, max: 1.0, step: 0.01, onChange: props.setTriplanarDetail, label: 'Detail Mix' },
                    terrainWetness: { value: true, onChange: (v) => props.setTerrainWetnessEnabled(!!v), label: 'Wetness' },
                    terrainMoss: { value: true, onChange: (v) => props.setTerrainMossEnabled(!!v), label: 'Moss' },
                    terrainRoughnessMin: { value: 0.0, min: 0.0, max: 1.0, step: 0.01, onChange: props.setTerrainRoughnessMin, label: 'Roughness Min' },
                }),
                Rendering: folder({
                    chunkTint: { value: false, onChange: (v) => props.setTerrainChunkTintEnabled(!!v), label: 'Chunk Tint' },
                    wireframe: { value: false, onChange: (v) => props.setTerrainWireframeEnabled(!!v), label: 'Wireframe' },
                    weightsView: { value: 'off', options: { Off: 'off', Snow: 'snow', Grass: 'grass', 'Snow - Grass': 'snowMinusGrass', Dominant: 'dominant' }, onChange: (v) => props.setTerrainWeightsView(String(v)), label: 'Weights View' },
                    terrainFade: { value: true, onChange: (v) => props.setTerrainFadeEnabled(!!v), label: 'Chunk Fade' },
                    shaderFog: { value: true, onChange: (v) => props.setTerrainShaderFogEnabled(!!v), label: 'Shader Fog' },
                    shaderFogStr: { value: 0.9, min: 0.0, max: 1.5, step: 0.05, onChange: props.setTerrainShaderFogStrength, label: 'Fog Strength' },
                    threeFog: { value: true, onChange: (v) => props.setTerrainThreeFogEnabled(!!v), label: 'Three Fog' },
                }),
                Debug: folder({
                    bedrock: { value: true, onChange: (v) => props.setBedrockPlaneEnabled(!!v), label: 'Bedrock Plane' },
                    polyOffset: { value: false, onChange: (v) => props.setTerrainPolygonOffsetEnabled(!!v), label: 'Poly Offset' },
                    poFactor: { value: -1.0, min: -10.0, max: 10.0, step: 0.1, onChange: props.setTerrainPolygonOffsetFactor, label: 'PO Factor' },
                    poUnits: { value: -1.0, min: -10.0, max: 10.0, step: 0.1, onChange: props.setTerrainPolygonOffsetUnits, label: 'PO Units' },
                    snapEpsilon: { value: 0.02, min: 0.01, max: 0.15, step: 0.01, onChange: setSnapEpsilon, label: 'Snap Epsilon' }
                })
            }, { collapsed: true }),

            'Tools': folder({
                'Copy Config': button(() => {
                    const config = { ...props.values };
                    console.log('[DebugConfig] JSON:', JSON.stringify(config, null, 2));
                    navigator.clipboard.writeText(JSON.stringify(config, null, 2))
                        .then(() => alert('Configuration copied to clipboard!'))
                        .catch((err) => console.error('Failed to copy config:', err));
                })
            }, { collapsed: false }),

            'UI': folder({
                levaWidth: { value: 520, min: 320, max: 900, step: 10, onChange: props.setLevaWidth, label: 'Width' },
                levaScale: { value: 1.15, min: 0.8, max: 1.8, step: 0.05, onChange: props.setLevaScale, label: 'Scale' },
            }, { collapsed: true })
        },
        []
    );
    return null;
};
