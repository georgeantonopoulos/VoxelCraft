import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import { RigidBody } from '@react-three/rapier';
import { TerrainService } from '../services/terrainService';
import { createBlockTextureArray } from '../utils/TextureGenerator';
import { BlockShaderMaterial } from './BlockMaterial';
import { raycastVoxel } from '../utils/raycast';
import { CHUNK_SIZE_XZ, RENDER_DISTANCE, BEDROCK_LEVEL, PAD } from '../constants';
import { BlockType } from '../types';

interface ChunkState {
    key: string;
    cx: number;
    cz: number;
    material: Uint8Array;
    version: number;

    positions: Float32Array;
    indices: Uint32Array;
    normals: Float32Array;
    uvs: Float32Array;
    textureIndices: Float32Array;
    ao: Float32Array;

    tPositions: Float32Array;
    tIndices: Uint32Array;
    tNormals: Float32Array;
    tUvs: Float32Array;
    tTextureIndices: Float32Array;
    tAo: Float32Array;
}

interface VoxelTerrainProps {
    action: 'DIG' | 'BUILD' | null;
    isInteracting: boolean;
}

const ChunkMesh = React.memo(({ chunk, texture }: { chunk: ChunkState, texture: THREE.DataArrayTexture }) => {

    const geometry = useMemo(() => {
        if (!chunk.positions || chunk.positions.length === 0) return null;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(chunk.positions, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(chunk.normals, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(chunk.uvs, 2));
        geom.setAttribute('aTextureIndex', new THREE.BufferAttribute(chunk.textureIndices, 1));
        geom.setAttribute('aAo', new THREE.BufferAttribute(chunk.ao, 1));
        geom.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
        return geom;
    }, [chunk.version]);

    const tGeometry = useMemo(() => {
        if (!chunk.tPositions || chunk.tPositions.length === 0) return null;
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(chunk.tPositions, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(chunk.tNormals, 3));
        geom.setAttribute('uv', new THREE.BufferAttribute(chunk.tUvs, 2));
        geom.setAttribute('aTextureIndex', new THREE.BufferAttribute(chunk.tTextureIndices, 1));
        geom.setAttribute('aAo', new THREE.BufferAttribute(chunk.tAo, 1));
        geom.setIndex(new THREE.BufferAttribute(chunk.tIndices, 1));
        return geom;
    }, [chunk.version]);

    return (
        <group position={[chunk.cx * CHUNK_SIZE_XZ, 0, chunk.cz * CHUNK_SIZE_XZ]}>
            {geometry && (
                <RigidBody type="fixed" colliders="trimesh" userData={{ type: 'terrain', key: chunk.key }}>
                    <mesh geometry={geometry} castShadow receiveShadow>
                        {/* @ts-ignore */}
                        <blockShaderMaterial uMap={texture} glslVersion={THREE.GLSL3} />
                    </mesh>
                </RigidBody>
            )}
            {tGeometry && (
                <mesh geometry={tGeometry} renderOrder={1}>
                     {/* @ts-ignore */}
                    <blockShaderMaterial uMap={texture} transparent={true} side={THREE.DoubleSide} depthWrite={false} glslVersion={THREE.GLSL3} />
                </mesh>
            )}
        </group>
    );
});

export const VoxelTerrain: React.FC<VoxelTerrainProps> = ({ action, isInteracting }) => {
    // ... same as before
    const { camera } = useThree();
    const [chunks, setChunks] = useState<Record<string, ChunkState>>({});
    const chunksRef = useRef<Record<string, ChunkState>>({});
    const workerRef = useRef<Worker | null>(null);
    const fluidWorkerRef = useRef<Worker | null>(null);
    const pendingChunks = useRef<Set<string>>(new Set());
    const [activeBlock, setActiveBlock] = useState<BlockType>(BlockType.STONE);

    const texture = useMemo(() => createBlockTextureArray(), []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch(e.key) {
                case '1': setActiveBlock(BlockType.STONE); break;
                case '2': setActiveBlock(BlockType.DIRT); break;
                case '3': setActiveBlock(BlockType.GRASS); break;
                case '4': setActiveBlock(BlockType.WOOD); break;
                case '5': setActiveBlock(BlockType.LEAF); break;
                case '6': setActiveBlock(BlockType.SAND); break;
                case '7': setActiveBlock(BlockType.GLASS); break;
                case '8': setActiveBlock(BlockType.WATER); break;
                case '9': setActiveBlock(BlockType.BEDROCK); break;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    useEffect(() => {
        // Terrain Worker
        workerRef.current = new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current.onmessage = (e) => {
             const { type, payload } = e.data;
             if (type === 'GENERATED' || type === 'REMESHED') {
                 const key = payload.key;
                 pendingChunks.current.delete(key);
                 const chunk = { ...payload, version: payload.version || 0 };
                 chunksRef.current[key] = chunk;
                 setChunks(prev => ({ ...prev, [key]: chunk }));

                 if (type === 'GENERATED') {
                     fluidWorkerRef.current?.postMessage({
                         type: 'LOAD',
                         payload: { key, material: payload.material }
                     });
                 }
             }
        };

        // Fluid Worker
        fluidWorkerRef.current = new Worker(new URL('../workers/fluid.worker.ts', import.meta.url), { type: 'module' });
        fluidWorkerRef.current.onmessage = (e) => {
            if (e.data.type === 'FLUID_UPDATE') {
                const changes = e.data.changes;
                const remeshKeys = new Set<string>();

                changes.forEach((c: any) => {
                    const chunk = chunksRef.current[c.key];
                    if (chunk) {
                        chunk.material[c.idx] = c.val;
                        remeshKeys.add(c.key);
                    }
                });

                remeshKeys.forEach(key => {
                    const chunk = chunksRef.current[key];
                    if (chunk) {
                        workerRef.current?.postMessage({
                            type: 'REMESH',
                            payload: {
                                material: chunk.material,
                                key, cx: chunk.cx, cz: chunk.cz,
                                version: chunk.version + 1
                            }
                        });
                    }
                });
            }
        };

        // Fluid Tick
        const interval = setInterval(() => {
            fluidWorkerRef.current?.postMessage({ type: 'TICK' });
        }, 100);

        return () => {
            workerRef.current?.terminate();
            fluidWorkerRef.current?.terminate();
            clearInterval(interval);
        };
    }, []);

    useFrame(() => {
        if (!workerRef.current) return;
        const px = Math.floor(camera.position.x / CHUNK_SIZE_XZ);
        const pz = Math.floor(camera.position.z / CHUNK_SIZE_XZ);

        const neededKeys = new Set<string>();

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

        // Cleanup
        let chunksRemoved = false;
        const currentKeys = Object.keys(chunksRef.current);

        for (const key of currentKeys) {
            if (!neededKeys.has(key)) {
                delete chunksRef.current[key];
                chunksRemoved = true;
                fluidWorkerRef.current?.postMessage({ type: 'UNLOAD', payload: { key } });
            }
        }

        if (chunksRemoved) {
            setChunks({ ...chunksRef.current });
        }
    });

    // Interaction
    useEffect(() => {
        if (!isInteracting || !action) return;
        
        const origin = camera.position;
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        
        const hit = raycastVoxel(origin, dir, 10, chunksRef.current);

        if (hit) {
             let wx = hit.position[0];
             let wy = hit.position[1]; // World Y
             let wz = hit.position[2];

             if (action === 'BUILD') {
                 wx += hit.normal[0];
                 wy += hit.normal[1];
                 wz += hit.normal[2];
             }

             // Convert World to Local
             const ly = wy - BEDROCK_LEVEL + PAD;

             const cx = Math.floor(wx / CHUNK_SIZE_XZ);
             const cz = Math.floor(wz / CHUNK_SIZE_XZ);
             const key = `${cx},${cz}`;

             const chunk = chunksRef.current[key];
             if (chunk) {
                 const lx = wx - cx * CHUNK_SIZE_XZ + PAD;
                 const lz = wz - cz * CHUNK_SIZE_XZ + PAD;

                 const newBlock = action === 'DIG' ? BlockType.AIR : activeBlock;

                 if (TerrainService.setBlock(chunk.material, lx, ly, lz, newBlock)) {
                     fluidWorkerRef.current?.postMessage({
                         type: 'UPDATE',
                         payload: { key, lx, ly, lz, val: newBlock }
                     });

                     workerRef.current?.postMessage({
                         type: 'REMESH',
                         payload: {
                             material: chunk.material,
                             key, cx, cz,
                             version: chunk.version + 1
                         }
                     });
                 }
             }
        }
    }, [isInteracting, action, camera, activeBlock]);

    return (
        <group>
            {Object.values(chunks).map(chunk => (
                <ChunkMesh key={chunk.key} chunk={chunk} texture={texture} />
            ))}
        </group>
    );
};
