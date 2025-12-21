import React, { useRef, useLayoutEffect, useEffect } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';

const stumpUrl = "/models/tree_stump.glb";

interface StumpLayerProps {
    positions: Float32Array; // Stride 6: x, y, z, nx, ny, nz
    chunkKey: string;
}

const STUMP_CONFIG = {
    height: 1.4,
    scale: 1.3,
    embedOffset: 0.3
};

// Resource Singleton to prevent per-chunk GLTF traversal/parsing overhead.
let stumpResourcePromise: Promise<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    sourceHeight: number;
}> | null = null;

const getStumpResources = (scene: THREE.Group) => {
    if (stumpResourcePromise) return stumpResourcePromise;

    stumpResourcePromise = (async () => {
        let geo: THREE.BufferGeometry | null = null;
        let mat: THREE.Material | null = null;
        let sHeight = 1;

        scene.traverse((child) => {
            if (!geo && (child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                geo = mesh.geometry;
                mat = mesh.material as THREE.Material;
            }
        });

        if (geo) {
            const box = new THREE.Box3().setFromObject(scene);
            const size = new THREE.Vector3();
            box.getSize(size);
            sHeight = size.y > 0.0001 ? size.y : 1;
        }

        if (mat) {
            mat.side = THREE.FrontSide;
        }

        if (!geo || !mat) throw new Error("Failed to extract stump resources from GLTF");

        return { geometry: geo, material: mat, sourceHeight: sHeight };
    })();

    return stumpResourcePromise;
};

/**
 * Highly optimized instanced renderer for tree stumps.
 */
export const StumpLayer = React.memo(({ positions }: StumpLayerProps) => {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const { scene } = useGLTF(stumpUrl);
    const [resources, setResources] = React.useState<{
        geometry: THREE.BufferGeometry;
        material: THREE.Material;
        sourceHeight: number;
    } | null>(null);

    useEffect(() => {
        getStumpResources(scene).then(setResources);
    }, [scene]);

    useLayoutEffect(() => {
        if (!meshRef.current || !resources || !positions || positions.length === 0) return;

        const count = positions.length / 6;
        const dummy = new THREE.Object3D();
        const up = new THREE.Vector3(0, 1, 0);
        const finalScale = (STUMP_CONFIG.height * STUMP_CONFIG.scale) / resources.sourceHeight;

        for (let i = 0; i < count; i++) {
            const x = positions[i * 6];
            const y = positions[i * 6 + 1];
            const z = positions[i * 6 + 2];
            const nx = positions[i * 6 + 3];
            const ny = positions[i * 6 + 4];
            const nz = positions[i * 6 + 5];

            dummy.position.set(x, y - STUMP_CONFIG.embedOffset, z);

            const terrainNormal = new THREE.Vector3(nx, ny, nz).normalize();
            const targetDirection = new THREE.Vector3()
                .copy(terrainNormal)
                .lerp(up, 0.7)
                .normalize();

            dummy.quaternion.setFromUnitVectors(up, targetDirection);

            const hash = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
            const randomAngle = (hash % 1) * Math.PI * 2;
            const randomYaw = new THREE.Quaternion().setFromAxisAngle(targetDirection, randomAngle);
            dummy.quaternion.multiply(randomYaw);

            dummy.scale.setScalar(finalScale);

            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [positions, resources]);

    if (!resources) return null;

    return (
        <instancedMesh
            ref={meshRef}
            args={[resources.geometry, resources.material, positions.length / 6]}
            castShadow
            receiveShadow
        />
    );
});

useGLTF.preload(stumpUrl);
