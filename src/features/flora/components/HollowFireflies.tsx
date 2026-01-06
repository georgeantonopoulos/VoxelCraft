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
 * Uses the same instanced mesh + shader pattern as AmbientLife fireflies,
 * but with:
 * - Blue color (#4488ff) instead of yellow-green
 * - Fewer particles (3 by default)
 * - Local positioning relative to parent (Root Hollow)
 * - Slightly larger size for visibility
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

    // Tunables
    const BASE_RADIUS_MIN = 0.025;
    const BASE_RADIUS_MAX = 0.045;

    // Generate deterministic initial positions based on seed
    const initialPositions = useMemo(() => {
        const positions: Array<{ x: number; y: number; z: number; seed: number }> = [];
        for (let i = 0; i < count; i++) {
            // Deterministic pseudo-random based on seed + index
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

    const material = useMemo(() => {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color('#4488ff') }, // Blue flora color
                uDriftAmp: { value: 0.4 },
                uOrbitSpeed: { value: 0.3 },
            },
            vertexShader: `
                uniform float uTime;
                uniform float uDriftAmp;
                uniform float uOrbitSpeed;
                attribute float aSeed;
                attribute vec3 aBasePos;
                varying float vBlink;

                float hash01(float x) {
                    return fract(sin(x) * 43758.5453);
                }

                void main() {
                    // Blink: smooth pulse with stable per-instance seed
                    float phase = aSeed * 6.28318530718;
                    float speed = mix(1.0, 1.8, hash01(aSeed * 13.7));
                    float blink = 0.5 + 0.5 * sin(uTime * speed + phase);
                    vBlink = blink;

                    // Orbital motion around the hollow
                    float orbitPhase = aSeed * 6.28318530718;
                    float orbitAngle = uTime * uOrbitSpeed * mix(0.8, 1.2, hash01(aSeed * 7.3)) + orbitPhase;

                    // Get base position from attribute
                    vec3 basePos = aBasePos;
                    float baseRadius = length(basePos.xz);
                    float baseAngle = atan(basePos.z, basePos.x);

                    // Apply orbital rotation
                    float newAngle = baseAngle + orbitAngle;
                    vec3 orbitPos = vec3(
                        cos(newAngle) * baseRadius,
                        basePos.y,
                        sin(newAngle) * baseRadius
                    );

                    // Drift: gentle wobble
                    vec3 drift = vec3(
                        sin(uTime * 0.5 + aSeed * 12.3),
                        sin(uTime * 0.7 + aSeed * 5.1) * 0.5,
                        cos(uTime * 0.4 + aSeed * 9.7)
                    ) * uDriftAmp;

                    // Vertical bob
                    float bob = sin(uTime * 0.8 + aSeed * 3.14) * 0.3;
                    orbitPos.y += bob;

                    // Scale geometry by blink
                    float s = max(0.15, 0.5 + 0.7 * blink);
                    vec3 pos = position * s;

                    vec3 finalPos = orbitPos + drift;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + finalPos, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 uColor;
                varying float vBlink;

                void main() {
                    // Soft glow with additive blending
                    float a = clamp(vBlink, 0.0, 1.0) * 0.9;
                    gl_FragColor = vec4(uColor * (1.0 + vBlink * 0.5), a);
                }
            `,
        });
    }, []);

    useLayoutEffect(() => {
        const mesh = meshRef.current;
        if (!mesh) return;

        // Create base position attribute for orbital motion
        const basePosArray = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const pos = initialPositions[i];
            basePosArray[i * 3 + 0] = pos.x;
            basePosArray[i * 3 + 1] = pos.y;
            basePosArray[i * 3 + 2] = pos.z;
            seedsRef.current[i] = pos.seed;
        }

        mesh.geometry.setAttribute('aBasePos', new THREE.InstancedBufferAttribute(basePosArray, 3));
        mesh.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seedsRef.current, 1));

        // Set up instance matrices (identity - position handled in shader)
        for (let i = 0; i < count; i++) {
            const h = Math.abs(Math.sin(initialPositions[i].seed * 437.58)) % 1;
            const baseScale = THREE.MathUtils.lerp(BASE_RADIUS_MIN, BASE_RADIUS_MAX, h);

            dummy.position.set(0, 0, 0);
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
            <icosahedronGeometry args={[1, 1]} />
            <primitive object={material} attach="material" />
        </instancedMesh>
    );
};
