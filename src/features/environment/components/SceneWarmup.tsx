import React, { useMemo } from 'react';
import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material/vanilla';

/**
 * SceneWarmup
 * Prevents "first-time" hitches by:
 * 1. Mounting representative lights (SpotLight, shadow-casting PointLight) at intensity 0.
 * 2. Pre-compiling critical CustomShaderMaterials on dummy meshes.
 */

// Shaders to warm up - must match the vertex shaders in their respective components
const FIRE_VSHADER = `
    attribute vec3 aOffset;
    attribute vec4 aParams; 
    uniform float uTime;
    void main() {
        float startTime = aParams.x;
        float life = aParams.y;
        float speed = aParams.z;
        float baseScale = aParams.w;
        float t = mod(uTime + startTime, life);
        float progress = t / life;
        vec3 pos = aOffset;
        pos.y += t * speed;
        float size = (1.0 - progress) * 0.25 * baseScale;
        csm_Position = pos + csm_Position * size;
    }
`;

const SPARK_VSHADER = `
    attribute vec3 aOffset;
    attribute vec4 aDirection;
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
        worldPos.y -= 4.9 * age * age;
        float s = max(0.0, 1.0 - progress);
        csm_Position = worldPos + csm_Position * s;
    }
`;

export const SceneWarmup: React.FC = () => {
    // We create the material objects once to ensure they are consistent
    const fireMat = useMemo(() => new CustomShaderMaterial({
        baseMaterial: THREE.MeshBasicMaterial,
        vertexShader: FIRE_VSHADER,
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        opacity: 0,
    }), []);

    const sparkMat = useMemo(() => new CustomShaderMaterial({
        baseMaterial: THREE.MeshBasicMaterial,
        vertexShader: SPARK_VSHADER,
        uniforms: { uTime: { value: 0 } },
        transparent: true,
        opacity: 0,
    }), []);

    return (
        <group position={[0, -1000, 0]} visible={false}>
            {/* 1. Light Warmup */}
            {/* Adding these to the scene graph ensurers Three.js allocates slots for them in all shaders */}
            <spotLight intensity={0} />
            <pointLight intensity={0} />

            {/* 2. Custom Shader Warmup */}
            {/* We must use meshes with the attributes required by the shaders to avoid "attribute missing" warnings/errors during compilation */}
            <mesh frustumCulled={false} material={fireMat}>
                <boxGeometry args={[0.1, 0.1, 0.1]}>
                    <instancedBufferAttribute attach="attributes-aOffset" args={[new Float32Array(3), 3]} />
                    <instancedBufferAttribute attach="attributes-aParams" args={[new Float32Array(4), 4]} />
                </boxGeometry>
            </mesh>

            <mesh frustumCulled={false} material={sparkMat}>
                <boxGeometry args={[0.1, 0.1, 0.1]}>
                    <instancedBufferAttribute attach="attributes-aOffset" args={[new Float32Array(3), 3]} />
                    <instancedBufferAttribute attach="attributes-aDirection" args={[new Float32Array(4), 4]} />
                    <instancedBufferAttribute attach="attributes-aLife" args={[new Float32Array(1), 1]} />
                </boxGeometry>
            </mesh>
        </group>
    );
};
