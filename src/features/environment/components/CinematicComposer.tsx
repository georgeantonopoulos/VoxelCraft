import React from 'react';
import * as THREE from 'three';
import { EffectComposer, Bloom, ToneMapping, N8AO, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import { useEnvironmentStore } from '@state/EnvironmentStore';

/**
 * ExposureToneMapping
 * Simple exposure shift so when you're in a dark cavern, looking outside remains bright/over-exposed.
 */
const ExposureToneMapping: React.FC<{
    surfaceExposure: number;
    caveExposureMax: number;
    underwaterExposure: number;
}> = ({ surfaceExposure, caveExposureMax, underwaterExposure }) => {
    const undergroundBlend = useEnvironmentStore((s) => s.undergroundBlend);
    const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

    const caveExposure = THREE.MathUtils.lerp(surfaceExposure, caveExposureMax, undergroundBlend);
    const exposure = THREE.MathUtils.lerp(caveExposure, underwaterExposure, underwaterBlend);

    return <ToneMapping exposure={exposure} />;
};

export const CinematicComposer: React.FC<{
    aoEnabled: boolean;
    aoIntensity: number;
    bloomEnabled: boolean;
    bloomThreshold: number;
    bloomIntensity: number;
    exposureSurface: number;
    exposureCaveMax: number;
    exposureUnderwater: number;
    caOffset: number;
    vignetteDarkness: number;
    skipPost?: boolean;
}> = (props) => {
    const underwaterBlend = useEnvironmentStore((s) => s.underwaterBlend);

    if (props.skipPost) return null;

    return (
        <EffectComposer>
            {props.aoEnabled && (
                <N8AO
                    halfRes
                    quality="performance"
                    intensity={props.aoIntensity}
                    color="black"
                    aoRadius={2.0}
                    distanceFalloff={200}
                    screenSpaceRadius={false}
                />
            )}

            {props.bloomEnabled && (
                <Bloom
                    luminanceThreshold={props.bloomThreshold}
                    mipmapBlur
                    intensity={props.bloomIntensity}
                />
            )}

            <ExposureToneMapping
                surfaceExposure={props.exposureSurface}
                caveExposureMax={props.exposureCaveMax}
                underwaterExposure={props.exposureUnderwater}
            />

            <ChromaticAberration
                offset={[
                    props.caOffset * 0.1 + (underwaterBlend * 0.004),
                    props.caOffset * 0.1 + (underwaterBlend * 0.004)
                ]}
                radialModulation={true}
                modulationOffset={0}
            />

            <Vignette
                eskil={false}
                offset={0.1}
                darkness={props.vignetteDarkness + (underwaterBlend * 0.35)}
            />
        </EffectComposer>
    );
};
