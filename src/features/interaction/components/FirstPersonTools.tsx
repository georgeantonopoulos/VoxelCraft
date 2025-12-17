
import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useControls, button } from 'leva';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { TorchTool } from './TorchTool';
import { FloraTool } from './FloraTool';
import { StickTool } from './StickTool';
import { StoneTool } from './StoneTool';
import { ShardTool } from './ShardTool';
import { RIGHT_HAND_HELD_ITEM_POSES } from '@features/interaction/logic/HeldItemPoses';
// Import the GLB URL explicitly
import pickaxeUrl from '@/assets/models/pickaxe_clean.glb?url';

// Preload the model
useGLTF.preload(pickaxeUrl);

export const FirstPersonTools: React.FC = () => {
    const { camera, scene } = useThree(); // Needed for parenting
    const groupRef = useRef<THREE.Group>(null);
    const axeRef = useRef<THREE.Group>(null);
    const torchRef = useRef<THREE.Group>(null); // left hand (torch)
    const rightItemRef = useRef<THREE.Group>(null); // right hand (stick/stone)
    const hasPickaxe = useInventoryStore(state => state.hasPickaxe);

    // Inventory State
    const inventorySlots = useInventoryStore(state => state.inventorySlots);
    const selectedSlotIndex = useInventoryStore(state => state.selectedSlotIndex);

    // Debug UI for torch pose. Enabled with ?debug (same as Leva panel in App).
    const debugMode = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        return params.has('debug');
    }, []);

    const torchPoseDebug = useControls(
        'Torch Pose',
        {
            // Defaults based on latest tuning screenshot.
            posX: { value: -0.5, min: -1.5, max: 0.0, step: 0.01 },
            posY: { value: -0.3, min: -1.0, max: 0.5, step: 0.01 },
            posZ: { value: -0.4, min: -2.0, max: -0.2, step: 0.01 },
            // Rotations in degrees for easier tuning.
            rotXDeg: { value: 14, min: -180, max: 180, step: 1 },
            rotYDeg: { value: -175, min: -180, max: 180, step: 1 },
            rotZDeg: { value: 28, min: -180, max: 180, step: 1 },
            scale: { value: 0.41, min: 0.2, max: 1.5, step: 0.01 },
            hiddenYOffset: { value: -0.8, min: -2.0, max: -0.2, step: 0.01 },
        },
        { hidden: !debugMode }
    );

    const [rightHandStickPoseDebug, setRightHandStickPoseDebug] = useControls(
        'Right Hand / Stick',
        () => ({
            xOffset: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.xOffset ?? 0, min: -1.0, max: 1.0, step: 0.01 },
            y: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.y, min: -1.2, max: 0.6, step: 0.01 },
            z: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.z, min: -2.0, max: -0.1, step: 0.01 },
            scale: { value: RIGHT_HAND_HELD_ITEM_POSES.stick.scale, min: 0.1, max: 2.0, step: 0.01 },
            rotXDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rotOffset?.x ?? 0), min: -180, max: 180, step: 1 },
            rotYDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rotOffset?.y ?? 0), min: -180, max: 180, step: 1 },
            rotZDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rotOffset?.z ?? 0), min: -180, max: 180, step: 1 },
            'Save To Code': button((get) => (async () => {
                try {
                    // Leva buttons run outside React's render lifecycle; read the latest values
                    // from the Leva store instead of relying on closures from initial mount.
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
                            kind: 'stick',
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
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
                    // Let HMR pick up the updated file; keep this explicit for clarity during tuning.
                    console.log('[Right Hand / Stick] Saved pose to code.');
                } catch (err) {
                    console.error('[Right Hand / Stick] Save failed:', err);
                    alert(`Failed to save stick pose to code: ${err instanceof Error ? err.message : String(err)}`);
                }
            })()),
        }),
        { hidden: !debugMode }
    );

    const [rightHandStonePoseDebug, setRightHandStonePoseDebug] = useControls(
        'Right Hand / Stone',
        () => ({
            xOffset: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.xOffset ?? 0, min: -1.0, max: 1.0, step: 0.01 },
            y: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.y, min: -1.2, max: 0.6, step: 0.01 },
            z: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.z, min: -2.0, max: -0.1, step: 0.01 },
            scale: { value: RIGHT_HAND_HELD_ITEM_POSES.stone.scale, min: 0.1, max: 2.0, step: 0.01 },
            rotXDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rotOffset?.x ?? 0), min: -180, max: 180, step: 1 },
            rotYDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rotOffset?.y ?? 0), min: -180, max: 180, step: 1 },
            rotZDeg: { value: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rotOffset?.z ?? 0), min: -180, max: 180, step: 1 },
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
                            kind: 'stone',
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
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || json?.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
                    console.log('[Right Hand / Stone] Saved pose to code.');
                } catch (err) {
                    console.error('[Right Hand / Stone] Save failed:', err);
                    alert(`Failed to save stone pose to code: ${err instanceof Error ? err.message : String(err)}`);
                }
            })()),
        }),
        { hidden: !debugMode }
    );

    // Leva keeps values around across HMR; in debug mode we want the sliders to start
    // from the current in-game pose constants (unless the user tweaks them afterwards).
    useEffect(() => {
        if (!debugMode) return;
        setRightHandStickPoseDebug({
            xOffset: RIGHT_HAND_HELD_ITEM_POSES.stick.xOffset ?? 0,
            y: RIGHT_HAND_HELD_ITEM_POSES.stick.y,
            z: RIGHT_HAND_HELD_ITEM_POSES.stick.z,
            scale: RIGHT_HAND_HELD_ITEM_POSES.stick.scale,
            rotXDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rotOffset?.x ?? 0),
            rotYDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rotOffset?.y ?? 0),
            rotZDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stick.rotOffset?.z ?? 0),
        });
        setRightHandStonePoseDebug({
            xOffset: RIGHT_HAND_HELD_ITEM_POSES.stone.xOffset ?? 0,
            y: RIGHT_HAND_HELD_ITEM_POSES.stone.y,
            z: RIGHT_HAND_HELD_ITEM_POSES.stone.z,
            scale: RIGHT_HAND_HELD_ITEM_POSES.stone.scale,
            rotXDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rotOffset?.x ?? 0),
            rotYDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rotOffset?.y ?? 0),
            rotZDeg: THREE.MathUtils.radToDeg(RIGHT_HAND_HELD_ITEM_POSES.stone.rotOffset?.z ?? 0),
        });
    }, [debugMode, setRightHandStickPoseDebug, setRightHandStonePoseDebug]);

    // Load the GLB model using the imported URL
    const { scene: modelScene } = useGLTF(pickaxeUrl);

    // Animation state
    const isDigging = useRef(false);
    const digProgress = useRef(0);
    const digSpeed = 10.0; // Slower, heavier feel
    // Impact kick (synced to actual terrain hits, not just mouse input).
    const impactKick = useRef(0);
    const impactKickTarget = useRef(0);

    // Torch slide animation state (0 hidden -> 1 fully shown)
    const torchProgress = useRef(0);
    // Non-debug defaults should match the tuned Torch Pose defaults.
    const torchTargetPos = useRef(new THREE.Vector3(-0.5, -0.3, -0.4));
    const torchHiddenPos = useRef(new THREE.Vector3(-0.5, -1.10, -0.4));
    const torchPosTemp = useRef(new THREE.Vector3());
    const torchRotDefault = useRef(
        new THREE.Euler(
            THREE.MathUtils.degToRad(14),
            THREE.MathUtils.degToRad(-175),
            THREE.MathUtils.degToRad(28)
        )
    );
    const torchScaleDefault = useRef(0.41);

    // Right-hand item slide animation state (0 hidden -> 1 fully shown)
    const rightItemProgress = useRef(0);
    const rightItemTargetPos = useRef(new THREE.Vector3(0.715, -0.30, -0.40));
    const rightItemHiddenPos = useRef(new THREE.Vector3(0.715, -1.10, -0.40));
    const rightItemPosTemp = useRef(new THREE.Vector3());

    // Debug controls ENABLED
    const { debugPos, debugRot } = usePickaxeDebug();

    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            // Only swing when pointer is locked (gameplay) and when using the pickaxe tool.
            if (!document.pointerLockElement) return;
            const state = useInventoryStore.getState();
            const selectedItem = state.inventorySlots[state.selectedSlotIndex];
            // Only animate when pickaxe is explicitly selected.
            if (selectedItem !== 'pickaxe' && selectedItem !== 'stick' && selectedItem !== 'stone' && selectedItem !== 'shard') return;
            if (e.button === 0 && !isDigging.current) {
                isDigging.current = true;
                digProgress.current = 0;
            }
        };

        window.addEventListener('mousedown', handleMouseDown);
        return () => {
            window.removeEventListener('mousedown', handleMouseDown);
        };
    }, []);

    // Sync tool motion to actual terrain impacts (hit/clunk/build).
    // This makes the pickaxe feel connected to the world, even if interaction rate changes.
    useEffect(() => {
        const handleImpact = (e: Event) => {
            const ce = e as CustomEvent;
            const detail = (ce.detail ?? {}) as { action?: string; ok?: boolean };
            if (!document.pointerLockElement) return;
            const state = useInventoryStore.getState();
            const selectedItem = state.inventorySlots[state.selectedSlotIndex];
            // Allow animation for pickaxe, stone, and stick
            if (selectedItem !== 'pickaxe' && selectedItem !== 'stick' && selectedItem !== 'stone' && selectedItem !== 'shard') return;
            // Only animate the pickaxe on DIG; keep BUILD subtle to avoid spam.
            if (detail.action === 'DIG') {
                isDigging.current = true;
                digProgress.current = 0;
                // Kick stronger on failures (e.g. bedrock/clunk) to make it readable.
                impactKickTarget.current = detail.ok === false ? 1.0 : 0.65;
            } else if (detail.action === 'BUILD') {
                impactKickTarget.current = 0.25;
            }
        };
        window.addEventListener('tool-impact', handleImpact as EventListener);
        return () => window.removeEventListener('tool-impact', handleImpact as EventListener);
    }, []);

    // Hard Camera Attachment - The only way to get ZERO jitter
    // We attach the group to the camera object so it moves 1:1 with the camera matrix.
    // To avoid clipping, we must position it far enough forward (Z negative).
    // CRITICAL: We must also add the camera to the scene, otherwise its children (the tool) won't render.
    useEffect(() => {
        if (groupRef.current && camera && scene) {
            scene.add(camera); // Ensure camera is part of the graph
            camera.add(groupRef.current);
            return () => {
                camera.remove(groupRef.current);
                scene.remove(camera);
            };
        }
    }, [camera, scene]);

    // Sync to camera every frame instead of parenting
    // This ensures it resides in the Main Scene and receives environment lighting/shadows correctly
    // while still following the camera.

    // Priority 1 ensures this runs AFTER the camera controller updates
    // This eliminates the jitter/lag between camera and tool
    useFrame((state, delta) => {
        if (!axeRef.current && !torchRef.current && !rightItemRef.current) return;

        // Calculate sway/animations relative to the camera-locked group

        const time = state.clock.getElapsedTime();

        // Base sway
        const swayX = Math.sin(time * 2) * 0.005;
        const swayY = Math.cos(time * 4) * 0.005;

        // Use debug values directly so user can fix rotation
        let positionX = debugPos.current.x + swayX;
        let positionY = debugPos.current.y + swayY;
        let positionZ = debugPos.current.z;

        let rotationX = debugRot.current.x;
        let rotationY = debugRot.current.y;
        let rotationZ = debugRot.current.z;

        // Dig Animation Logic
        if (isDigging.current) {
            digProgress.current += delta * digSpeed;

            // Animation phase: 0 -> PI (down), PI -> 2PI (reset)
            if (digProgress.current < Math.PI) {
                // Chop down
                const t = digProgress.current;
                const swing = Math.sin(t);

                // Enhance the arc: Combine rotation with significant forward thrust
                rotationX += -swing * 1.2;  // Stronger chop rotation
                rotationZ += -swing * 0.35; // Add roll for natural wrist movement

                // Translation Arc
                positionY -= swing * 0.2;   // Slight dip
                positionZ -= swing * 0.5;   // Push forward significantly for "reach"
            } else {
                // Reset
                isDigging.current = false;
                digProgress.current = 0;
            }
        } else {
            // Idle rotation
            rotationZ += Math.sin(time * 2) * 0.02;
        }

        // Impact kick is a small positional/rotational impulse on contact.
        // It’s intentionally separate from the swing animation so it works for both hits and clunks.
        impactKick.current = THREE.MathUtils.lerp(impactKick.current, impactKickTarget.current, 1 - Math.pow(0.10, delta * 60));
        impactKickTarget.current = THREE.MathUtils.lerp(impactKickTarget.current, 0.0, 1 - Math.pow(0.02, delta * 60));
        const kick = impactKick.current;
        positionZ += kick * 0.06;  // Tiny pull-back
        rotationX += kick * 0.10;  // Tiny upward recoil

        const selectedItem = inventorySlots[selectedSlotIndex];
        const rightHandOverride = selectedItem === 'stick' || selectedItem === 'stone' || selectedItem === 'shard' || selectedItem === 'flora';
        const leftHandShown = selectedItem === 'torch';

        // Apply transforms to the inner Axe group (local offsets)
        // Pickaxe only shows when explicitly selected.
        if (axeRef.current) {
            axeRef.current.visible = !rightHandOverride && selectedItem === 'pickaxe';
            axeRef.current.position.set(positionX, positionY, positionZ);
            axeRef.current.rotation.set(rotationX, rotationY, rotationZ);
        }

        // Left-hand held item logic: torch.
        const targetShown = leftHandShown;
        const speedIn = 2.2;  // ~0.45s in
        const speedOut = 2.8; // slightly faster out
        const targetProg = targetShown ? 1 : 0;
        torchProgress.current = THREE.MathUtils.lerp(
            torchProgress.current,
            targetProg,
            (targetShown ? speedIn : speedOut) * delta
        );
        const p = torchProgress.current;
        const ease = p * p * (3 - 2 * p); // smoothstep

        // Keep torch on left and slide from below camera.
        if (torchRef.current) {
            // Re-declare ‘now’ for animation usage using state.clock
            const now = state.clock.getElapsedTime();

            // Update target/hidden pose from debug sliders if enabled.
            if (debugMode) {
                torchTargetPos.current.set(torchPoseDebug.posX, torchPoseDebug.posY, torchPoseDebug.posZ);
                torchHiddenPos.current.set(torchPoseDebug.posX, torchPoseDebug.posY + torchPoseDebug.hiddenYOffset, torchPoseDebug.posZ);
            }

            // Target pose (left-hand comfort pose).
            torchPosTemp.current.copy(torchHiddenPos.current).lerp(torchTargetPos.current, ease);
            torchRef.current.position.copy(torchPosTemp.current);
            torchRef.current.rotation.set(
                (debugMode ? THREE.MathUtils.degToRad(torchPoseDebug.rotXDeg) : torchRotDefault.current.x) + Math.sin(now * 1.4) * 0.012,
                (debugMode ? THREE.MathUtils.degToRad(torchPoseDebug.rotYDeg) : torchRotDefault.current.y) + Math.cos(now * 1.1) * 0.012,
                (debugMode ? THREE.MathUtils.degToRad(torchPoseDebug.rotZDeg) : torchRotDefault.current.z)
            );
            // Slight bob only when visible.
            if (ease > 0.01) {
                torchRef.current.position.y += Math.sin(now * 2.0) * 0.01;
            }
            torchRef.current.scale.setScalar(debugMode ? torchPoseDebug.scale : torchScaleDefault.current);
            torchRef.current.visible = ease > 0.01;
        }

        // Right-hand item logic: stick/stone/shard/flora replaces pickaxe.
        const rightShown = rightHandOverride;
        const rTargetProg = rightShown ? 1 : 0;
        rightItemProgress.current = THREE.MathUtils.lerp(
            rightItemProgress.current,
            rTargetProg,
            (rightShown ? 2.4 : 3.0) * delta
        );
        const rp = rightItemProgress.current;
        const rease = rp * rp * (3 - 2 * rp);

        if (rightItemRef.current) {
            const now = state.clock.getElapsedTime();
            const isRightHandItem = selectedItem === 'stick' || selectedItem === 'stone' || selectedItem === 'shard' || selectedItem === 'flora';
            const pose = isRightHandItem
                ? (debugMode && (selectedItem === 'stick' || selectedItem === 'stone')
                    ? (selectedItem === 'stick'
                        ? {
                            xOffset: rightHandStickPoseDebug.xOffset,
                            y: rightHandStickPoseDebug.y,
                            z: rightHandStickPoseDebug.z,
                            scale: rightHandStickPoseDebug.scale,
                            rotOffset: {
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
                            rotOffset: {
                                x: THREE.MathUtils.degToRad(rightHandStonePoseDebug.rotXDeg),
                                y: THREE.MathUtils.degToRad(rightHandStonePoseDebug.rotYDeg),
                                z: THREE.MathUtils.degToRad(rightHandStonePoseDebug.rotZDeg)
                            }
                        })
                    : RIGHT_HAND_HELD_ITEM_POSES[selectedItem])
                : null;
            if (pose) {
                // Apply animation offsets (delta from base/debug pos)
                const animOffsetY = positionY - (debugPos.current.y + swayY);
                const animOffsetZ = positionZ - debugPos.current.z;

                const x = positionX + (pose.xOffset ?? 0);
                // Combine pose position with animation offset
                rightItemTargetPos.current.set(x, pose.y + animOffsetY, pose.z + animOffsetZ);
                rightItemHiddenPos.current.set(x, pose.y - 0.80, pose.z);
                rightItemPosTemp.current.copy(rightItemHiddenPos.current).lerp(rightItemTargetPos.current, rease);
                rightItemRef.current.position.copy(rightItemPosTemp.current);

                const rot = pose.rotOffset;
                rightItemRef.current.rotation.set(
                    rotationX + (rot?.x ?? 0) + Math.sin(now * 1.4) * 0.012,
                    rotationY + (rot?.y ?? 0) + Math.cos(now * 1.1) * 0.012,
                    rotationZ + (rot?.z ?? 0)
                );
                rightItemRef.current.scale.setScalar(pose.scale);
                rightItemRef.current.visible = rease > 0.01;
            } else {
                rightItemRef.current.visible = false;
            }
        }
    });

    // Ensure model catches light and shadows
    useEffect(() => {
        if (modelScene) {
            const box = new THREE.Box3().setFromObject(modelScene);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);

            console.log('[FirstPersonTools] Model Bounds:', {
                size: [size.x, size.y, size.z],
                center: [center.x, center.y, center.z]
            });

            // Center the model contents
            // We can't move 'scene' if it's a primitive root sometimes, but we can move children 
            // OR just apply an inverse position to the primitive Group if we wrap it.
            // Easiest is to move the primitive's position to -center
            // But we can't easily ref that from here without state.
            // Let's traverse and shift geometry? No, destructive.

            // Better: Just log for now, and rely on the Debug Box to know where "0,0,0" is.
            // If the center is wild like [0, 50, 0], we know the issue.

            modelScene.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    const m = child as THREE.Mesh;
                    m.castShadow = true;
                    m.receiveShadow = true;
                    m.frustumCulled = false; // Important: Prevents culling when close to camera
                }
            });
        }
    }, [modelScene]);

    // if (!hasPickaxe) return null; // DEBUG: Force visible

    // Compute offset to center the model if needed (based on logs, but we'll try a visual offset adjustment wrapper)

    return (
        <group ref={groupRef}>
            {/* Ambient light for the tool itself to ensure it's never pitch black */}
            <pointLight position={[0.5, 0.5, 0.5]} intensity={1.0} distance={2} decay={2} />

            {/* Left-hand torch. Positioned/rotated in useFrame above. */}
            <group ref={torchRef}>
                {/* Swap held left-hand item based on inventory selection (same pose/animation). */}
                <group visible={inventorySlots[selectedSlotIndex] === 'torch'}>
                    <TorchTool />
                </group>
            </group>

            {/* Right-hand stick/stone (replaces pickaxe). Positioned/rotated in useFrame above. */}
            <group ref={rightItemRef}>
                <group visible={inventorySlots[selectedSlotIndex] === 'stick'}>
                    <StickTool />
                </group>
                <group visible={inventorySlots[selectedSlotIndex] === 'stone'}>
                    <StoneTool />
                </group>
                <group visible={inventorySlots[selectedSlotIndex] === 'flora'}>
                    <FloraTool />
                </group>
                <group visible={inventorySlots[selectedSlotIndex] === 'shard'}>
                    <ShardTool />
                </group>
            </group>

            {hasPickaxe && (
                <group ref={axeRef}>
                    <group>
                        {/* Move model down/center if it was high up? We will check logs. 
	                             For now, just render it as is, we have the Red Box as reference. */}
                        <primitive
                            object={modelScene}
                            scale={0.5}
                        // Removed HUD hacks to ensure proper lighting integration
                        // If clipping occurs, we can tune the Z-position or near plane, 
                        // but keeping it in the scene graph is best for lighting.
                        // renderOrder={999} 
                        // material-depthTest={false} 
                        />
                    </group>
                </group>
            )}
        </group>
    );
};

// --- Debug Helper ---
function usePickaxeDebug() {
    // Initial values set to what the user last reported, but they can now adjust them
    // UPDATED: Defaults for Upright + Forward (to avoid clipping)
    // FINAL VALUES: Pos: [0.715, -0.220, -0.800] | Rot: [1.150, -3.062, -1.450]
    const debugPos = useRef({ x: 0.715, y: -0.220, z: -0.800 });
    const debugRot = useRef({ x: 1.150, y: -3.062, z: -1.450 });
    const keysPressed = useRef<Set<string>>(new Set());

    // Set to true to re-enable interactive positioning
    const DEBUG_ENABLED = false;

    useEffect(() => {
        if (!DEBUG_ENABLED) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (['x', 'y', 'z', 't'].includes(key)) {
                keysPressed.current.add(key);
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();
            if (['x', 'y', 'z', 't'].includes(key)) {
                keysPressed.current.delete(key);
            }
        };

        const handleMouseMove = (e: MouseEvent) => {
            if (keysPressed.current.size === 0) return;

            const sensitivity = 0.005;
            const rotSensitivity = 0.01;
            let changed = false;

            if (keysPressed.current.has('t')) {
                debugPos.current.x += e.movementX * sensitivity;
                debugPos.current.y -= e.movementY * sensitivity;
                changed = true;
            }
            if (keysPressed.current.has('x')) {
                debugRot.current.x += e.movementY * rotSensitivity; // Y movement for X rotation (pitch)
                changed = true;
            }
            if (keysPressed.current.has('y')) {
                debugRot.current.y += e.movementX * rotSensitivity; // X movement for Y rotation (yaw)
                changed = true;
            }
            if (keysPressed.current.has('z')) {
                debugRot.current.z += e.movementX * rotSensitivity; // X movement for Z rotation (roll)
                changed = true;
            }

            if (changed) {
                console.log(`[Pickaxe Debug]Pos: [${debugPos.current.x.toFixed(3)}, ${debugPos.current.y.toFixed(3)}, ${debugPos.current.z.toFixed(3)}] | Rot: [${debugRot.current.x.toFixed(3)}, ${debugRot.current.y.toFixed(3)}, ${debugRot.current.z.toFixed(3)}]`);
            }
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
