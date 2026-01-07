import React, { useEffect, useCallback } from 'react';
import { useControls, folder, button, useStoreContext } from 'leva';
import { setSnapEpsilon } from '@/constants';

// Global export function for automation (accessible via window.__vcDebug.exportSettings())
declare global {
    interface Window {
        __vcDebug?: {
            exportSettings: () => Record<string, any>;
            copySettings: () => void;
        };
    }
}

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
    setAtmosphereHaze: (v: number) => void;
    setAtmosphereBrightness: (v: number) => void;
    setSunIntensityMul: (v: number) => void;
    setAmbientIntensityMul: (v: number) => void;
    setMoonIntensityMul: (v: number) => void;
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
    setHeightFogEnabled: (v: boolean) => void;
    setHeightFogStrength: (v: number) => void;
    setHeightFogRange: (v: number) => void;
    setHeightFogOffset: (v: number) => void;
    // Biome Fog
    setBiomeFogEnabled: (v: boolean) => void;
    // Sun Shadow Params
    setSunShadowBias: (v: number) => void;
    setSunShadowNormalBias: (v: number) => void;
    setSunShadowMapSize: (v: number) => void;
    setSunShadowCamSize: (v: number) => void;
    // Sun Orbit Params
    setSunOrbitRadius: (v: number) => void;
    setSunOrbitSpeed: (v: number) => void;
    setSunTimeOffset: (v: number) => void;
    // Fragment Normal Perturbation (AAA terrain quality)
    setFragmentNormalStrength: (v: number) => void;
    setFragmentNormalScale: (v: number) => void;
    // Global Illumination
    setGiEnabled: (v: boolean) => void;
    setGiIntensity: (v: number) => void;
    // Color Grading
    setTerrainSaturation: (v: number) => void;
    // STATE VALUES PROPS (needed for export)
    values: any;
}> = (props) => {
    // Get Leva store context for exporting ALL controls
    const store = useStoreContext();

    // Helper to export ALL Leva controls (from all panels across the app)
    const exportAllControls = useCallback(() => {
        if (!store) {
            console.warn('[DebugConfig] Store not available');
            return props.values;
        }

        const data = store.getData();
        const allValues: Record<string, any> = {};

        // Extract values from Leva store data
        Object.entries(data).forEach(([key, item]: [string, any]) => {
            // Skip folders and buttons, only export actual values
            if (item && item.type !== 'FOLDER' && item.type !== 'BUTTON' && item.value !== undefined) {
                allValues[key] = item.value;
            }
        });

        return allValues;
    }, [store, props.values]);

    // Copy settings to clipboard with formatted output
    const copySettingsToClipboard = useCallback(() => {
        const allControls = exportAllControls();
        const exportData = {
            _exported: new Date().toISOString(),
            _source: 'VoxelCraft Debug Panel',
            controls: allControls
        };
        const json = JSON.stringify(exportData, null, 2);
        console.log('[DebugConfig] All settings exported:', json);
        navigator.clipboard.writeText(json)
            .then(() => console.log(`[DebugConfig] ${Object.keys(allControls).length} settings copied to clipboard`))
            .catch((err) => console.error('Failed to copy config:', err));
        return allControls;
    }, [exportAllControls]);

    // Expose export functions globally for automation
    useEffect(() => {
        window.__vcDebug = {
            exportSettings: exportAllControls,
            copySettings: copySettingsToClipboard
        };
        return () => {
            delete window.__vcDebug;
        };
    }, [exportAllControls, copySettingsToClipboard]);

    // Keyboard shortcut: Ctrl+Shift+E to export settings
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                copySettingsToClipboard();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [copySettingsToClipboard]);

    useControls(
        {
            // ═══════════════════════════════════════════════════════════════
            // LIGHTING
            // ═══════════════════════════════════════════════════════════════
            'Lighting': folder({
                'Sun': folder({
                    sunIntensity: { value: 4.8, min: 0.0, max: 10.0, step: 0.1, onChange: props.setSunIntensityMul, label: 'Intensity' },
                    radius: { value: 300, min: 50, max: 1000, step: 10, onChange: props.setSunOrbitRadius, label: 'Orbit Radius' },
                    speed: { value: 0.025, min: 0.0, max: 0.5, step: 0.001, onChange: props.setSunOrbitSpeed, label: 'Orbit Speed' },
                    timeOffset: { value: 0.0, min: 0.0, max: Math.PI * 2, step: 0.05, onChange: props.setSunTimeOffset, label: 'Time Offset' },
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
                    }, { collapsed: true }),
                }, { collapsed: true }),
                'Moon': folder({
                    moonIntensity: { value: 1.7, min: 0.0, max: 3.0, step: 0.01, onChange: props.setMoonIntensityMul, label: 'Intensity' },
                }, { collapsed: true }),
                'Ambient': folder({
                    ambientIntensity: { value: 1.0, min: 0.0, max: 2.5, step: 0.01, onChange: props.setAmbientIntensityMul, label: 'Intensity' },
                }, { collapsed: true }),
                'GI (Voxel Light)': folder({
                    giEnabled: { value: true, onChange: (v) => props.setGiEnabled(!!v), label: 'Enabled' },
                    giIntensity: { value: 5.0, min: 0.0, max: 10.0, step: 0.1, onChange: props.setGiIntensity, label: 'Intensity' },
                }, { collapsed: true }),
            }, { collapsed: true }),

            // ═══════════════════════════════════════════════════════════════
            // ATMOSPHERE & FOG
            // ═══════════════════════════════════════════════════════════════
            'Atmosphere': folder({
                haze: { value: 0.25, min: 0.0, max: 1.0, step: 0.01, onChange: props.setAtmosphereHaze, label: 'Haze' },
                brightness: { value: 1.0, min: 0.6, max: 1.6, step: 0.01, onChange: props.setAtmosphereBrightness, label: 'Brightness' },
                'Distance Fog': folder({
                    fogNear: { value: 40, min: 0, max: 120, step: 1, onChange: props.setFogNear, label: 'Near' },
                    fogFar: { value: 85, min: 20, max: 600, step: 5, onChange: props.setFogFar, label: 'Far' },
                }, { collapsed: true }),
                'Height Fog': folder({
                    hFogEnabled: { value: true, onChange: (v) => props.setHeightFogEnabled(!!v), label: 'Enabled' },
                    hFogStrength: { value: 0.35, min: 0.0, max: 1.0, step: 0.05, onChange: props.setHeightFogStrength, label: 'Strength' },
                    hFogRange: { value: 50.0, min: 5.0, max: 100.0, step: 1.0, onChange: props.setHeightFogRange, label: 'Range' },
                    hFogOffset: { value: 4.0, min: -20.0, max: 60.0, step: 1.0, onChange: props.setHeightFogOffset, label: 'Offset' },
                    biomeFog: { value: true, onChange: (v) => props.setBiomeFogEnabled(!!v), label: 'Biome Fog' },
                }, { collapsed: true }),
            }, { collapsed: true }),

            // ═══════════════════════════════════════════════════════════════
            // POST PROCESSING
            // ═══════════════════════════════════════════════════════════════
            'Post Processing': folder({
                ppEnabled: { value: true, onChange: (v) => props.setPostProcessingEnabled(!!v), label: 'Master Switch' },
                'Bloom': folder({
                    bloomEnabled: { value: true, onChange: (v) => props.setBloomEnabled(!!v), label: 'Enabled' },
                    bloomIntensity: { value: 0.6, min: 0.0, max: 2.0, step: 0.01, onChange: props.setBloomIntensity, label: 'Intensity' },
                    bloomThreshold: { value: 0.4, min: 0.0, max: 1.5, step: 0.01, onChange: props.setBloomThreshold, label: 'Threshold' },
                }, { collapsed: true }),
                'Exposure': folder({
                    exposureSurface: { value: 0.6, min: 0.2, max: 1.5, step: 0.01, onChange: props.setExposureSurface, label: 'Surface' },
                    exposureCaveMax: { value: 1.3, min: 0.4, max: 2.5, step: 0.01, onChange: props.setExposureCaveMax, label: 'Cave' },
                    exposureUnderwater: { value: 0.8, min: 0.2, max: 1.2, step: 0.01, onChange: props.setExposureUnderwater, label: 'Underwater' },
                }, { collapsed: true }),
                'Effects': folder({
                    aoEnabled: { value: true, onChange: (v) => props.setAoEnabled(!!v), label: 'AO Enabled' },
                    aoIntensity: { value: 2.0, min: 0.0, max: 6.0, step: 0.1, onChange: props.setAoIntensity, label: 'AO Intensity' },
                    caOffset: { value: 0.00001, min: 0.0, max: 0.01, step: 0.00001, onChange: props.setCaOffset, label: 'Chrom. Abb.' },
                    vignetteDarkness: { value: 0.5, min: 0.0, max: 1.0, step: 0.05, onChange: props.setVignetteDarkness, label: 'Vignette' },
                }, { collapsed: true }),
            }, { collapsed: true }),

            // ═══════════════════════════════════════════════════════════════
            // TERRAIN
            // ═══════════════════════════════════════════════════════════════
            'Terrain': folder({
                'Material': folder({
                    triplanarDetail: { value: 1.0, min: 0.0, max: 1.0, step: 0.01, onChange: props.setTriplanarDetail, label: 'Detail Mix' },
                    saturation: { value: 1.5, min: 0.5, max: 2.0, step: 0.05, onChange: props.setTerrainSaturation, label: 'Saturation' },
                    terrainWetness: { value: true, onChange: (v) => props.setTerrainWetnessEnabled(!!v), label: 'Wetness' },
                    terrainMoss: { value: true, onChange: (v) => props.setTerrainMossEnabled(!!v), label: 'Moss' },
                    terrainRoughnessMin: { value: 0.0, min: 0.0, max: 1.0, step: 0.01, onChange: props.setTerrainRoughnessMin, label: 'Roughness Min' },
                    fragNormalStr: { value: 0.6, min: 0.0, max: 1.0, step: 0.05, onChange: props.setFragmentNormalStrength, label: 'Normal Strength' },
                    fragNormalScale: { value: 0.5, min: 0.1, max: 1.0, step: 0.05, onChange: props.setFragmentNormalScale, label: 'Normal Scale' },
                }, { collapsed: true }),
                'Rendering': folder({
                    terrainFade: { value: true, onChange: (v) => props.setTerrainFadeEnabled(!!v), label: 'Chunk Fade' },
                    shaderFog: { value: true, onChange: (v) => props.setTerrainShaderFogEnabled(!!v), label: 'Shader Fog' },
                    shaderFogStr: { value: 0.8, min: 0.0, max: 1.5, step: 0.05, onChange: props.setTerrainShaderFogStrength, label: 'Fog Strength' },
                    threeFog: { value: true, onChange: (v) => props.setTerrainThreeFogEnabled(!!v), label: 'Three Fog' },
                }, { collapsed: true }),
                'Debug': folder({
                    chunkTint: { value: false, onChange: (v) => props.setTerrainChunkTintEnabled(!!v), label: 'Chunk Tint' },
                    wireframe: { value: false, onChange: (v) => props.setTerrainWireframeEnabled(!!v), label: 'Wireframe' },
                    weightsView: { value: 'off', options: { Off: 'off', Snow: 'snow', Grass: 'grass', 'Snow - Grass': 'snowMinusGrass', Dominant: 'dominant' }, onChange: (v) => props.setTerrainWeightsView(String(v)), label: 'Weights View' },
                    bedrock: { value: true, onChange: (v) => props.setBedrockPlaneEnabled(!!v), label: 'Bedrock Plane' },
                    polyOffset: { value: false, onChange: (v) => props.setTerrainPolygonOffsetEnabled(!!v), label: 'Poly Offset' },
                    poFactor: { value: -1.0, min: -10.0, max: 10.0, step: 0.1, onChange: props.setTerrainPolygonOffsetFactor, label: 'PO Factor' },
                    poUnits: { value: -1.0, min: -10.0, max: 10.0, step: 0.1, onChange: props.setTerrainPolygonOffsetUnits, label: 'PO Units' },
                    snapEpsilon: { value: 0.02, min: 0.01, max: 0.15, step: 0.01, onChange: setSnapEpsilon, label: 'Snap Epsilon' }
                }, { collapsed: true }),
            }, { collapsed: true }),

            // ═══════════════════════════════════════════════════════════════
            // TOOLS & UI
            // ═══════════════════════════════════════════════════════════════
            'Export': folder({
                'Copy All (Ctrl+Shift+E)': button(() => {
                    const controls = copySettingsToClipboard();
                    alert(`${Object.keys(controls).length} settings copied to clipboard!`);
                }),
                'Download JSON': button(() => {
                    const allControls = exportAllControls();
                    const exportData = {
                        _exported: new Date().toISOString(),
                        _source: 'VoxelCraft Debug Panel',
                        controls: allControls
                    };
                    const json = JSON.stringify(exportData, null, 2);
                    const blob = new Blob([json], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `voxelcraft-debug-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    console.log(`[DebugConfig] Downloaded ${Object.keys(allControls).length} settings`);
                }),
                'Log Store Data': button(() => {
                    if (store) {
                        console.log('[DebugConfig] Full store data:', store.getData());
                    }
                }),
            }, { collapsed: true }),

            'Panel': folder({
                levaWidth: { value: 520, min: 320, max: 900, step: 10, onChange: props.setLevaWidth, label: 'Width' },
                levaScale: { value: 1.15, min: 0.8, max: 1.8, step: 0.05, onChange: props.setLevaScale, label: 'Scale' },
            }, { collapsed: true })
        },
        [store]
    );
    return null;
};
