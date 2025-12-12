import React, { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { InstancedRigidBodies, InstancedRigidBodyProps } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { TreeType } from '@features/terrain/logic/VegetationConfig';
import { TreeGeometryFactory } from '@features/flora/logic/TreeGeometryFactory';

interface TreeLayerProps {
    data: Float32Array; // Stride 4: x, y, z, type
    opacity?: number;
    opacityRef?: React.MutableRefObject<number>;
}

export const TreeLayer: React.FC<TreeLayerProps> = React.memo(({ data, opacity = 1.0, opacityRef }) => {
    // Group data by type (+ jungle variant)
    const batches = useMemo(() => {
        const map = new Map<string, { type: number, variant: number, positions: number[], count: number }>();
        const JUNGLE_VARIANTS = 4; // Small set of deterministic templates for instancing

        for (let i = 0; i < data.length; i += 4) {
            const x = data[i];
            const y = data[i + 1];
            const z = data[i + 2];
            const type = data[i + 3];

            // Deterministic variant selection for jungle trees so nearby trees
            // share a few templates while still looking varied.
            let variant = 0;
            if (type === TreeType.JUNGLE) {
                const seed = x * 12.9898 + z * 78.233;
                const h = Math.abs(Math.sin(seed)) * 43758.5453;
                variant = Math.floor((h % 1) * JUNGLE_VARIANTS);
            }

            const key = `${type}:${variant}`;
            if (!map.has(key)) {
                map.set(key, { type, variant, positions: [], count: 0 });
            }
            const batch = map.get(key)!;
            batch.positions.push(x, y, z);
            batch.count++;
        }
        return map;
    }, [data]);

    return (
        <group>
            {Array.from(batches.values()).map((batch) => (
                <InstancedTreeBatch
                    key={`${batch.type}:${batch.variant}`}
                    type={batch.type}
                    variant={batch.variant}
                    positions={batch.positions}
                    count={batch.count}
                    opacity={opacity}
                    opacityRef={opacityRef}
                />
            ))}
        </group>
    );
});

const InstancedTreeBatch: React.FC<{ type: number, variant: number, positions: number[], count: number, opacity: number; opacityRef?: React.MutableRefObject<number> }> = ({ type, variant, positions, count, opacity, opacityRef }) => {
    const woodMesh = useRef<THREE.InstancedMesh>(null);
    const leafMesh = useRef<THREE.InstancedMesh>(null);
    const woodMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
    const leafMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
    const lastTransparentRef = useRef<boolean | null>(null);

    const { wood, leaves, collisionData } = useMemo(() => TreeGeometryFactory.getTreeGeometry(type, variant), [type, variant]);

    const dummy = useMemo(() => new THREE.Object3D(), []);

    useLayoutEffect(() => {
        if (!woodMesh.current) return;

        for (let i = 0; i < count; i++) {
            const x = positions[i * 3];
            const y = positions[i * 3 + 1];
            const z = positions[i * 3 + 2];

            dummy.position.set(x, y, z);

            // Random rotation
            const seed = x * 12.9898 + z * 78.233;
            dummy.rotation.y = (seed % 1) * Math.PI * 2;

            // Random scale variation
            const scale = 0.8 + (seed % 0.4);
            dummy.scale.setScalar(scale);

            dummy.updateMatrix();
            woodMesh.current.setMatrixAt(i, dummy.matrix);
            if (leafMesh.current) leafMesh.current.setMatrixAt(i, dummy.matrix);
        }

        woodMesh.current.instanceMatrix.needsUpdate = true;
        if (leafMesh.current) leafMesh.current.instanceMatrix.needsUpdate = true;
    }, [positions, count]);

    // Smooth fade without alpha hash / dither: update opacity via a ref to avoid re-rendering instanced batches.
    useFrame(() => {
        const resolvedOpacity = opacityRef ? opacityRef.current : opacity;
        const isTransparent = resolvedOpacity < 0.999;

        const apply = (mat: THREE.MeshStandardMaterial | null) => {
            if (!mat) return;
            mat.opacity = resolvedOpacity;
            if (lastTransparentRef.current !== isTransparent) {
                mat.transparent = isTransparent;
                mat.depthWrite = !isTransparent;
                mat.needsUpdate = true;
            }
        };

        apply(woodMaterialRef.current);
        apply(leafMaterialRef.current);

        // Shared toggle state for both materials.
        if (lastTransparentRef.current !== isTransparent) {
            lastTransparentRef.current = isTransparent;
        }
    });

    // Prepare Physics Instances
    const rigidBodyGroups = useMemo(() => {
        if (!collisionData || collisionData.length === 0) return [];

        return collisionData.map((branchDef, branchIndex) => {
            const instances: InstancedRigidBodyProps[] = [];
            const branchMatrix = new THREE.Matrix4().compose(branchDef.position, branchDef.quaternion, branchDef.scale);
            const tempMatrix = new THREE.Matrix4();
            const tempDummy = new THREE.Object3D();

            for (let i = 0; i < count; i++) {
                const x = positions[i * 3];
                const y = positions[i * 3 + 1];
                const z = positions[i * 3 + 2];

                // Reconstruct Tree Transform (must match visual)
                tempDummy.position.set(x, y, z);
                const seed = x * 12.9898 + z * 78.233;
                tempDummy.rotation.y = (seed % 1) * Math.PI * 2;
                tempDummy.rotation.x = 0; tempDummy.rotation.z = 0;
                const scale = 0.8 + (seed % 0.4);
                tempDummy.scale.setScalar(scale);
                tempDummy.updateMatrix();

                // Combine: Tree * Branch
                tempMatrix.copy(tempDummy.matrix).multiply(branchMatrix);

                const pos = new THREE.Vector3();
                const quat = new THREE.Quaternion();
                const scl = new THREE.Vector3();
                tempMatrix.decompose(pos, quat, scl);

                const euler = new THREE.Euler().setFromQuaternion(quat);

                instances.push({
                    key: `tree-${type}-${i}-branch-${branchIndex}`,
                    position: [pos.x, pos.y, pos.z],
                    rotation: [euler.x, euler.y, euler.z],
                    scale: [scl.x, scl.y, scl.z],
                    userData: { type: 'flora_tree' }
                });
            }
            return instances;
        });
    }, [collisionData, positions, count, type]);

    // Colors
    const colors = useMemo(() => {
        let base = '#3e2723';
        let tip = '#00FFFF';

        if (type === TreeType.OAK) { base = '#4e342e'; tip = '#4CAF50'; }
        else if (type === TreeType.PINE) { base = '#3e2723'; tip = '#1B5E20'; }
        else if (type === TreeType.PALM) { base = '#795548'; tip = '#8BC34A'; }
        else if (type === TreeType.ACACIA) { base = '#6D4C41'; tip = '#CDDC39'; }
        else if (type === TreeType.CACTUS) { base = '#2E7D32'; tip = '#43A047'; }
        else if (type === TreeType.JUNGLE) { base = '#5D4037'; tip = '#2E7D32'; } // Dark wood, deep green leaves

        return { base, tip };
    }, [type]);

    // Collider Geometries
    const colliderGeometries = useMemo(() => {
        const cylinder = new THREE.CylinderGeometry(0.225, 0.225, 1.0, 6);
        cylinder.translate(0, 0.5, 0);

        const box = new THREE.BoxGeometry(0.5, 1.0, 0.125);
        box.translate(0, 0.5, 0);

        return { cylinder, box };
    }, []);

    return (
        <group>
            <instancedMesh ref={woodMesh} args={[wood, undefined, count]} castShadow receiveShadow>
                <meshStandardMaterial
                    ref={woodMaterialRef}
                    color={colors.base}
                    roughness={0.9}
                    opacity={opacityRef ? opacityRef.current : opacity}
                    transparent={false}
                    depthWrite
                />
            </instancedMesh>
            {leaves.getAttribute('position') && (
                <instancedMesh ref={leafMesh} args={[leaves, undefined, count]} castShadow receiveShadow>
                    <meshStandardMaterial
                        ref={leafMaterialRef}
                        color={colors.tip}
                        roughness={0.8}
                        opacity={opacityRef ? opacityRef.current : opacity}
                        transparent={false}
                        depthWrite
                    />
                </instancedMesh>
            )}

            {/* Physics Colliders */}
            {rigidBodyGroups.map((instances, i) => (
                <InstancedRigidBodies
                    key={i}
                    instances={instances}
                    type="fixed"
                    colliders={type === TreeType.CACTUS ? "cuboid" : "hull"}
                >
                    <instancedMesh
                        args={[
                            type === TreeType.CACTUS ? colliderGeometries.box : colliderGeometries.cylinder,
                            undefined,
                            instances.length
                        ]}
                        visible={true}
                    >
                        <meshBasicMaterial visible={false} />
                    </instancedMesh>
                </InstancedRigidBodies>
            ))}
        </group>
    );
};
