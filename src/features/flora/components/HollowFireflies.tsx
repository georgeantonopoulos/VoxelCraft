import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface HollowFirefliesProps {
    /** Number of fireflies (default: 3) */
    count?: number;
    /** Radius of orbit around the hollow (default: 1.5) */
    radius?: number;
    /** Height range for fireflies (default: [0.5, 2.0]) */
    heightRange?: [number, number];
    /** Base seed for deterministic positioning */
    seed?: number;
}

/**
 * HollowFireflies - Blue flora fireflies that orbit around Root Hollows
 *
 * Uses the SAME instanced mesh + shader pattern as AmbientLife fireflies,
 * with position stored in instanceMatrix and animation via shader.
 */
export const HollowFireflies: React.FC<HollowFirefliesProps> = ({
    count = 3,
    radius = 1.5,
    heightRange = [0.5, 2.0],
    seed = 42
}) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const seedsRef = useRef<Float32Array>(new Float32Array(count));
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Match AmbientLife sizes exactly
    const BASE_RADIUS_MIN = 0.012;
    const BASE_RADIUS_MAX = 0.026;

    // Generate deterministic initial positions based on seed
    const initialPositions = useMemo(() => {
        const positions: Array<{ x: number; y: number; z: number; seed: number }> = [];
        for (let i = 0; i < count; i++) {
            const hash = (n: number) => {
                const x = Math.sin(n) * 43758.5453;
                return x - Math.floor(x);
            };
            const s = hash(seed * 127.1 + i * 311.7);
            const angle = (i / count) * Math.PI * 2 + hash(seed + i) * 0.5;
            const r = radius * (0.7 + hash(seed * 13.3 + i) * 0.6);
            const h = heightRange[0] + hash(seed * 7.9 + i * 17.3) * (heightRange[1] - heightRange[0]);

            positions.push({
                x: Math.cos(angle) * r,
                y: h,
                z: Math.sin(angle) * r,
                seed: s
            });
        }
        return positions;
    }, [count, radius, heightRange, seed]);

    // Shader material - follows AmbientLife pattern exactly
    const material = useMemo(() => {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color('#4488ff') }, // Blue flora color
                uDriftAmp: { value: 0.35 },
            },
            // Match AmbientLife shader exactly, just with orbit added
            vertexShader: `
                uniform float uTime;
                uniform float uDriftAmp;
                attribute float aSeed;
                varying float vBlink;

                float hash01(float x) {
                    return fract(sin(x) * 43758.5453);
                }

                void main() {
                    // Blink: smooth pulse with stable per-instance seed
                    float phase = aSeed * 6.28318530718;
                    float speed = mix(1.2, 2.1, hash01(aSeed * 13.7));
                    float blink = 0.45 + 0.55 * sin(uTime * speed + phase);
                    vBlink = blink;

                    // Drift: tiny local wobble (same as AmbientLife)
                    vec3 drift = vec3(
                        sin(uTime * 0.7 + aSeed * 12.3),
                        sin(uTime * 0.9 + aSeed * 5.1),
                        cos(uTime * 0.6 + aSeed * 9.7)
                    ) * uDriftAmp;

                    // Scale geometry by blink
                    float s = max(0.08, 0.45 + 0.75 * blink);
                    vec3 pos = position * s;

                    // Use instanceMatrix like AmbientLife does
                    mat4 im = instanceMatrix;
                    im[3].xyz += drift;
                    gl_Position = projectionMatrix * modelViewMatrix * im * vec4(pos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vBlink;

                void main() {
                    float a = clamp(vBlink, 0.0, 1.0) * 0.95;
                    gl_FragColor = vec4(uColor, a);
                }
            `,
        });
    }, []);

    useLayoutEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;

        // Set up seed attribute
        for (let i = 0; i < count; i++) {
            seedsRef.current[i] = initialPositions[i].seed;
        }
        mesh.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedsRef.current, 1));

        // Set up instance matrices WITH positions (like AmbientLife)
        for (let i = 0; i < count; i++) {
            const pos = initialPositions[i];
            const h = Math.abs(Math.sin(pos.seed * 437.58)) % 1;
            const baseScale = THREE.MathUtils.lerp(BASE_RADIUS_MIN, BASE_RADIUS_MAX, h);

            dummy.position.set(pos.x, pos.y, pos.z);
            dummy.scale.setScalar(baseScale);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        }

        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
    }, [count, initialPositions, dummy]);

    useFrame((state) => {
        if (!meshRef.current) return;
        material.uniforms.uTime.value = state.clock.elapsedTime;
    });

    return (
        <instancedMesh
            ref={meshRef}
            args={[undefined, undefined, count]}
            frustumCulled={false}
        >
            <icosahedronGeometry args={[1, 0]} />
            <primitive object={material} attach="material" />
        </instancedMesh>
    );
};
