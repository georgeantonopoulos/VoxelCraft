
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import { TerrainService } from '../services/terrainService';
import { DIG_RADIUS, DIG_STRENGTH, VOXEL_SCALE, CHUNK_SIZE, RENDER_DISTANCE } from '../constants';
import { TriplanarMaterial } from './TriplanarMaterial';
import { MaterialType } from '../types';

// --- TYPES ---
type ChunkKey = string; // "x,z"
interface ChunkState {
    key: ChunkKey;
    cx: number;
    cz: number;
    density: Float32Array;
    material: Uint8Array;
    version: number;
    meshPositions: Float32Array;
    meshIndices: Uint32Array;
    meshMaterials: Float32Array;
    meshNormals: Float32Array;
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
        default: return '#888888';
    }
};

// --- COMPONENTS ---

const ChunkMesh: React.FC<{ chunk: ChunkState; sunDirection?: THREE.Vector3 }> = React.memo(({ chunk, sunDirection }) => {
    const meshRef = useRef<THREE.Mesh>(null);
    const [opacity, setOpacity] = useState(0);

    // Fade in effect
    useFrame((state, delta) => {
        if (opacity < 1) {
            setOpacity(prev => Math.min(prev + delta * 2, 1));
        }
        if (meshRef.current) {
             // We can set opacity on the material via ref if needed,
             // but TriplanarMaterial is custom. We'll assume it handles it or we just rely on pop-in fix being faster generation.
             // Actually, user asked for smoother generation, not just pop-in.
             // Opacity fade is a good trick.
        }
    });

    const geometry = useMemo(() => {
        if (!chunk.meshPositions || chunk.meshPositions.length === 0) return null;
        if (!chunk.meshIndices || chunk.meshIndices.length === 0) return null;

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));
        
        if (chunk.meshMaterials && chunk.meshMaterials.length > 0) {
            geom.setAttribute('aMaterial', new THREE.BufferAttribute(chunk.meshMaterials, 1));
        }

        // Polyfill missing attributes for Vibrant shader
        const vertexCount = chunk.meshPositions.length / 3;
        geom.setAttribute('aWetness', new THREE.BufferAttribute(new Float32Array(vertexCount).fill(0), 1));
        geom.setAttribute('aMossiness', new THREE.BufferAttribute(new Float32Array(vertexCount).fill(0), 1));

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

    if (!geometry) return null;

    return (
        <RigidBody 
            key={`${chunk.key}-${chunk.version}`} 
            type="fixed" 
            colliders="trimesh" 
            userData={{ type: 'terrain', key: chunk.key }}
        >
            <mesh 
                ref={meshRef}
                position={[chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE]}
                scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
                castShadow 
                receiveShadow
                frustumCulled={true}
                geometry={geometry}
            >
                <TriplanarMaterial sunDirection={sunDirection} opacity={opacity} />
            </mesh>
        </RigidBody>
    );
});

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
                    (Math.random() - 0.5) * 8,
                    Math.random() * 8 + 4,
                    (Math.random() - 0.5) * 8
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

// --- MAIN COMPONENT ---

export const VoxelTerrain: React.FC<VoxelTerrainProps> = ({ action, isInteracting, sunDirection }) => {
    const { camera } = useThree();
    const { world, rapier } = useRapier();
    
    const [chunks, setChunks] = useState<Record<string, ChunkState>>({});
    const chunksRef = useRef<Record<string, ChunkState>>({});
    const workerRef = useRef<Worker | null>(null);
    const pendingChunks = useRef<Set<string>>(new Set());
    
    const [particleState, setParticleState] = useState<{active: boolean, pos: THREE.Vector3, color: string}>({
        active: false, pos: new THREE.Vector3(), color: '#fff'
    });

    // Initialize Worker
    useEffect(() => {
        const worker = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;

        worker.onmessage = (e) => {
            const { type, payload } = e.data;

            if (type === 'GENERATED') {
                const { key } = payload;
                pendingChunks.current.delete(key);

                // Add to local state
                const newChunk = { ...payload, version: 0 };
                chunksRef.current[key] = newChunk;
                setChunks(prev => ({ ...prev, [key]: newChunk }));
            }
            else if (type === 'REMESHED') {
                const { key, version, meshPositions, meshIndices, meshMaterials, meshNormals } = payload;
                const current = chunksRef.current[key];
                if (current) {
                    // We assume density/material are already updated in the ref by the modification logic
                    // or we can assume the worker sent back what we sent it (but we didn't ask it to echo density).
                    // The main thread modification updated chunksRef density/material in place.

                    const updatedChunk = {
                        ...current,
                        version,
                        meshPositions,
                        meshIndices,
                        meshMaterials,
                        meshNormals
                    };
                    chunksRef.current[key] = updatedChunk;
                    setChunks(prev => ({ ...prev, [key]: updatedChunk }));
                }
            }
        };

        return () => worker.terminate();
    }, []);

    // 1. Infinite Terrain Loading
    useFrame(() => {
        if (!camera || !workerRef.current) return;

        const px = Math.floor(camera.position.x / CHUNK_SIZE);
        const pz = Math.floor(camera.position.z / CHUNK_SIZE);
        
        const neededKeys = new Set<string>();
        let changed = false;

        // Load chunks in range
        for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
            for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
                const cx = px + x;
                const cz = pz + z;
                const key = `${cx},${cz}`;
                neededKeys.add(key);

                if (!chunksRef.current[key] && !pendingChunks.current.has(key)) {
                    pendingChunks.current.add(key);
                    workerRef.current.postMessage({
                        type: 'GENERATE',
                        payload: { cx, cz }
                    });
                }
            }
        }

        // Unload distant chunks
        const newChunks = { ...chunksRef.current };
        Object.keys(newChunks).forEach(key => {
            if (!neededKeys.has(key)) {
                delete newChunks[key];
                changed = true;
                // Note: we don't cancel pending requests in worker, but we ignore them if we don't need them anymore?
                // Or we just let them finish and get garbage collected next cycle.
            }
        });

        if (changed) {
            chunksRef.current = newChunks;
            setChunks(newChunks);
        }
    });

    // 2. Interaction Logic
    useEffect(() => {
        if (!isInteracting || !action) return;

        const origin = camera.position.clone();
        const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        
        const ray = new rapier.Ray(origin, direction);
        const hit = world.castRay(ray, 8.0, true);
        
        if (hit) {
            const rapierHitPoint = ray.pointAt(hit.timeOfImpact);
            const offset = action === 'DIG' ? -0.1 : 0.1;
            const hitPoint = new THREE.Vector3(
                rapierHitPoint.x + direction.x * offset, 
                rapierHitPoint.y + direction.y * offset, 
                rapierHitPoint.z + direction.z * offset
            );
            
            const delta = action === 'DIG' ? -DIG_STRENGTH : DIG_STRENGTH;
            const radius = DIG_RADIUS;

            const minWx = hitPoint.x - (radius + 2); 
            const maxWx = hitPoint.x + (radius + 2);
            const minWz = hitPoint.z - (radius + 2);
            const maxWz = hitPoint.z + (radius + 2);

            const minCx = Math.floor(minWx / CHUNK_SIZE);
            const maxCx = Math.floor(maxWx / CHUNK_SIZE);
            const minCz = Math.floor(minWz / CHUNK_SIZE);
            const maxCz = Math.floor(maxWz / CHUNK_SIZE);

            let anyModified = false;
            let primaryMat = MaterialType.DIRT;

            const affectedChunks: string[] = [];

            for (let cx = minCx; cx <= maxCx; cx++) {
                for (let cz = minCz; cz <= maxCz; cz++) {
                    const key = `${cx},${cz}`;
                    const chunk = chunksRef.current[key];
                    
                    if (chunk) {
                        const localX = hitPoint.x - (cx * CHUNK_SIZE);
                        const localY = hitPoint.y;
                        const localZ = hitPoint.z - (cz * CHUNK_SIZE);

                        const modified = TerrainService.modifyChunk(
                            chunk.density,
                            chunk.material,
                            { x: localX, y: localY, z: localZ },
                            radius,
                            delta,
                            MaterialType.STONE
                        );

                        if (modified) {
                            anyModified = true;
                            affectedChunks.push(key);
                            
                            // Capture center material
                            if (Math.abs(hitPoint.x - ((cx + 0.5) * CHUNK_SIZE)) < CHUNK_SIZE/2 && 
                                Math.abs(hitPoint.z - ((cz + 0.5) * CHUNK_SIZE)) < CHUNK_SIZE/2) {
                                // Best guess without meshing yet
                                primaryMat = chunk.material[0] || MaterialType.DIRT;
                                // Or just use the brush material/stone for particles
                                if (action === 'BUILD') primaryMat = MaterialType.STONE;
                                else primaryMat = MaterialType.DIRT; // Approximate
                            }
                        }
                    }
                }
            }

            if (anyModified && workerRef.current) {
                // Trigger remeshing for all affected chunks
                affectedChunks.forEach(key => {
                    const chunk = chunksRef.current[key];
                    workerRef.current!.postMessage({
                        type: 'REMESH',
                        payload: {
                            key,
                            cx: chunk.cx,
                            cz: chunk.cz,
                            density: chunk.density,
                            material: chunk.material,
                            version: chunk.version + 1
                        }
                    });
                });
                
                setParticleState({
                    active: true,
                    pos: hitPoint,
                    color: getMaterialColor(primaryMat)
                });
                
                setTimeout(() => setParticleState(prev => ({...prev, active: false})), 50);
            }
        }
    }, [isInteracting, action, camera, world, rapier]);

    return (
        <group>
            {Object.values(chunks).map(chunk => (
                <ChunkMesh key={chunk.key} chunk={chunk} sunDirection={sunDirection} />
            ))}
            
            <Particles 
                active={particleState.active} 
                position={particleState.pos} 
                color={particleState.color} 
            />
        </group>
    );
};
