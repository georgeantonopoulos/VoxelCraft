import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import lumaShapeUrl from '@assets/images/luma_shape.png';

interface LumaSwarmProps {
    dissipating: boolean; // Triggers the end sequence
}

// Tuning
const SAMPLE_RESOLUTION = 64; // Scan 64x64 grid
const PARTICLE_SIZE = 0.06;   // Tiny spheres
const SWARM_RADIUS = 3.5;     // Size of the shape in world units
const FORMATION_DURATION = 10.0; // Seconds to fully form
const DISSIPATION_SPEED = 1.0;

export const LumaSwarm: React.FC<LumaSwarmProps> = ({ dissipating }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<any>(null);
    const coreRef = useRef<THREE.Group>(null);
    const texture = useLoader(THREE.TextureLoader, lumaShapeUrl);

    // State for shader uniforms
    const [elapsed, setElapsed] = useState(0);

    // 1. Process Texture to get Target Positions
    const particleData = useMemo(() => {
        if (!texture || !texture.image) return null;

        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_RESOLUTION;
        canvas.height = SAMPLE_RESOLUTION;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Draw image to read pixels
        ctx.drawImage(texture.image, 0, 0, SAMPLE_RESOLUTION, SAMPLE_RESOLUTION);
        const data = ctx.getImageData(0, 0, SAMPLE_RESOLUTION, SAMPLE_RESOLUTION).data;

        const targets: number[] = []; // x, y, z
        const randoms: number[] = []; // random offsets for start/noise

        for (let y = 0; y < SAMPLE_RESOLUTION; y++) {
            for (let x = 0; x < SAMPLE_RESOLUTION; x++) {
                const i = (y * SAMPLE_RESOLUTION + x) * 4;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const a = data[i + 3];

                // Detect visible pixels (Blueish or just Opaque)
                // The prompt implies we use the shape, color is overridden to Cyan.
                if (a > 50) {
                    // Normalize -0.5 to 0.5
                    const nX = (x / SAMPLE_RESOLUTION) - 0.5;
                    const nY = (1.0 - (y / SAMPLE_RESOLUTION)) - 0.5; // Flip Y

                    targets.push(nX * SWARM_RADIUS, nY * SWARM_RADIUS, 0); // Z=0 flat plane
                    randoms.push(Math.random(), Math.random(), Math.random());
                }
            }
        }

        return {
            targets: new Float32Array(targets),
            randoms: new Float32Array(randoms),
            count: targets.length / 3
        };
    }, [texture]);

    // 2. Setup InstancedMesh Attributes
    useEffect(() => {
        if (meshRef.current && particleData) {
            meshRef.current.count = particleData.count;

            // Dummy matrix setup (identity), shader does the positioning
            const dummy = new THREE.Object3D();
            for (let i = 0; i < particleData.count; i++) {
                dummy.scale.setScalar(PARTICLE_SIZE);
                dummy.updateMatrix();
                meshRef.current.setMatrixAt(i, dummy.matrix);
            }
            meshRef.current.instanceMatrix.needsUpdate = true;

            // Custom Attributes
            meshRef.current.geometry.setAttribute(
                'aTargetPos',
                new THREE.InstancedBufferAttribute(particleData.targets, 3)
            );
            meshRef.current.geometry.setAttribute(
                'aRandom',
                new THREE.InstancedBufferAttribute(particleData.randoms, 3)
            );
        }
    }, [particleData]);

    // 3. Animation Loop
    useFrame(({ clock, camera }) => {
        if (!materialRef.current || !meshRef.current) return;

        const dt = clock.getDelta(); // Not used directly, using uTime
        const time = clock.getElapsedTime();

        // Face Camera (Billboard the whole group)
        if (meshRef.current) {
            meshRef.current.lookAt(camera.position);
        }

        // Update Uniforms
        // Ramp formation progress 0 -> 1 over 10s
        let progress = Math.min(elapsed + dt, FORMATION_DURATION) / FORMATION_DURATION;
        if (dissipating) {
            // Keep progress at max or handle transition?
            // Actually uDissipate handles the exit.
        } else {
             setElapsed(e => e + dt);
        }

        // Pass 'real' absolute time for noise
        materialRef.current.uniforms.uTime.value = time;
        // Pass normalized progress (0 to 1)
        materialRef.current.uniforms.uProgress.value = Math.min(elapsed / FORMATION_DURATION, 1.0);

        // Dissipation
        const curDissipate = materialRef.current.uniforms.uDissipate.value;
        if (dissipating) {
            materialRef.current.uniforms.uDissipate.value = Math.min(curDissipate + dt * DISSIPATION_SPEED, 1.0);
        }

        // Core Luma Intensity Ramp
        if (coreRef.current) {
            const light = coreRef.current.children.find(c => (c as THREE.PointLight).isPointLight) as THREE.PointLight;
            if (light) {
                // Ramp from 2 to 10 intensity
                const targetIntensity = dissipating ? 0 : (2.0 + (elapsed / FORMATION_DURATION) * 20.0);
                light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, 0.05);

                // Scale core up slightly then shrink on dissipate
                const scale = dissipating ? Math.max(0, 1.0 - curDissipate) : (1.0 + (elapsed/FORMATION_DURATION) * 0.5);
                coreRef.current.scale.setScalar(scale);
            }
        }
    });

    const uniforms = useMemo(() => ({
        uTime: { value: 0 },
        uProgress: { value: 0 }, // 0=Start, 1=Formed
        uDissipate: { value: 0 }, // 0=Solid, 1=Gone
        uColor: { value: new THREE.Color('#4deeea') } // Luma Cyan
    }), []);

    if (!particleData) return null;

    return (
        <group>
            {/* The Core Luma (Visual Clone) */}
            <group ref={coreRef}>
                <pointLight color="#4deeea" distance={10} decay={2} intensity={2} />
                <mesh>
                    <sphereGeometry args={[0.25, 32, 32]} />
                    <meshStandardMaterial
                        emissive="#4deeea"
                        emissiveIntensity={2.0}
                        toneMapped={false}
                        color="#222"
                    />
                </mesh>
            </group>

            {/* The Particle Swarm */}
            <instancedMesh
                ref={meshRef}
                args={[undefined, undefined, particleData.count]}
                frustumCulled={false} // Always visible
            >
                <sphereGeometry args={[1, 8, 8]} /> {/* Scale controlled by matrix */}
                <CustomShaderMaterial
                    ref={materialRef}
                    baseMaterial={THREE.MeshStandardMaterial}
                    transparent
                    uniforms={uniforms}
                    toneMapped={false}
                    vertexShader={`
                        attribute vec3 aTargetPos;
                        attribute vec3 aRandom;

                        uniform float uTime;
                        uniform float uProgress;
                        uniform float uDissipate;

                        varying float vAlpha;

                        // Simplex-ish noise
                        vec3 hash3(vec3 p) {
                            p = vec3(dot(p,vec3(127.1,311.7, 74.7)),
                                     dot(p,vec3(269.5,183.3,246.1)),
                                     dot(p,vec3(113.5,271.9,124.6)));
                            return fract(sin(p)*43758.5453123);
                        }

                        void main() {
                            // 1. Start Position (Random cloud near center)
                            vec3 startPos = (aRandom - 0.5) * 2.0; // +/- 1.0 unit box

                            // 2. Target Position (The Shape)
                            // Add some wobble to target
                            vec3 targetPos = aTargetPos;
                            targetPos.z += sin(uTime * 2.0 + aRandom.x * 10.0) * 0.1; // Breathing Z
                            targetPos.x += cos(uTime * 1.5 + aRandom.y * 10.0) * 0.05;

                            // 3. Interpolate
                            // Cubic ease out
                            float t = uProgress;
                            float ease = 1.0 - pow(1.0 - t, 3.0);

                            vec3 pos = mix(startPos, targetPos, ease);

                            // 4. Dissipation (Explode/Scatter)
                            if (uDissipate > 0.0) {
                                vec3 dir = normalize(pos) + (aRandom - 0.5); // Outward + Chaos
                                pos += dir * uDissipate * 5.0; // Fly away
                            }

                            // Calculate Alpha for fade
                            vAlpha = 1.0 - uDissipate;

                            csm_Position = pos;
                        }
                    `}
                    fragmentShader={`
                        uniform vec3 uColor;
                        varying float vAlpha;

                        void main() {
                            csm_DiffuseColor = vec4(uColor, vAlpha);
                            csm_Emissive = uColor * 2.0; // Super bright

                            if (vAlpha < 0.01) discard;
                        }
                    `}
                />
            </instancedMesh>
        </group>
    );
};
