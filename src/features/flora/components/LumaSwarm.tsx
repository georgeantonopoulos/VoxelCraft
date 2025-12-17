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
const FORMATION_DURATION = 7.0; // Seconds to fully form (3s faster than previous 10s)
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
const EMIT_JITTER = 1.2; // Random motion amplitude during spread (kept gentle/etheric)
const FORM_JITTER = 0.25; // Residual randomness during convergence (fades out)

// Final silhouette dimensions (big representation of the PNG).
// We keep aspect ratio from the actual image and size it to roughly half of the previous silhouette.
const SHAPE_SCALE = 0.5;
const SHAPE_HEIGHT = EST_FLORA_TREE_HEIGHT * 1.15 * SHAPE_SCALE;

// Debug controls (keep off by default to avoid console spam/perf hits in-game)
const DEBUG_LUMA_SWARM = false;
const DEBUG_LUMA_SIMPLE_MATERIAL = false; // Renders all instances at origin (no shader animation)

// Cache the expensive silhouette sampling so RootHollow transitions don't hitch on swarm mount.
// This is safe because the swarm shape is derived solely from `luma_shape.png` + constants above.
let cachedParticleData: { targets: Float32Array; randoms: Float32Array; count: number } | null = null;
let cachedParticleKey: string | null = null;

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
        const key = `${texture.image.width}x${texture.image.height}`;
        if (cachedParticleData && cachedParticleKey === key) return cachedParticleData;
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
                    // Add significant spatial jitter to break the sampling grid artifacts
                    const jitterX = (Math.random() - 0.5) * 0.15;
                    const jitterY = (Math.random() - 0.5) * 0.15;
                    targets.push(nX * shapeWidth + jitterX, nY01 * SHAPE_HEIGHT + jitterY, 0);
                    randoms.push(Math.random(), Math.random(), Math.random());
                }
            }
        }

        const count = targets.length / 3;
        if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Particle count:', count);
        const computed = {
            targets: new Float32Array(targets),
            randoms: new Float32Array(randoms),
            count
        };
        cachedParticleData = computed;
        cachedParticleKey = key;
        return computed;
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
    useFrame(({ clock, camera }, delta) => {
        if (!materialRef.current || !meshRef.current) return;

        const currentTime = clock.getElapsedTime();

        // Set start time on first frame (not on mount)
        if (startTimeRef.current === null) {
            startTimeRef.current = currentTime;
            if (DEBUG_LUMA_SWARM) console.log('[LumaSwarm] Animation start time set on first frame:', startTimeRef.current);
        }

        // Keep a tiny delay so the swarm doesn't "pop" the instant a flora is consumed.
        const START_DELAY_S = 0.15;
        const validStart = startTimeRef.current + START_DELAY_S;
        const elapsed = Math.max(0, currentTime - validStart);

        // Update Uniforms
        // Pass 'real' absolute time for noise
        materialRef.current.uniforms.uTime.value = currentTime;
        // Pass normalized progress (0 to 1)
        const progress = Math.min(elapsed / FORMATION_DURATION, 1.0);
        materialRef.current.uniforms.uProgress.value = progress;

        // Face Camera only during/after convergence.
        // During the initial spread phase we want true “upwards” motion (world-aligned), not a billboarded plane.
        // A simple heuristic: start blending towards billboard rotation after 50% formation.
        const billboardWeight = THREE.MathUtils.smoothstep(progress, 0.4, 0.9);
        if (billboardWeight > 0.0) {
            // We can't easily billboard instances in a performant way without a custom shader billboard logic,
            // OR rotating the entire InstancedMesh to face camera. 
            // Rotating the mesh is easiest but might conflict with world-space spread logic if not careful.
            // Given the particles are spheres, they look the same from any angle! 
            // So we actually DON'T need to face camera for the particles themselves.
            // However, the *shape* might look flat if it was a plane. But our shape is 3D volumetrically distributed on Z=0.
            // If the user wants the "image" to face the player, we should rotate the Group.
            // For now, let's just make the entire mesh look at the camera if requested, 
            // but since we spawn 2D sprites in a 3D volume, it might look best fixed or billboarded.
            // Let's leave orientation alone for now (fixed world space) as requested by "maintain volume".
        }

        // Debug logging (throttled to every 60 frames)
        if (DEBUG_LUMA_SWARM && Math.floor(currentTime * 2) > Math.floor((currentTime - delta) * 2)) {
            console.log('[LumaSwarm] Update', {
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
            // Use stable frame delta instead of clock.getDelta() which can be unpredictable
            materialRef.current.uniforms.uDissipate.value = Math.min(curDissipate + delta * DISSIPATION_SPEED, 1.0);
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
                        varying float vFadeSeed;

                        // Formation staging
                        const float EMIT_PHASE = ${EMIT_PHASE.toFixed(3)};
                        const float EMIT_RADIUS = ${EMIT_RADIUS.toFixed(3)};
                        const float EMIT_HEIGHT = ${EMIT_HEIGHT.toFixed(3)};
                        // Reduced jitter amplitudes for smoother Triple-A fluid look
                        const float EMIT_JITTER = ${EMIT_JITTER.toFixed(3)}; 
                        const float FORM_JITTER = ${FORM_JITTER.toFixed(3)}; 

                        mat2 rot2(float a) {
                            float c = cos(a);
                            float s = sin(a);
                            return mat2(c, -s, s, c);
                        }

                        // Smooth layered sine noise (fluid-like) instead of harsh white noise
                        vec3 smoothNoise(vec3 p, float t) {
                            return vec3(
                                sin(p.y * 1.5 + t) * 0.5 + sin(p.z * 0.7 + t * 0.8) * 0.2,
                                sin(p.z * 1.2 + t * 0.9) * 0.5 + cos(p.x * 1.1 + t) * 0.2,
                                cos(p.x * 1.4 + t * 0.7) * 0.5 + sin(p.y * 0.9 + t * 1.1) * 0.2
                            );
                        }

                        void main() {
                            vFadeSeed = aRandom.x;

                            // 1) Emission / spread phase:
                            float spreadT = clamp(uProgress / EMIT_PHASE, 0.0, 1.0);
                            
                            // Stagger emission
                            float delay = aRandom.y * 0.15;
                            float spreadLocalT = clamp((spreadT - delay) / max(0.0001, (1.0 - delay)), 0.0, 1.0);
                            // Cubic ease-out
                            float spreadEase = 1.0 - pow(1.0 - spreadLocalT, 3.0);

                            // Base Spiral Motion
                            vec2 dir2 = normalize((aRandom.xy - 0.5) * 2.0 + vec2(0.0001, 0.0002));
                            float radial = pow(aRandom.z, 0.65) * EMIT_RADIUS;

                            // More coherent, fluid spiral
                            float spinSpeed = mix(0.8, 1.2, aRandom.y); 
                            float angle = uTime * spinSpeed + aRandom.x * 6.28;
                            
                            // Apply rotation
                            vec2 spiralDir = rot2(angle) * dir2;

                            // Fluid Turbulence
                            vec3 fluidOffset = smoothNoise(aRandom * 5.0, uTime * 0.5) * EMIT_JITTER;

                            // Height distribution
                            float height01 = pow(aRandom.z, 0.85);
                            float targetY = height01 * EMIT_HEIGHT;
                            float startY = 0.05;

                            // Build Spread Position
                            vec3 spreadPos = vec3(0.0);
                            
                            // XZ Motion: Expand outward with spiral + fluid noise
                            // VARY the cone shape so it's not a perfect funnel
                            float coneRandom = 1.0 + (aRandom.x - 0.5) * 0.5; 
                            float cone = mix(0.4, 1.0, height01) * coneRandom; 
                            spreadPos.xz = (spiralDir * radial * cone * spreadEase) + (fluidOffset.xy * spreadEase);
                            
                            // Y Motion: Rise with fluid vertical drift
                            spreadPos.y = mix(startY, targetY, spreadEase) + (fluidOffset.z * spreadEase * 0.5);

                            spreadPos.y = mix(startY, targetY, spreadEase) + (fluidOffset.z * spreadEase * 0.5);

                            // 2) Formation phase: converge
                            float formT = (uProgress - EMIT_PHASE) / (1.0 - EMIT_PHASE);
                            formT = clamp(formT, 0.0, 1.0);
                            
                            // Smooth Quartic ease-in-out
                            float ease = formT < 0.5 ? 8.0 * formT * formT * formT * formT : 1.0 - pow(-2.0 * formT + 2.0, 4.0) / 2.0;

                            // Target Shape Position
                            vec3 targetPos = aTargetPos;
                            vec3 breath = smoothNoise(aTargetPos * 2.0, uTime * 1.5) * 0.15;
                            targetPos += breath;

                            // Blend
                            vec3 pos = mix(spreadPos, targetPos, ease);

                            // Residual float
                            float settle = 1.0 - ease;
                            vec3 floatDrift = smoothNoise(pos * 0.5, uTime * 0.8) * FORM_JITTER;
                            pos += floatDrift * settle;

                            // 4) Dissipation
                            if (uDissipate > 0.0) {
                                float len = length(pos);
                                vec3 outward = (len > 0.0001) ? (pos / len) : vec3(0.0, 1.0, 0.0);
                                vec3 chaos = smoothNoise(pos, uTime * 2.0);
                                pos += (outward + chaos) * uDissipate * 8.0;
                            }

                            vAlpha = 1.0 - uDissipate;
                            
                            // VARY SIZE per particle
                            // Some are tiny motes, some are larger "souls"
                            float sizeVar = mix(0.5, 1.5, aRandom.z);
                            
                            // If we just scale 'position', it works because it's local space sphere geo.
                            // We do NOT want to scale 'pos' (the offset).
                            csm_Position = (position * sizeVar) + pos;
                        }
                    `}
                        fragmentShader={`
                        uniform vec3 uColor;
                        varying float vAlpha;
                        varying float vFadeSeed;

                        void main() {
                            // Organic dissipation:
                            // Widen the smoothstep range significantly for softer edges
                            // and use noise/randomness to make some fade way later.
                            float fadeStart = 0.10 + 0.60 * vFadeSeed;
                            float fadeEnd = fadeStart + 0.50; // softer window
                            
                            // Non-linear alpha falloff
                            float progress = 1.0 - vAlpha; // 0..1
                            float fade = 1.0 - smoothstep(fadeStart, fadeEnd, progress);
                            
                            // Randomize Glow Intensity per particle
                            // (vFadeSeed is just aRandom.x, reusing it)
                            float glowVar = mix(0.8, 2.5, vFadeSeed); 

                            csm_DiffuseColor = vec4(uColor, vAlpha * fade);
                            csm_Emissive = uColor * 2.0 * glowVar; 

                            if (csm_DiffuseColor.a < 0.01) discard;
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
