import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useEnvironmentStore } from '@/state/EnvironmentStore';
import { WATER_LEVEL } from '@/constants';
import CustomShaderMaterial from 'three-custom-shader-material';

const MAX_BUBBLES = 800;

export const BubbleSystem: React.FC = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const isUnderwater = useEnvironmentStore((s) => s.isUnderwater);
    const underwaterChangedAt = useEnvironmentStore((s) => s.underwaterChangedAt);

    // GPU Attributes
    const offsetsAttr = useRef<THREE.InstancedBufferAttribute>(null);
    const directionsAttr = useRef<THREE.InstancedBufferAttribute>(null);
    const paramsAttr = useRef<THREE.InstancedBufferAttribute>(null);

    const nextIdx = useRef(0);

    const BUBBLE_VSHADER = `
        attribute vec3 aOffset;
        attribute vec4 aDirection; // [vx, vy, vz, startTime]
        attribute vec2 aParams;    // [life, scaleMult]
        uniform float uTime;
        uniform float uWaterLevel;

        void main() {
            float startTime = aDirection.w;
            float life = aParams.x;
            float age = uTime - startTime;

            if (age < 0.0 || age > life) {
                // Hide particle
                csm_Position = vec3(0.0, -9999.0, 0.0);
                return;
            }

            float progress = age / life;
            vec3 worldPos = aOffset + aDirection.xyz * age;
            worldPos.y += 0.25 * age * age; // Buoyancy acceleration

            // Wiggle
            worldPos.x += sin(uTime * 1.5 + float(gl_InstanceID)) * 0.02;
            worldPos.z += cos(uTime * 1.5 + float(gl_InstanceID)) * 0.02;

            float surfaceDist = uWaterLevel - worldPos.y;
            float surfaceMask = clamp(surfaceDist * 5.0, 0.0, 1.0);

            if (surfaceMask <= 0.0) {
                worldPos.y = -9999.0;
            }

            float s = (0.7 + sin(uTime * 4.0 + float(gl_InstanceID)) * 0.3) * aParams.y * min(1.0, (1.0 - progress) * 4.0) * surfaceMask;
            
            csm_Position = worldPos + csm_Position * s;
        }
    `;

    const lastPos = useRef(new THREE.Vector3());
    const lastSubmergeAt = useRef(0);
    const lastBreathAt = useRef(0);
    const velYRef = useRef(0);

    const spawnBubbles = (origin: THREE.Vector3, count: number, speed: number, radius: number, time: number) => {
        if (!offsetsAttr.current || !directionsAttr.current || !paramsAttr.current) return;

        for (let i = 0; i < count; i++) {
            const idx = nextIdx.current;

            // Position
            const px = origin.x + (Math.random() - 0.5) * radius;
            const py = origin.y + (Math.random() - 0.5) * radius;
            const pz = origin.z + (Math.random() - 0.5) * radius;
            offsetsAttr.current.setXYZ(idx, px, py, pz);

            // Velocity
            const vx = (Math.random() - 0.5) * speed * 0.5;
            const vy = 0.5 + Math.random() * 1.5 + speed * 0.2;
            const vz = (Math.random() - 0.5) * speed * 0.5;
            directionsAttr.current.setXYZW(idx, vx, vy, vz, time);

            // Params
            const life = 1.0 + Math.random() * 2.5;
            const scaleMult = 0.5 + Math.pow(Math.random(), 2) * 2.0;
            paramsAttr.current.setXY(idx, life, scaleMult);

            nextIdx.current = (nextIdx.current + 1) % MAX_BUBBLES;
        }

        offsetsAttr.current.needsUpdate = true;
        directionsAttr.current.needsUpdate = true;
        paramsAttr.current.needsUpdate = true;
    };

    useFrame(({ camera, clock }, delta) => {
        if (!meshRef.current) return;

        const t = clock.getElapsedTime();
        const camPos = camera.position;

        // Calculate vertical velocity
        velYRef.current = (camPos.y - lastPos.current.y) / Math.max(0.001, delta);
        lastPos.current.copy(camPos);

        // Detect entry burst
        if (isUnderwater && underwaterChangedAt !== lastSubmergeAt.current) {
            lastSubmergeAt.current = underwaterChangedAt;
            const entrySpeed = Math.abs(Math.min(0, velYRef.current));
            if (entrySpeed > 2.0) {
                const burstCount = Math.floor(THREE.MathUtils.clamp(entrySpeed * 20, 30, 150));
                const burstRadius = THREE.MathUtils.clamp(entrySpeed * 0.1, 0.5, 2.0);
                spawnBubbles(camPos, burstCount, entrySpeed * 0.5, burstRadius, t);
            }
        }

        // Oxygen emission (breath)
        if (isUnderwater && t - lastBreathAt.current > 0.4 + Math.random() * 0.6) {
            lastBreathAt.current = t;
            const front = new THREE.Vector3(0, -0.2, -0.4).applyEuler(camera.rotation);
            const mouthPos = camPos.clone().add(front);
            spawnBubbles(mouthPos, 2 + Math.floor(Math.random() * 3), 0.5, 0.2, t);
        }

        // Update Uniforms
        const mat = meshRef.current.material as any;
        if (mat.uniforms) {
            mat.uniforms.uTime.value = t;
        }
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_BUBBLES]} frustumCulled={false}>
            <sphereGeometry args={[0.004, 10, 8]}>
                <instancedBufferAttribute ref={offsetsAttr} attach="attributes-aOffset" args={[new Float32Array(MAX_BUBBLES * 3), 3]} />
                <instancedBufferAttribute ref={directionsAttr} attach="attributes-aDirection" args={[new Float32Array(MAX_BUBBLES * 4), 4]} />
                <instancedBufferAttribute ref={paramsAttr} attach="attributes-aParams" args={[new Float32Array(MAX_BUBBLES * 2), 2]} />
            </sphereGeometry>
            <CustomShaderMaterial
                baseMaterial={THREE.MeshPhysicalMaterial}
                vertexShader={BUBBLE_VSHADER}
                uniforms={{
                    uTime: { value: 0 },
                    uWaterLevel: { value: WATER_LEVEL }
                }}
                transparent
                opacity={0.8}
                color="#e0f4ff"
                roughness={0.0}
                metalness={0.2}
                transmission={0.4}
                thickness={0.5}
                ior={1.33}
                depthWrite={false}
                emissive="#99ccff"
                emissiveIntensity={0.6}
            />
        </instancedMesh>
    );
};

