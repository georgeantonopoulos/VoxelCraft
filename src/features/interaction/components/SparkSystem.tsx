import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';

const MAX_PARTICLES = 120; // Increased pool slightly

export const emitSpark = (position: THREE.Vector3) => {
    window.dispatchEvent(new CustomEvent('vc-spark', { detail: { position } }));
};

export const SparkSystem: React.FC = () => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const offsetsAttr = useRef<THREE.InstancedBufferAttribute>(null);
    const directionsAttr = useRef<THREE.InstancedBufferAttribute>(null);
    const lifeAttr = useRef<THREE.InstancedBufferAttribute>(null);

    const nextIdx = useRef(0);

    const SPARK_VSHADER = `
        attribute vec3 aOffset;
        attribute vec4 aDirection; // [vx, vy, vz, startTime]
        attribute float aLife;
        uniform float uTime;

        void main() {
            float startTime = aDirection.w;
            float age = uTime - startTime;

            if (age < 0.0 || age > aLife) {
                csm_Position = vec3(0.0, -9999.0, 0.0);
                return;
            }

            float progress = age / aLife;
            vec3 worldPos = aOffset + aDirection.xyz * age;
            worldPos.y -= 4.9 * age * age; // Gravity effect

            float s = max(0.0, 1.0 - progress);
            csm_Position = worldPos + csm_Position * s;
        }
    `;

    useEffect(() => {
        const handleSpark = (e: Event) => {
            if (!offsetsAttr.current || !directionsAttr.current || !lifeAttr.current) return;
            const detail = (e as CustomEvent).detail;
            const origin = detail.position as THREE.Vector3;
            const time = performance.now() / 1000; // Use consistent time source

            const count = 8;
            for (let i = 0; i < count; i++) {
                const idx = nextIdx.current;
                offsetsAttr.current.setXYZ(idx, origin.x, origin.y, origin.z);

                // Velocity
                const vx = (Math.random() - 0.5) * 4;
                const vy = Math.random() * 4 + 2;
                const vz = (Math.random() - 0.5) * 4;
                directionsAttr.current.setXYZW(idx, vx, vy, vz, time);

                // Life
                const life = 0.3 + Math.random() * 0.3;
                lifeAttr.current.setX(idx, life);

                nextIdx.current = (nextIdx.current + 1) % MAX_PARTICLES;
            }

            offsetsAttr.current.needsUpdate = true;
            directionsAttr.current.needsUpdate = true;
            lifeAttr.current.needsUpdate = true;
        };

        window.addEventListener('vc-spark', handleSpark);
        return () => window.removeEventListener('vc-spark', handleSpark);
    }, []);

    useFrame(({ clock }) => {
        if (!meshRef.current) return;
        const mat = meshRef.current.material as any;
        if (mat.uniforms) {
            mat.uniforms.uTime.value = clock.getElapsedTime();
        }
    });

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, MAX_PARTICLES]} frustumCulled={false}>
            <boxGeometry args={[0.03, 0.03, 0.03]}>
                <instancedBufferAttribute ref={offsetsAttr} attach="attributes-aOffset" args={[new Float32Array(MAX_PARTICLES * 3), 3]} />
                <instancedBufferAttribute ref={directionsAttr} attach="attributes-aDirection" args={[new Float32Array(MAX_PARTICLES * 4), 4]} />
                <instancedBufferAttribute ref={lifeAttr} attach="attributes-aLife" args={[new Float32Array(MAX_PARTICLES), 1]} />
            </boxGeometry>
            <CustomShaderMaterial
                baseMaterial={THREE.MeshBasicMaterial}
                vertexShader={SPARK_VSHADER}
                uniforms={{
                    uTime: { value: 0 }
                }}
                color="#ffaa00"
                toneMapped={false}
            />
        </instancedMesh>
    );
};
