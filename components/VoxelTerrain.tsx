
import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { RigidBody, useRapier } from '@react-three/rapier';
import { generateMesh } from '../utils/mesher';
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
}

interface VoxelTerrainProps {
    action: 'DIG' | 'BUILD' | null;
    isInteracting: boolean;
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

const ChunkMesh: React.FC<{ chunk: ChunkState }> = React.memo(({ chunk }) => {
    // Pre-calculate geometry to ensure it exists before RigidBody mounts
    const geometry = useMemo(() => {
        // Safety check for empty arrays
        if (!chunk.meshPositions || chunk.meshPositions.length === 0) return null;
        if (!chunk.meshIndices || chunk.meshIndices.length === 0) return null;

        const geom = new THREE.BufferGeometry();
        
        // Explicitly create BufferAttributes
        geom.setAttribute('position', new THREE.BufferAttribute(chunk.meshPositions, 3));
        
        // Handle custom material attribute
        if (chunk.meshMaterials && chunk.meshMaterials.length > 0) {
            geom.setAttribute('aMaterial', new THREE.BufferAttribute(chunk.meshMaterials, 1));
        }

        // Set Index
        geom.setIndex(new THREE.BufferAttribute(chunk.meshIndices, 1));

        // Compute derived data
        geom.computeVertexNormals();
        geom.computeBoundingBox();
        geom.computeBoundingSphere();

        return geom;
    }, [chunk.meshPositions, chunk.meshIndices, chunk.meshMaterials, chunk.version]);

    // If no geometry, render nothing
    if (!geometry) return null;

    return (
        // Key ensures RigidBody is recreated when geometry changes (digging)
        // This is required for 'trimesh' colliders to update their shape
        <RigidBody 
            key={`${chunk.key}-${chunk.version}`} 
            type="fixed" 
            colliders="trimesh" 
            userData={{ type: 'terrain', key: chunk.key }}
        >
            <mesh 
                position={[chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE]}
                scale={[VOXEL_SCALE, VOXEL_SCALE, VOXEL_SCALE]}
                castShadow 
                receiveShadow
                frustumCulled={true}
                geometry={geometry}
            >
                <TriplanarMaterial />
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
                
                velocities.current[i].y -= 25.0 * delta; // Gravity
                dummy.position.addScaledVector(velocities.current[i], delta);
                
                dummy.rotation.x += delta * 10;
                dummy.rotation.z += delta * 5;
                
                dummy.scale.setScalar(Math.max(0, lifetimes.current[i])); // Shrink
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

export const VoxelTerrain: React.FC<VoxelTerrainProps> = ({ action, isInteracting }) => {
    const { camera } = useThree();
    const { world, rapier } = useRapier();
    
    const [chunks, setChunks] = useState<Record<string, ChunkState>>({});
    const chunksRef = useRef<Record<string, ChunkState>>({});
    
    const [particleState, setParticleState] = useState<{active: boolean, pos: THREE.Vector3, color: string}>({
        active: false, pos: new THREE.Vector3(), color: '#fff'
    });

    // 1. Infinite Terrain Loading
    useFrame(() => {
        if (!camera) return;

        const px = Math.floor(camera.position.x / CHUNK_SIZE);
        const pz = Math.floor(camera.position.z / CHUNK_SIZE);
        
        const neededKeys = new Set<string>();
        let changed = false;
        const newChunks = { ...chunksRef.current };

        // Load chunks in range
        for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
            for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
                const cx = px + x;
                const cz = pz + z;
                const key = `${cx},${cz}`;
                neededKeys.add(key);

                if (!newChunks[key]) {
                    const { density, material } = TerrainService.generateChunk(cx, cz);
                    const mesh = generateMesh(density, material);
                    
                    newChunks[key] = {
                        key, cx, cz, density, material, version: 0,
                        meshPositions: mesh.positions,
                        meshIndices: mesh.indices,
                        meshMaterials: mesh.materials
                    };
                    changed = true;
                }
            }
        }

        // Unload distant chunks
        Object.keys(newChunks).forEach(key => {
            if (!neededKeys.has(key)) {
                delete newChunks[key];
                changed = true;
            }
        });

        if (changed) {
            chunksRef.current = newChunks;
            setChunks(newChunks);
        }
    });

    // 2. Interaction Logic (Fixed Seams)
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

            // Calculate bounds of the brush in world space
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

            // To update multiple chunks cleanly, we first clone the ref to avoid direct mutation state issues
            // But here we just mutate properties and trigger one setState at the end
            
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
                            const newMesh = generateMesh(chunk.density, chunk.material);
                            chunksRef.current[key] = {
                                ...chunk,
                                version: chunk.version + 1,
                                meshPositions: newMesh.positions,
                                meshIndices: newMesh.indices,
                                meshMaterials: newMesh.materials
                            };
                            anyModified = true;
                            
                            // Capture center material for particles
                            if (Math.abs(hitPoint.x - ((cx + 0.5) * CHUNK_SIZE)) < CHUNK_SIZE/2 && 
                                Math.abs(hitPoint.z - ((cz + 0.5) * CHUNK_SIZE)) < CHUNK_SIZE/2) {
                                if (newMesh.materials.length > 0) primaryMat = newMesh.materials[0];
                            }
                        }
                    }
                }
            }

            if (anyModified) {
                setChunks({ ...chunksRef.current });
                
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
                <ChunkMesh key={chunk.key} chunk={chunk} />
            ))}
            
            <Particles 
                active={particleState.active} 
                position={particleState.pos} 
                color={particleState.color} 
            />
        </group>
    );
};
