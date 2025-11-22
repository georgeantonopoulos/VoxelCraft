
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { TerrainService } from '../services/terrainService';
import { metadataDB } from '../services/MetadataDB';
import { simulationManager, SimUpdate } from '../services/SimulationManager';
import { DIG_RADIUS, DIG_STRENGTH, VOXEL_SCALE, CHUNK_SIZE_XZ, RENDER_DISTANCE } from '../constants';
import { TriplanarMaterial } from './TriplanarMaterial';
import { WaterMaterial } from './WaterMaterial';
import { MaterialType, ChunkMetadata } from '../types';

// --- TYPES ---
type ChunkKey = string; // "x,z"
interface ChunkState {
    key: ChunkKey;
    cx: number;
    cz: number;
    density: Float32Array;
    material: Uint8Array;
    version: number;

    // Terrain Mesh
    meshPositions: Float32Array;
    meshIndices: Uint32Array;
    meshMaterials: Float32Array;
    meshNormals: Float32Array;
    meshWetness: Float32Array;
    meshMossiness: Float32Array;

    // Water Mesh
    meshWaterPositions: Float32Array;
    meshWaterIndices: Uint32Array;
    meshWaterNormals: Float32Array;
}

interface VoxelTerrainProps {
    action: 'DIG' | 'BUILD' | null;
    isInteracting: boolean;
    sunDirection?: THREE.Vector3;
}

// --- HELPER ---
const getMaterialColor = (matId: number) => {
    switch(matId) {
        case MaterialType.SNOW: return '#ffffff';
        case MaterialType.STONE: return '#666670';
        case MaterialType.BEDROCK: return '#222222';
        case MaterialType.SAND: return '#dcd0a0';
        case MaterialType.DIRT: return '#5d4037';
        case MaterialType.GRASS: return '#55aa33';
        case MaterialType.CLAY: return '#a67b5b';
        case MaterialType.WATER: return '#6ec2f7';
        case MaterialType.MOSSY_STONE: return '#5c8a3c';
        default: return '#888888';
    }
};

const isTerrainCollider = (collider: Collider): boolean => {
    const parent = collider.parent();
    const userData = parent?.userData as { type?: string } | undefined;
    return userData?.type === 'terrain';
};

// --- COMPONENTS ---

const ChunkMesh: React.FC<{ chunk: ChunkState; sunDirection?: THREE.Vector3 }> = React.memo(({ chunk, sunDirection }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const [opacity, setOpacity] = useState(0);

    useFrame((state, delta) => {
        if (opacity < 1) {
            setOpacity(prev => Math.min(prev + delta * 2, 1));
        }
    });

    const terrainGeometry = useMemo(() => {
        if (!chunk.meshPositions || chunk.meshPositions.length === 0) return null;
        if (!chunk.meshIndices || chunk.meshIndices.length === 0) return null;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));
        
        if (chunk.meshMaterials) geom.setAttribute('aMaterial', new THREE.BufferAttribute(chunk.meshMaterials, 1));
        if (chunk.meshWetness) geom.setAttribute('aWetness', new THREE.BufferAttribute(chunk.meshWetness, 1));
        if (chunk.meshMossiness) geom.setAttribute('aMossiness', new THREE.BufferAttribute(chunk.meshMossiness, 1));

        if (chunk.meshNormals && chunk.meshNormals.length > 0) {
            geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshNormals, 3));
        } else {
            geom.computeVertexNormals();
        }

        geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));
        geom.computeBoundingBox();
        geom.computeBoundingSphere();

        return geom;
    }, [chunk.meshPositions, chunk.meshIndices, chunk.meshMaterials, chunk.meshNormals, chunk.version]);

    const waterGeometry = useMemo(() => {
        if (!chunk.meshWaterPositions || chunk.meshWaterPositions.length === 0) return null;
        if (!chunk.meshWaterIndices || chunk.meshWaterIndices.length === 0) return null;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshWaterPositions, 3));
        if (chunk.meshWaterNormals && chunk.meshWaterNormals.length > 0) {
            geom.setAttribute('normal', new THREE.BufferAttribute(chunk.meshWaterNormals, 3));
        } else {
            geom.computeVertexNormals();
        }
        geom.setIndex(new THREE.BufferAttribute(chunk.meshWaterIndices, 1));
        return geom;
    }, [chunk.meshWaterPositions, chunk.meshWaterIndices, chunk.meshWaterNormals, chunk.version]);

    if (!terrainGeometry && !waterGeometry) return null;

    const colliderKey = `${chunk.key}-${chunk.version}`;

    return (
        <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
            {terrainGeometry && (
                <RigidBody
                    key={colliderKey}
                    type="fixed"
                    colliders="trimesh"
                    userData={{ type: 'terrain', key: chunk.key }}
                >
                    <mesh
                        ref={meshRef}
                        scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
                        castShadow
                        receiveShadow
                        frustumCulled={true}
                        geometry={terrainGeometry}
                    >
                        <TriplanarMaterial sunDirection={sunDirection} opacity={opacity} />
                    </mesh>
                </RigidBody>
            )}

            {waterGeometry && (
                <mesh geometry={waterGeometry} scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}>
                    <WaterMaterial sunDirection={sunDirection} />
                </mesh>
            )}
        </group>
    );
});

// ... Particles component is fine ...
const Particles = ({ active, position, color }: { active: boolean, position: THREE.Vector3, color: string }) => {
    const mesh = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const count = 20;
    const lifetimes = useRef<number[]>(new Array(count).fill(0));
    const velocities = useRef<THREE.Vector3[]>(new Array(count).fill(new THREE.Vector3()));
    const meshMatRef = useRef<THREE.MeshStandardMaterial>(null);

    useEffect(() => {
        if (active && mesh.current && meshMatRef.current) {
            mesh.current.visible = true;
            meshMatRef.current.color.set(color);
            meshMatRef.current.emissive.set(color);
            meshMatRef.current.emissiveIntensity = 0.2;
            for (let i = 0; i < count; i++) {
                dummy.position.copy(position);
                dummy.position.x += (Math.random() - 0.5);
                dummy.position.y += (Math.random() - 0.5);
                dummy.position.z += (Math.random() - 0.5);
                dummy.scale.setScalar(Math.random() * 0.3 + 0.1);
                dummy.updateMatrix();
                mesh.current.setMatrixAt(i, dummy.matrix);
                lifetimes.current[i] = 0.3 + Math.random() * 0.4; 
                velocities.current[i] = new THREE.Vector3(
                    (Math.random() - 0.5) * 8, Math.random() * 8 + 4, (Math.random() - 0.5) * 8
                );
            }
            mesh.current.instanceMatrix.needsUpdate = true;
        }
    }, [active, position, color, dummy]); 

    useFrame((state, delta) => {
        if (!mesh.current || !mesh.current.visible) return;
        let activeCount = 0;
        for (let i = 0; i < count; i++) {
            if (lifetimes.current[i] > 0) {
                lifetimes.current[i] -= delta;
                mesh.current.getMatrixAt(i, dummy.matrix);
                dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
                velocities.current[i].y -= 25.0 * delta;
                dummy.position.addScaledVector(velocities.current[i], delta);
                dummy.rotation.x += delta * 10;
                dummy.rotation.z += delta * 5;
                dummy.scale.setScalar(Math.max(0, lifetimes.current[i]));
                dummy.updateMatrix();
                mesh.current.setMatrixAt(i, dummy.matrix);
                activeCount++;
            }
        }
        mesh.current.instanceMatrix.needsUpdate = true;
        if (activeCount === 0 && !active) mesh.current.visible = false;
    });

    return (
        <instancedMesh ref={mesh} args={[undefined, undefined, count]} visible={false}>
            <boxGeometry args={[0.15, 0.15, 0.15]} />
            <meshStandardMaterial ref={meshMatRef} color="#fff" roughness={0.8} toneMapped={false} />
        </instancedMesh>
    );
};

export const VoxelTerrain: React.FC<VoxelTerrainProps> = ({ action, isInteracting, sunDirection }) => {
    const { camera } = useThree();
    const { world, rapier } = useRapier();
    
    const [buildMat, setBuildMat] = useState<MaterialType>(MaterialType.STONE);
    const remeshQueue = useRef<string[]>([]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '1') setBuildMat(MaterialType.DIRT);
            if (e.key === '2') setBuildMat(MaterialType.STONE);
            if (e.key === '3') setBuildMat(MaterialType.WATER); // New Water
            if (e.key === '4') setBuildMat(MaterialType.MOSSY_STONE);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const [chunks, setChunks] = useState<Record<string, ChunkState>>({});
    const chunksRef = useRef<Record<string, ChunkState>>({});
    const workerRef = useRef<Worker | null>(null);
    const pendingChunks = useRef<Set<string>>(new Set());
    
    const [particleState, setParticleState] = useState<{active: boolean, pos: THREE.Vector3, color: string}>({
        active: false, pos: new THREE.Vector3(), color: '#fff'
    });

    useEffect(() => {
        simulationManager.start();

        // Handle updates from simulation (Water flow, Wetness)
        simulationManager.setCallback((updates: SimUpdate[]) => {
            updates.forEach(update => {
                const chunk = chunksRef.current[update.key];
                if (chunk) {
                    // Critical: Update the local material state so next remesh uses it
                    chunk.material.set(update.material);

                    if (!remeshQueue.current.includes(update.key)) {
                        remeshQueue.current.push(update.key);
                    }
                }
            });
        });

        const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, payload } = e.data;

            if (type === 'GENERATED') {
                const { key, metadata, material } = payload;
                pendingChunks.current.delete(key);
                metadataDB.initChunk(key, metadata);
                simulationManager.addChunk(key, payload.cx, payload.cz, material, metadata.wetness, metadata.mossiness);

                const newChunk = { ...payload, version: 0 };
                chunksRef.current[key] = newChunk;
                setChunks(prev => ({ ...prev, [key]: newChunk }));
            }
            else if (type === 'REMESHED') {
                const { key, version, meshPositions, meshIndices, meshMaterials, meshNormals, meshWetness, meshMossiness, meshWaterPositions, meshWaterIndices, meshWaterNormals } = payload;
                const current = chunksRef.current[key];
                if (current) {
                    const updatedChunk = {
                        ...current,
                        version,
                        meshPositions, meshIndices, meshMaterials, meshNormals, meshWetness, meshMossiness,
                        meshWaterPositions, meshWaterIndices, meshWaterNormals
                    };
                    chunksRef.current[key] = updatedChunk;
                    setChunks(prev => ({ ...prev, [key]: updatedChunk }));
                }
            }
        };

        return () => worker.terminate();
    }, []);

    useFrame(() => {
        if (!camera || !workerRef.current) return;

        const px = Math.floor(camera.position.x / CHUNK_SIZE_XZ);
        const pz = Math.floor(camera.position.z / CHUNK_SIZE_XZ);
        
        const neededKeys = new Set<string>();
        let changed = false;

        for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
            for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
                const cx = px + x;
                const cz = pz + z;
                const key = `${cx},${cz}`;
                neededKeys.add(key);

                if (!chunksRef.current[key] && !pendingChunks.current.has(key)) {
                    pendingChunks.current.add(key);
                    workerRef.current.postMessage({ type: 'GENERATE', payload: { cx, cz } });
                }
            }
        }

        const newChunks = { ...chunksRef.current };
        Object.keys(newChunks).forEach(key => {
            if (!neededKeys.has(key)) {
                simulationManager.removeChunk(key);
                delete newChunks[key];
                changed = true;
            }
        });

        if (changed) {
            chunksRef.current = newChunks;
            setChunks(newChunks);
        }

        // Remesh queue (increased throttle for fluids)
        if (remeshQueue.current.length > 0) {
             const maxPerFrame = 4; // Higher throughput for water updates
             for (let i=0; i<maxPerFrame; i++) {
                 const key = remeshQueue.current.shift();
                 if (!key) break;

                 const chunk = chunksRef.current[key];
                 const metadata = metadataDB.getChunk(key);

                 if (chunk && metadata) {
                     workerRef.current.postMessage({
                        type: 'REMESH',
                        payload: {
                            key,
                            cx: chunk.cx,
                            cz: chunk.cz,
                            density: chunk.density,
                            material: chunk.material,
                            wetness: metadata['wetness'],
                            mossiness: metadata['mossiness'],
                            version: chunk.version + 1
                        }
                    });
                 }
             }
        }
    });

    // Interaction
    useEffect(() => {
        if (!isInteracting || !action) return;

        const origin = camera.position.clone();
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const maxRayDistance = 16.0;
        
        const ray = new rapier.Ray(origin, direction);
        const terrainHit = world.castRay(ray, maxRayDistance, true, undefined, undefined, undefined, undefined, isTerrainCollider);
        
        if (terrainHit) {
            const rapierHitPoint = ray.pointAt(terrainHit.timeOfImpact);
            const impactPoint = new THREE.Vector3(rapierHitPoint.x, rapierHitPoint.y, rapierHitPoint.z);
            const dist = origin.distanceTo(impactPoint);

            const offset = action === 'DIG' ? 0.1 : -0.1;
            const hitPoint = impactPoint.addScaledVector(direction, offset);
            const delta = action === 'DIG' ? -DIG_STRENGTH : DIG_STRENGTH;
            const radius = (dist < 3.0) ? 1.1 : DIG_RADIUS;

            const minWx = hitPoint.x - (radius + 2);
            const maxWx = hitPoint.x + (radius + 2);
            const minWz = hitPoint.z - (radius + 2);
            const maxWz = hitPoint.z + (radius + 2);

            const minCx = Math.floor(minWx / CHUNK_SIZE_XZ);
            const maxCx = Math.floor(maxWx / CHUNK_SIZE_XZ);
            const minCz = Math.floor(minWz / CHUNK_SIZE_XZ);
            const maxCz = Math.floor(maxWz / CHUNK_SIZE_XZ);

            let anyModified = false;
            let primaryMat = MaterialType.DIRT;
            const affectedChunks: string[] = [];

            for (let cx = minCx; cx <= maxCx; cx++) {
                for (let cz = minCz; cz <= maxCz; cz++) {
                    const key = `${cx},${cz}`;
                    const chunk = chunksRef.current[key];
                    if (chunk) {
                        const localX = hitPoint.x - (cx * CHUNK_SIZE_XZ);
                        const localY = hitPoint.y;
                        const localZ = hitPoint.z - (cz * CHUNK_SIZE_XZ);

                        const modified = TerrainService.modifyChunk(
                            chunk.density, chunk.material,
                            { x: localX, y: localY, z: localZ },
                            radius, delta, buildMat
                        );

                        if (modified) {
                            anyModified = true;
                            affectedChunks.push(key);
                            if (Math.abs(hitPoint.x - ((cx + 0.5) * CHUNK_SIZE_XZ)) < CHUNK_SIZE_XZ/2 &&
                                Math.abs(hitPoint.z - ((cz + 0.5) * CHUNK_SIZE_XZ)) < CHUNK_SIZE_XZ/2) {
                                if (action === 'BUILD') primaryMat = buildMat;
                                else primaryMat = MaterialType.DIRT;
                            }
                        }
                    }
                }
            }

            if (anyModified && workerRef.current) {
                affectedChunks.forEach(key => {
                    const chunk = chunksRef.current[key];
                    const metadata = metadataDB.getChunk(key);
                    if (chunk && metadata) {
                        simulationManager.addChunk(key, chunk.cx, chunk.cz, chunk.material, metadata.wetness, metadata.mossiness);
                        workerRef.current!.postMessage({
                            type: 'REMESH',
                            payload: {
                                key, cx: chunk.cx, cz: chunk.cz,
                                density: chunk.density, material: chunk.material,
                                wetness: metadata.wetness, mossiness: metadata.mossiness,
                                version: chunk.version + 1
                            }
                        });
                    }
                });
                
                setParticleState({ active: true, pos: hitPoint, color: getMaterialColor(primaryMat) });
                setTimeout(() => setParticleState(prev => ({...prev, active: false})), 50);
            }
        }
    }, [isInteracting, action, camera, world, rapier]);

    return (
        <group>
            {Object.values(chunks).map(chunk => (
                <ChunkMesh key={chunk.key} chunk={chunk} sunDirection={sunDirection} />
            ))}
            <Particles active={particleState.active} position={particleState.pos} color={particleState.color} />
        </group>
    );
};
