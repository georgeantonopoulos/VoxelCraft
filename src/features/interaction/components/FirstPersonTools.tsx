import React, { useEffect, useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useControls, button } from 'leva';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { TorchTool } from './TorchTool';
import { RIGHT_HAND_HELD_ITEM_POSES, PICKAXE_POSE, TORCH_POSE } from '@features/interaction/logic/HeldItemPoses';
import { ItemType } from '@/types';
import { UniversalTool } from './UniversalTool';
import { getToolCapabilities } from '@features/interaction/logic/ToolCapabilities';

export const FirstPersonTools: React.FC = () => {
    const { camera, scene, size } = useThree(); // Needed for parenting and responsive logic
    const groupRef = useRef<THREE.Group>(null);
    const torchRef = useRef<THREE.Group>(null); // left hand (torch)
    const rightItemRef = useRef<THREE.Group>(null); // right hand
    const luminaLightRef = useRef<THREE.PointLight>(null);

    // Inventory State
    const inventorySlots = useInventoryStore(state => state.inventorySlots);
    const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);
    const customTools = useInventoryStore(state => state.customTools);

    const selectedItem = inventorySlots[selectedSlotIndex];
    const activeCustomTool = typeof selectedItem === 'string' ? customTools[selectedItem] : null;

    const luminaGlowStartTime = useRef(0);
    const luminaGlowDuration = useRef(1000);
    const glowBoost = useRef(0);

    useEffect(() => {
        const handleGlow = (e: any) => {
            glowBoost.current = 5.0;
            luminaGlowStartTime.current = Date.now();
            luminaGlowDuration.current = e.detail.duration || 1000;
        };
        window.addEventListener('lumina-glow-start', handleGlow);
        return () => window.removeEventListener('lumina-glow-start', handleGlow);
    }, []);

    // Debug UI for torch pose.
    const debugMode = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        return params.has('debug');
    }, []);

    const torchPoseDebug = useControls(
        'Torch Pose',
        {
            posX: { value: TORCH_POSE.x, min: -1.5, max: 0.0, step: 0.01 },
            posY: { value: TORCH_POSE.y, min: -1.0, max: 0.5, step: 0.01 },
            posZ: { value: TORCH_POSE.z, min: -2.0, max: -0.2, step: 0.01 },
            rotXDeg: { value: Math.round(THREE.MathUtils.radToDeg(TORCH_POSE.rot.x)), min: -180, max: 180, step: 1 },
            rotYDeg: { value: Math.round(THREE.MathUtils.radToDeg(TORCH_POSE.rot.y)), min: -180, max: 180, step: 1 },
            rotZDeg: { value: Math.round(THREE.MathUtils.radToDeg(TORCH_POSE.rot.z)), min: -180, max: 180, step: 1 },
            scale: { value: TORCH_POSE.scale, min: 0.2, max: 1.5, step: 0.01 },
            hiddenYOffset: { value: TORCH_POSE.hiddenYOffset ?? -0.8, min: -2.0, max: -0.2, step: 0.01 },
        },
        ({ hidden: !debugMode } as any)
    );

    const [rightHandStickPoseDebug, setRightHandStickPoseDebug] = useControls(
        'Right Hand / Stick',
        () => ({
            xOffset: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.xOffset ?? 0, min: -1.0, max: 1.0, step: 0.01 },
            y: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.y, min: -1.2, max: 0.6, step: 0.01 },
            z: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.z, min: -2.0, max: -0.1, step: 0.01 },
            scale: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.scale, min: 0.1, max: 2.0, step: 0.01 },
            rotXDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rot?.x ?? 0), min: -180, max: 180, step: 1 },
            rotYDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rot?.y ?? 0), min: -180, max: 180, step: 1 },
            rotZDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rot?.z ?? 0), min: -180, max: 180, step: 1 },
            'Save To Code': button((get) => (async () => {
                try {
                    const xOffset = (typeof get === 'function' ? (get('Right Hand / Stick.xOffset') as number) : undefined) ?? rightHandStickPoseDebug.xOffset;
                    const y = (typeof get === 'function' ? (get('Right Hand / Stick.y') as number) : undefined) ?? rightHandStickPoseDebug.y;
                    const z = (typeof get === 'function' ? (get('Right Hand / Stick.z') as number) : undefined) ?? rightHandStickPoseDebug.z;
                    const scale = (typeof get === 'function' ? (get('Right Hand / Stick.scale') as number) : undefined) ?? rightHandStickPoseDebug.scale;
                    const rotXDeg = (typeof get === 'function' ? (get('Right Hand / Stick.rotXDeg') as number) : undefined) ?? rightHandStickPoseDebug.rotXDeg;
                    const rotYDeg = (typeof get === 'function' ? (get('Right Hand / Stick.rotYDeg') as number) : undefined) ?? rightHandStickPoseDebug.rotYDeg;
                    const rotZDeg = (typeof get === 'function' ? (get('Right Hand / Stick.rotZDeg') as number) : undefined) ?? rightHandStickPoseDebug.rotZDeg;

                    const res = await fetch('/__vc/held-item-poses', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            kind: ItemType.STICK,
                            stick: {
                                xOffset,
                                y,
                                z,
                                scale,
                                rotOffset: {
                                    x: THREE.MathUtils.degToRad(rotXDeg),
                                    y: THREE.MathUtils.degToRad(rotYDeg),
                                    z: THREE.MathUtils.degToRad(rotZDeg),
                                }
                            }
                        })
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status} `);
                    console.log('[Right Hand / Stick] Saved pose to code.');
                } catch (err) {
                    console.error('[Right Hand / Stick] Save failed:', err);
                }
            })()),
        }),
        ({ hidden: !debugMode } as any)
    );

    const [rightHandStonePoseDebug, setRightHandStonePoseDebug] = useControls(
        'Right Hand / Stone',
        () => ({
            xOffset: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.xOffset ?? 0, min: -1.0, max: 1.0, step: 0.01 },
            y: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.y, min: -1.2, max: 0.6, step: 0.01 },
            z: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.z, min: -2.0, max: -0.1, step: 0.01 },
            scale: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.scale, min: 0.1, max: 2.0, step: 0.01 },
            rotXDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rot?.x ?? 0), min: -180, max: 180, step: 1 },
            rotYDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rot?.y ?? 0), min: -180, max: 180, step: 1 },
            rotZDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rot?.z ?? 0), min: -180, max: 180, step: 1 },
            'Save To Code': button((get) => (async () => {
                try {
                    const xOffset = (typeof get === 'function' ? (get('Right Hand / Stone.xOffset') as number) : undefined) ?? rightHandStonePoseDebug.xOffset;
                    const y = (typeof get === 'function' ? (get('Right Hand / Stone.y') as number) : undefined) ?? rightHandStonePoseDebug.y;
                    const z = (typeof get === 'function' ? (get('Right Hand / Stone.z') as number) : undefined) ?? rightHandStonePoseDebug.z;
                    const scale = (typeof get === 'function' ? (get('Right Hand / Stone.scale') as number) : undefined) ?? rightHandStonePoseDebug.scale;
                    const rotXDeg = (typeof get === 'function' ? (get('Right Hand / Stone.rotXDeg') as number) : undefined) ?? rightHandStonePoseDebug.rotXDeg;
                    const rotYDeg = (typeof get === 'function' ? (get('Right Hand / Stone.rotYDeg') as number) : undefined) ?? rightHandStonePoseDebug.rotYDeg;
                    const rotZDeg = (typeof get === 'function' ? (get('Right Hand / Stone.rotZDeg') as number) : undefined) ?? rightHandStonePoseDebug.rotZDeg;

                    const res = await fetch('/__vc/held-item-poses', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            kind: ItemType.STONE,
                            stone: {
                                xOffset,
                                y,
                                z,
                                scale,
                                rotOffset: {
                                    x: THREE.MathUtils.degToRad(rotXDeg),
                                    y: THREE.MathUtils.degToRad(rotYDeg),
                                    z: THREE.MathUtils.degToRad(rotZDeg),
                                }
                            }
                        })
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status} `);
                    console.log('[Right Hand / Stone] Saved pose to code.');
                } catch (err) {
                    console.error('[Right Hand / Stone] Save failed:', err);
                }
            })()),
        }),
        ({ hidden: !debugMode } as any)
    );

    useEffect(() => {
        if (!debugMode) return;
        setRightHandStickPoseDebug({
            xOffset: RIGHT_HAND_HELD_ITEM_POSES.stick!.xOffset ?? 0,
            y: RIGHT_HAND_HELD_ITEM_POSES.stick!.y,
            z: RIGHT_HAND_HELD_ITEM_POSES.stick!.z,
            scale: RIGHT_HAND_HELD_ITEM_POSES.stick!.scale,
            rotXDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick!.rot?.x ?? 0),
            rotYDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick!.rot?.y ?? 0),
            rotZDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick!.rot?.z ?? 0),
        });
        setRightHandStonePoseDebug({
            xOffset: RIGHT_HAND_HELD_ITEM_POSES.stone!.xOffset ?? 0,
            y: RIGHT_HAND_HELD_ITEM_POSES.stone!.y,
            z: RIGHT_HAND_HELD_ITEM_POSES.stone!.z,
            scale: RIGHT_HAND_HELD_ITEM_POSES.stone!.scale,
            rotXDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone!.rot?.x ?? 0),
            rotYDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone!.rot?.y ?? 0),
            rotZDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone!.rot?.z ?? 0),
        });
    }, [debugMode, setRightHandStickPoseDebug, setRightHandStonePoseDebug]);

    // Animation state
    const isDigging = useRef(false);
    const digProgress = useRef(0);
    const digSpeed = 10.0;
    const impactKick = useRef(0);
    const impactKickTarget = useRef(0);

    // Torch animation state
    const torchProgress = useRef(0);
    const torchTargetPos = useRef(new THREE.Vector3(-0.5, -0.3, -0.4));
    const torchHiddenPos = useRef(new THREE.Vector3(-0.5, -1.10, -0.4));
    const torchPosTemp = useRef(new THREE.Vector3());
    const torchRotDefault = useRef(new THREE.Euler(TORCH_POSE.rot.x, TORCH_POSE.rot.y, TORCH_POSE.rot.z));
    const torchScaleDefault = useRef(TORCH_POSE.scale);

    // Right-hand item animation state
    const rightItemProgress = useRef(0);
    const rightItemTargetPos = useRef(new THREE.Vector3(PICKAXE_POSE.x, 0, 0));
    const rightItemHiddenPos = useRef(new THREE.Vector3(PICKAXE_POSE.x, -1.10, 0));
    const rightItemPosTemp = useRef(new THREE.Vector3());

    // Debug controls
    const { debugPos, debugRot } = usePickaxeDebug();

    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            if (!document.pointerLockElement) return;
            const state = useInventoryStore.getState();
            const selectedItem = state.inventorySlots[state.selectedSlotIndex];
            if (!selectedItem) return;
            if (e.button === 0 && !isDigging.current) {
                isDigging.current = true;
                digProgress.current = 0;
            }
        };
        window.addEventListener('mousedown', handleMouseDown);
        return () => window.removeEventListener('mousedown', handleMouseDown);
    }, []);

    useEffect(() => {
        const handleImpact = (e: Event) => {
            const ce = e as CustomEvent;
            const detail = (ce.detail ?? {}) as { action?: string; ok?: boolean };
            if (!document.pointerLockElement) return;
            if (detail.action === 'DIG' || detail.action === 'CHOP' || detail.action === 'SMASH') {
                isDigging.current = true;
                digProgress.current = 0;
                impactKickTarget.current = detail.ok === false ? 1.0 : 0.65;
            } else if (detail.action === 'BUILD') {
                impactKickTarget.current = 0.25;
            }
        };
        window.addEventListener('tool-impact', handleImpact as EventListener);
        return () => window.removeEventListener('tool-impact', handleImpact as EventListener);
    }, []);

    useEffect(() => {
        if (groupRef.current && camera && scene) {
            scene.add(camera);
            camera.add(groupRef.current);
            return () => {
                camera.remove(groupRef.current);
                scene.remove(camera);
            };
        }
    }, [camera, scene]);

    const capabilities = useMemo(() => {
        const item = activeCustomTool || selectedItem;
        return getToolCapabilities(item as any);
    }, [activeCustomTool, selectedItem]);

    useFrame((state, delta) => {
        if (!torchRef.current && !rightItemRef.current) return;
        const aspect = size.width / size.height;
        const responsiveX = THREE.MathUtils.clamp(aspect / 1.1, 0.5, 1.0);
        const time = state.clock.getElapsedTime();
        const swayX = Math.sin(time * 2) * 0.005;
        const swayY = Math.cos(time * 4) * 0.005;

        let positionX = (debugPos.current.x * responsiveX) + swayX;
        let positionY = debugPos.current.y + swayY;
        let positionZ = debugPos.current.z;
        let rotationX = debugRot.current.x;
        let rotationY = debugRot.current.y;
        let rotationZ = debugRot.current.z;

        if (isDigging.current) {
            digProgress.current += delta * digSpeed;
            if (digProgress.current < Math.PI) {
                const swing = Math.sin(digProgress.current);
                rotationX += -swing * 1.2;
                rotationZ += -swing * 0.35;
                positionY -= swing * 0.2;
                positionZ -= swing * 0.5;
            } else {
                isDigging.current = false;
                digProgress.current = 0;
            }
        } else {
            rotationZ += Math.sin(time * 2) * 0.02;
        }

        impactKick.current = THREE.MathUtils.lerp(impactKick.current, impactKickTarget.current, 1 - Math.pow(0.10, delta * 60));
        impactKickTarget.current = THREE.MathUtils.lerp(impactKickTarget.current, 0.0, 1 - Math.pow(0.02, delta * 60));
        positionZ += impactKick.current * 0.06;
        rotationX += impactKick.current * 0.10;

        const leftHandShown = selectedItem === 'torch';
        torchProgress.current = THREE.MathUtils.lerp(torchProgress.current, leftHandShown ? 1 : 0, (leftHandShown ? 2.2 : 2.8) * delta);
        if (torchRef.current) {
            const ease = torchProgress.current * torchProgress.current * (3 - 2 * torchProgress.current);
            if (debugMode) {
                torchTargetPos.current.set(torchPoseDebug.posX * responsiveX, torchPoseDebug.posY, torchPoseDebug.posZ);
                torchHiddenPos.current.set(torchPoseDebug.posX * responsiveX, torchPoseDebug.posY + torchPoseDebug.hiddenYOffset, torchPoseDebug.posZ);
            } else {
                torchTargetPos.current.set(TORCH_POSE.x * responsiveX, TORCH_POSE.y, TORCH_POSE.z);
                torchHiddenPos.current.set(TORCH_POSE.x * responsiveX, TORCH_POSE.y + (TORCH_POSE.hiddenYOffset ?? -0.8), TORCH_POSE.z);
            }
            torchPosTemp.current.copy(torchHiddenPos.current).lerp(torchTargetPos.current, ease);
            torchRef.current.position.copy(torchPosTemp.current);
            torchRef.current.rotation.set(
                (debugMode ? THREE.MathUtils.degToRad(torchPoseDebug.rotXDeg) : torchRotDefault.current.x) + Math.sin(time * 1.4) * 0.012,
                (debugMode ? THREE.MathUtils.degToRad(torchPoseDebug.rotYDeg) : torchRotDefault.current.y) + Math.cos(time * 1.1) * 0.012,
                (debugMode ? THREE.MathUtils.degToRad(torchPoseDebug.rotZDeg) : torchRotDefault.current.z)
            );
            torchRef.current.scale.setScalar(debugMode ? torchPoseDebug.scale : torchScaleDefault.current);
            torchRef.current.visible = ease > 0.01;
        }

        const rightHandShown = (!!selectedItem || !!activeCustomTool) && selectedItem !== ItemType.TORCH;
        rightItemProgress.current = THREE.MathUtils.lerp(rightItemProgress.current, rightHandShown ? 1 : 0, (rightHandShown ? 2.4 : 3.0) * delta);
        if (rightItemRef.current) {
            const rease = rightItemProgress.current * rightItemProgress.current * (3 - 2 * rightItemProgress.current);
            const pose = (selectedItem || activeCustomTool)
                ? (debugMode && (selectedItem === 'stick' || selectedItem === 'stone')
                    ? (selectedItem === 'stick'
                        ? {
                            xOffset: rightHandStickPoseDebug.xOffset,
                            y: rightHandStickPoseDebug.y,
                            z: rightHandStickPoseDebug.z,
                            scale: rightHandStickPoseDebug.scale,
                            rot: {
                                x: THREE.MathUtils.degToRad(rightHandStickPoseDebug.rotXDeg),
                                y: THREE.MathUtils.degToRad(rightHandStickPoseDebug.rotYDeg),
                                z: THREE.MathUtils.degToRad(rightHandStickPoseDebug.rotZDeg)
                            }
                        }
                        : {
                            xOffset: rightHandStonePoseDebug.xOffset,
                            y: rightHandStonePoseDebug.y,
                            z: rightHandStonePoseDebug.z,
                            scale: rightHandStonePoseDebug.scale,
                            rot: {
                                x: THREE.MathUtils.degToRad(rightHandStonePoseDebug.rotXDeg),
                                y: THREE.MathUtils.degToRad(rightHandStonePoseDebug.rotYDeg),
                                z: THREE.MathUtils.degToRad(rightHandStonePoseDebug.rotZDeg)
                            }
                        })
                    : (activeCustomTool ? RIGHT_HAND_HELD_ITEM_POSES.pickaxe : RIGHT_HAND_HELD_ITEM_POSES[selectedItem as ItemType]))
                : null;
            if (pose && rightHandShown) {
                const animOffsetY = positionY - (debugPos.current.y + swayY);
                const animOffsetZ = positionZ - debugPos.current.z;
                const x = (positionX + (pose.xOffset ?? 0) * responsiveX);
                rightItemTargetPos.current.set(x, pose.y + animOffsetY, pose.z + animOffsetZ);
                rightItemHiddenPos.current.set(x, pose.y - 0.80, pose.z);
                rightItemPosTemp.current.copy(rightItemHiddenPos.current).lerp(rightItemTargetPos.current, rease);
                rightItemRef.current.position.copy(rightItemPosTemp.current);
                const rot = pose.rot;
                rightItemRef.current.rotation.set(
                    rotationX + (rot?.x ?? 0) + Math.sin(time * 1.4) * 0.012,
                    rotationY + (rot?.y ?? 0) + Math.cos(time * 1.1) * 0.012,
                    rotationZ + (rot?.z ?? 0)
                );
                rightItemRef.current.scale.setScalar(pose.scale);
                rightItemRef.current.visible = rease > 0.01;
            } else {
                rightItemRef.current.visible = false;
            }
        }

        // Update Glow Boost decay
        if (glowBoost.current > 0) {
            const elapsed = Date.now() - luminaGlowStartTime.current;
            if (elapsed > luminaGlowDuration.current) {
                glowBoost.current = 0;
            } else {
                // Smooth decay
                const t = elapsed / luminaGlowDuration.current;
                glowBoost.current = 5.0 * (1.0 - t * t); // slightly faster falloff
            }
        }

        // Update Lumina Light
        if (luminaLightRef.current) {
            const isLumina = capabilities.isLuminaTool;
            const count = capabilities.luminaCount ?? 0;
            const intensity = isLumina ? (count * 1.5 + glowBoost.current) : 0;

            if (intensity > 0) {
                luminaLightRef.current.visible = true;
                luminaLightRef.current.intensity = intensity;
                luminaLightRef.current.distance = 8 + intensity * 2;
            } else {
                luminaLightRef.current.visible = false;
            }
        }
    });


    return (
        <group ref={groupRef}>
            <pointLight position={[0.5, 0.5, 0.5]} intensity={1.0} distance={2} decay={2} />
            <pointLight
                ref={luminaLightRef}
                position={[0.5, 0.2, -0.5]}
                intensity={0}
                color="#00FFFF"
                distance={8}
                decay={2}
                visible={false}
            />
            <group ref={torchRef}>
                <group visible={selectedItem === 'torch'}>
                    <TorchTool />
                </group>
            </group>
            <group ref={rightItemRef}>
                <UniversalTool item={activeCustomTool || selectedItem} />
            </group>
        </group>
    );
};

function usePickaxeDebug() {
    const debugPos = useRef({ x: PICKAXE_POSE.x, y: PICKAXE_POSE.y, z: PICKAXE_POSE.z });
    const debugRot = useRef({ x: PICKAXE_POSE.rot.x, y: PICKAXE_POSE.rot.y, z: PICKAXE_POSE.rot.z });
    const keysPressed = useRef<Set<string>>(new Set());
    const DEBUG_ENABLED = false;

    useEffect(() => {
        if (!DEBUG_ENABLED) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (['x', 'y', 'z', 't'].includes(key)) keysPressed.current.add(key);
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (['x', 'y', 'z', 't'].includes(key)) keysPressed.current.delete(key);
        };
        const handleMouseMove = (e: MouseEvent) => {
            if (keysPressed.current.size === 0) return;
            const sensitivity = 0.005;
            const rotSensitivity = 0.01;
            if (keysPressed.current.has('t')) {
                debugPos.current.x += e.movementX * sensitivity;
                debugPos.current.y -= e.movementY * sensitivity;
            }
            if (keysPressed.current.has('x')) debugRot.current.x += e.movementY * rotSensitivity;
            if (keysPressed.current.has('y')) debugRot.current.y += e.movementX * rotSensitivity;
            if (keysPressed.current.has('z')) debugRot.current.z += e.movementX * rotSensitivity;
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    return { debugPos, debugRot };
}
