import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import CustomShaderMaterial from 'three-custom-shader-material';
import lumaShapeUrl from '@assets/images/luma_shape.png';

interface LumaSwarmProps {
    dissipating: boolean; // Triggers the end sequence
}

// Tuning
const SAMPLE_RESOLUTION = 64; // Scan 64x64 grid
const PARTICLE_SIZE = 0.015;  // 1/10th size: keeps the swarm feeling like particles, not blobs
const FORMATION_DURATION = 10.0; // Seconds to fully form
const DISSIPATION_SPEED = 1.0;

// Approximate "fully grown" RootHollow flora-tree size.
// Derived from `src/features/flora/workers/fractal.worker.ts` for type=0 (Oak-ish):
// height ~= BASE_LENGTH * (1 - LENGTH_DECAY^(MAX_DEPTH+1)) / (1 - LENGTH_DECAY)
//      ~= 2.0 * (1 - 0.85^7) / 0.15 ~= 9.06
const EST_FLORA_TREE_HEIGHT = 9.1;
const EST_FLORA_TREE_WIDTH = 6.0; // Typical canopy span (heuristic); adjust by eye if needed.

// Staging: emit/spread first, then form into PNG silhouette (tree-sized).
// These values are injected into the shader as literals.
const EMIT_PHASE = 0.55; // Fraction of formation spent “spreading” before converging
const EMIT_RADIUS = EST_FLORA_TREE_WIDTH * 0.8;
const EMIT_HEIGHT = EST_FLORA_TREE_HEIGHT * 1.2;
const EMIT_JITTER = 4.0; // Random motion amplitude during spread
const FORM_JITTER = 0.8; // Residual randomness during convergence (fades out)

// Final silhouette dimensions (big representation of the PNG).
// We keep aspect ratio from the actual image and size it to roughly half of the previous silhouette.
const SHAPE_SCALE = 0.5;
const SHAPE_HEIGHT = EST_FLORA_TREE_HEIGHT * 1.15 * SHAPE_SCALE;

// Debug controls (keep off by default to avoid console spam/perf hits in-game)
const DEBUG_LUMA_SWARM = false;
const DEBUG_LUMA_SIMPLE_MATERIAL = false; // Renders all instances at origin (no shader animation)

export const LumaSwarm: React.FC<LumaSwarmProps> = ({ dissipating }) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const materialRef = useRef<any>(null);
    const coreRef = useRef<THREE.Group>(null);
    const texture = useLoader(THREE.TextureLoader, lumaShapeUrl);

    // Track start time - will be set on first useFrame call
    const startTimeRef = useRef<number | null>(null);

    // Debug logging
    useEffect(() => {
        if (!DEBUG_LUMA_SWARM) return;
        console.log('[LumaSwarm] Component mounted, dissipating:', dissipating);
        console.log('[LumaSwarm] Texture loaded:', !!texture);
        return () => console.log('[LumaSwarm] Component unmounted');
    }, []);

    // 1. Process Texture to get Target Positions
    const particleData = useMemo(() => {
        if (!texture || !texture.image) {
            if (DEBUG_LUMA_SWARM) console.warn('[LumaSwarm] No texture or image data available');
            return null;
        }
        if (DEBUG_LUMA_SWARM) {
            console.log('[LumaSwarm] Processing texture, size:', texture.image.width, 'x', texture.image.height);
        }

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

        // Preserve the PNG aspect ratio while scaling it to our desired world size.
        const imageAspect = texture.image.width > 0 ? (texture.image.width / texture.image.height) : 1.0;
        const shapeWidth = SHAPE_HEIGHT * imageAspect;

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
                    const nY01 = 1.0 - (y / SAMPLE_RESOLUTION); // Flip Y to 0..1 (base at 0, top at 1)

                    // Make the silhouette BIG and upright: X is centered, Y is anchored at base (0..height).
                    targets.push(nX * shapeWidth, nY01 * SHAPE_HEIGHT, 0); // Z=0 plane (faces camera during convergence)
                    randoms.push(Math.random(), Math.random(), Math.random());
                }
            }
        }

        const count = targets.length / 3;
        if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Particle count:', count);
        return {
            targets: new Float32Array(targets),
            randoms: new Float32Array(randoms),
            count
        };
    }, [texture]);

    // 2. Setup InstancedMesh Attributes
    useEffect(() => {
        if (meshRef.current && particleData) {
            meshRef.current.count = particleData.count;
            if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Setting up', particleData.count, 'particle instances');

            // Instance matrix is identity.
            // IMPORTANT: particle offsets happen in the shader; if we scale the instance matrix,
            // we also scale the offsets and the swarm "clamps" around the core.
            const dummy = new THREE.Object3D();
            for (let i = 0; i < particleData.count; i++) {
                dummy.position.set(0, 0, 0);
                dummy.rotation.set(0, 0, 0);
                dummy.scale.setScalar(1.0);
                dummy.updateMatrix();
                meshRef.current.setMatrixAt(i, dummy.matrix);
            }
            meshRef.current.instanceMatrix.needsUpdate = true;
            if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Instance matrices set (identity)');

            // Custom Attributes
            meshRef.current.geometry.setAttribute(
                'aTargetPos',
                new THREE.InstancedBufferAttribute(particleData.targets, 3)
            );
            meshRef.current.geometry.setAttribute(
                'aRandom',
                new THREE.InstancedBufferAttribute(particleData.randoms, 3)
            );
            if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Instance attributes set (aTargetPos, aRandom)');
            
            // Debug: Log first few particle positions
            if (DEBUG_LUMA_SWARM) {
                console.log('[LumaSwarm] Sample target positions:', particleData.targets.slice(0, 15));
                console.log('[LumaSwarm] Sample random values:', particleData.randoms.slice(0, 15));
            }
        }
    }, [particleData]);

    // 3. Animation Loop
    useFrame(({ clock, camera }) => {
        if (!materialRef.current || !meshRef.current) return;
        
        const currentTime = clock.getElapsedTime();
        
        // Set start time on first frame (not on mount)
        if (startTimeRef.current === null) {
            startTimeRef.current = currentTime;
            console.log('[LumaSwarm] Animation start time set on first frame:', startTimeRef.current);
        }
        
        const elapsed = currentTime - startTimeRef.current;

        // Update Uniforms
        // Pass 'real' absolute time for noise
        materialRef.current.uniforms.uTime.value = currentTime;
        // Pass normalized progress (0 to 1)
        const progress = Math.min(elapsed / FORMATION_DURATION, 1.0);
        materialRef.current.uniforms.uProgress.value = progress;

        // Face Camera only during/after convergence.
        // During the initial spread phase we want true “upwards” motion (world-aligned), not a billboarded plane.
        if (progress >= EMIT_PHASE) {
            meshRef.current.lookAt(camera.position);
        }

        // Debug logging (throttled to every 60 frames)
        if (DEBUG_LUMA_SWARM && Math.floor(currentTime * 60) % 60 === 0) {
            console.log('[LumaSwarm] Frame update:', {
                startTime: startTimeRef.current.toFixed(2),
                currentTime: currentTime.toFixed(2),
                elapsed: elapsed.toFixed(2),
                progress: progress.toFixed(3),
                uProgress: materialRef.current.uniforms.uProgress.value.toFixed(3),
                particleCount: meshRef.current.count,
                visible: meshRef.current.visible
            });
        }

        // Dissipation
        const curDissipate = materialRef.current.uniforms.uDissipate.value;
        if (dissipating) {
            const dt = clock.getDelta();
            materialRef.current.uniforms.uDissipate.value = Math.min(curDissipate + dt * DISSIPATION_SPEED, 1.0);
        }

        // Core Luma Intensity Ramp
        if (coreRef.current) {
            const light = coreRef.current.children.find(c => (c as THREE.PointLight).isPointLight) as THREE.PointLight;
            if (light) {
                // Ramp from 2 to 10 intensity
                const targetIntensity = dissipating ? 0 : (2.0 + progress * 20.0);
                light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, 0.05);

                // Scale core up slightly then shrink on dissipate
                const scale = dissipating ? Math.max(0, 1.0 - curDissipate) : (1.0 + progress * 0.5);
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

    if (!particleData) {
        if (DEBUG_LUMA_SWARM) console.warn('[LumaSwarm] No particle data, returning null');
        return null;
    }
    
    if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Rendering with', particleData.count, 'particles');

    const debugSphere = DEBUG_LUMA_SWARM ? (
        <mesh>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial emissive="#ff0000" emissiveIntensity={5.0} toneMapped={false} color="#ff0000" />
        </mesh>
    ) : null;

    return (
        <group>
            {/* DEBUG: Red sphere at swarm origin */}
            {debugSphere}
            
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
                renderOrder={999} // Render on top
            >
                <sphereGeometry args={[PARTICLE_SIZE, 8, 8]} /> {/* Particle size is geometry radius (instance matrix stays identity) */}
                {/* Temporary debug switch: renders all instances at origin if enabled */}
                {DEBUG_LUMA_SIMPLE_MATERIAL ? (
                    <meshStandardMaterial
                        color="#00ff00"
                        emissive="#00ff00"
                        emissiveIntensity={2.0}
                        toneMapped={false}
                    />
                ) : (
                <CustomShaderMaterial
                    ref={materialRef}
                    baseMaterial={THREE.MeshStandardMaterial}
                    transparent
                    depthWrite={false} // Don't write to depth buffer for transparency
                    uniforms={uniforms}
                    toneMapped={false}
                    emissive="#4deeea"
                    emissiveIntensity={2.0}
                    vertexShader={`
                        attribute vec3 aTargetPos;
                        attribute vec3 aRandom;

                        uniform float uTime;
                        uniform float uProgress;
                        uniform float uDissipate;

                        varying float vAlpha;

                        // Formation staging
                        // - First, particles "emit" from the core and spread upward into a tall volume (tree-sized).
                        // - Then, they converge into the 2D PNG silhouette (existing behavior).
                        const float EMIT_PHASE = ${EMIT_PHASE.toFixed(3)};   // 0..1 fraction of uProgress reserved for the spread phase
                        const float EMIT_RADIUS = ${EMIT_RADIUS.toFixed(3)}; // Horizontal spread radius (world units)
                        const float EMIT_HEIGHT = ${EMIT_HEIGHT.toFixed(3)}; // Upward spread height (world units)
                        const float EMIT_JITTER = ${EMIT_JITTER.toFixed(3)}; // Random motion amplitude during spread
                        const float FORM_JITTER = ${FORM_JITTER.toFixed(3)}; // Residual randomness during convergence

                        mat2 rot2(float a) {
                            float c = cos(a);
                            float s = sin(a);
                            return mat2(c, -s, s, c);
                        }

                        // Simplex-ish noise
                        vec3 hash3(vec3 p) {
                            p = vec3(dot(p,vec3(127.1,311.7, 74.7)),
                                     dot(p,vec3(269.5,183.3,246.1)),
                                     dot(p,vec3(113.5,271.9,124.6)));
                            return fract(sin(p)*43758.5453123);
                        }

                        void main() {
                            // 1) Emission / spread phase:
                            // Particles originate at the core, then expand upward into a tall volume roughly
                            // matching the space a fully-grown flora tree occupies.
                            float spreadT = clamp(uProgress / EMIT_PHASE, 0.0, 1.0);
                            // Ease-in-out so we don't rocket to the top immediately; feels more "etheric".
                            float spreadEase = smoothstep(0.0, 1.0, spreadT);

                            // Random radial direction (XZ), with an outward radius bias.
                            vec2 dir2 = normalize((aRandom.xy - 0.5) * 2.0 + vec2(0.0001, 0.0002));
                            float radial = pow(aRandom.z, 0.65) * EMIT_RADIUS;

                            // Spiraling motion: per-particle spin speed + phase.
                            float spinSpeed = mix(0.8, 2.2, aRandom.y); // gentle swirl (butterfly-like)
                            float angle = uTime * spinSpeed + aRandom.x * 6.28318530718;
                            vec2 spiralDir = rot2(angle) * dir2;

                            // Add a subtle secondary wobble to avoid perfectly smooth rings.
                            float wobble = sin(uTime * 1.1 + aRandom.z * 12.0) * 0.8;
                            vec2 wobbleDir = vec2(cos(wobble), sin(wobble));

                            // Smooth turbulence (avoid "fast jitter"): layered sin/cos with per-particle phases.
                            float t0 = uTime * 0.35 + aRandom.x * 12.0;
                            float t1 = uTime * 0.22 + aRandom.y * 17.0;
                            float t2 = uTime * 0.28 + aRandom.z * 9.0;
                            vec3 flutter = vec3(
                                sin(t0) + 0.5 * cos(t1),
                                sin(t1) + 0.5 * cos(t2),
                                sin(t2) + 0.5 * cos(t0)
                            );
                            flutter = normalize(flutter) * EMIT_JITTER;

                            // Spread should occupy the full vertical range (not all particles stuck at the top).
                            float height01 = pow(aRandom.z, 0.9);
                            float targetY = height01 * EMIT_HEIGHT;
                            float startY = 0.25; // just above the luma core

                            vec3 spreadPos = vec3(0.0);
                            // Expand fast and keep adding turbulence as we rise.
                            float cone = mix(0.5, 1.0, height01); // slightly wider at the top
                            spreadPos.xz = (spiralDir * radial * cone * spreadEase) + wobbleDir * (0.6 * spreadEase);
                            spreadPos.xz += flutter.xz * (0.35 + 0.65 * spreadEase);

                            // Rise into a distributed target Y; keep a gentle vertical bob.
                            float bob = sin(uTime * 0.9 + aRandom.x * 9.0) * 0.35;
                            spreadPos.y = mix(startY, targetY, spreadEase) + bob * spreadEase;

                            // Give some true 3D thickness during spread so it doesn't feel like a flat sheet.
                            spreadPos.z += flutter.x * (0.18 + 0.82 * spreadEase);

                            // Cache the end-of-spread position so the formation phase transitions smoothly.
                            vec3 spreadEndPos = vec3(0.0);
                            spreadEndPos.xz = spiralDir * radial * cone + wobbleDir * 0.6 + flutter.xz;
                            spreadEndPos.y = targetY + bob;
                            spreadEndPos.z = flutter.x;

                            // 2. Target Position (The Shape)
                            // Add some wobble to target
                            vec3 targetPos = aTargetPos;
                            targetPos.z += sin(uTime * 2.0 + aRandom.x * 10.0) * 0.1; // Breathing Z
                            targetPos.x += cos(uTime * 1.5 + aRandom.y * 10.0) * 0.05;

                            // 3) Formation phase: converge from the spread volume to the PNG silhouette.
                            float formT = (uProgress - EMIT_PHASE) / (1.0 - EMIT_PHASE);
                            formT = clamp(formT, 0.0, 1.0);
                            // Cubic ease out
                            float ease = 1.0 - pow(1.0 - formT, 3.0);

                            vec3 pos = (uProgress < EMIT_PHASE)
                                ? spreadPos
                                : mix(spreadEndPos, targetPos, ease);

                            // Keep some randomness as particles begin to converge, then let it “lock in”.
                            // This avoids an immediate, perfectly smooth snap into the silhouette.
                            float settle = 1.0 - ease;
                            vec3 convergeJitter = (hash3(vec3(aRandom.xy * 91.0, uTime * 0.22)) - 0.5) * 2.0;
                            pos += convergeJitter * FORM_JITTER * settle;

                            // 4. Dissipation (Explode/Scatter)
                            if (uDissipate > 0.0) {
                                float len = length(pos);
                                vec3 outward = (len > 0.0001) ? (pos / len) : normalize(aRandom - 0.5);
                                vec3 dir = outward + (aRandom - 0.5); // Outward + Chaos
                                pos += dir * uDissipate * 5.0; // Fly away
                            }

                            // Calculate Alpha for fade
                            vAlpha = 1.0 - uDissipate;

                            // Keep the sphere geometry and offset per-instance by our swarm position.
                            // (If we set the position to 'pos' directly, the sphere collapses into a single point.)
                            csm_Position = position + pos;
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
                )}
            </instancedMesh>
        </group>
    );
};

// Preload the texture to avoid suspension during gameplay
useLoader.preload(THREE.TextureLoader, lumaShapeUrl);
