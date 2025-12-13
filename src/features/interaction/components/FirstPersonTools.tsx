
import React, { useRef, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useControls } from 'leva';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
import { TorchTool } from './TorchTool';
// Import the GLB URL explicitly
import pickaxeUrl from '@/assets/models/pickaxe_clean.glb?url';

// Preload the model
useGLTF.preload(pickaxeUrl);

export const FirstPersonTools: React.FC = () => {
    const { camera, scene } = useThree(); // Needed for parenting
    const groupRef = useRef<THREE.Group>(null);
    const axeRef = useRef<THREE.Group>(null);
    const torchRef = useRef<THREE.Group>(null);
    const hasAxe = useInventoryStore(state => state.hasAxe);
    const currentTool = useInventoryStore(state => state.currentTool);

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

    // Debug controls ENABLED
    const { debugPos, debugRot } = usePickaxeDebug();

    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            // Only swing when pointer is locked (gameplay) and when using the pickaxe tool.
            if (!document.pointerLockElement) return;
            if (e.button === 0 && currentTool === 'pickaxe' && !isDigging.current) {
                isDigging.current = true;
                digProgress.current = 0;
            }
        };

        window.addEventListener('mousedown', handleMouseDown);
        return () => {
            window.removeEventListener('mousedown', handleMouseDown);
        };
    }, [currentTool, hasAxe]);

    // Sync tool motion to actual terrain impacts (hit/clunk/build).
    // This makes the pickaxe feel connected to the world, even if interaction rate changes.
    useEffect(() => {
        const handleImpact = (e: Event) => {
            const ce = e as CustomEvent;
            const detail = (ce.detail ?? {}) as { action?: string; ok?: boolean };
            if (!document.pointerLockElement) return;
            // Only animate the pickaxe on DIG; keep BUILD subtle to avoid spam.
            if (detail.action === 'DIG' && currentTool === 'pickaxe') {
                isDigging.current = true;
                digProgress.current = 0;
                // Kick stronger on failures (e.g. bedrock/clunk) to make it readable.
                impactKickTarget.current = detail.ok === false ? 1.0 : 0.65;
            } else if (detail.action === 'BUILD' && currentTool === 'pickaxe') {
                impactKickTarget.current = 0.25;
            }
        };
        window.addEventListener('tool-impact', handleImpact as EventListener);
        return () => window.removeEventListener('tool-impact', handleImpact as EventListener);
    }, [currentTool]);

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
        if (!axeRef.current) return;

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

        // Apply transforms to the inner Axe group (local offsets)
        axeRef.current.position.set(positionX, positionY, positionZ);
        axeRef.current.rotation.set(
            rotationX,
            rotationY,
            rotationZ
        );

        // Torch Logic: Driven by Inventory Selection
        const isTorchSelected = inventorySlots[selectedSlotIndex] === 'torch';

        const targetShown = isTorchSelected;
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

        // Keep torch on left, match pickaxe height/angle, and slide from below camera.
        if (torchRef.current) {
            // Re-declare ‘now’ for animation usage using state.clock
            const now = state.clock.getElapsedTime();

            // Update target/hidden pose from debug sliders if enabled.
            if (debugMode) {
                torchTargetPos.current.set(torchPoseDebug.posX, torchPoseDebug.posY, torchPoseDebug.posZ);
                torchHiddenPos.current.set(torchPoseDebug.posX, torchPoseDebug.posY + torchPoseDebug.hiddenYOffset, torchPoseDebug.posZ);
            }

            // Target pose (mirrors pickaxe feel but left side).
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

    // if (!hasAxe) return null; // DEBUG: Force visible

    // Compute offset to center the model if needed (based on logs, but we'll try a visual offset adjustment wrapper)

    return (
        <group ref={groupRef}>
            {/* Ambient light for the tool itself to ensure it's never pitch black */}
            <pointLight position={[0.5, 0.5, 0.5]} intensity={1.0} distance={2} decay={2} />

            {/* Left-hand torch for caves. Positioned/rotated in useFrame above. */}
            <group ref={torchRef}>
                <TorchTool />
            </group>

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
