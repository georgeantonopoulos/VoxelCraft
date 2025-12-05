
import React, { useRef, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useInventoryStore } from '@state/InventoryStore';
// Import the GLB URL explicitly
import pickaxeUrl from '@/assets/models/pickaxe_clean.glb?url';

// Preload the model
useGLTF.preload(pickaxeUrl);

export const FirstPersonTools: React.FC = () => {
    const { camera, scene } = useThree(); // Needed for parenting
    const groupRef = useRef<THREE.Group>(null);
    const axeRef = useRef<THREE.Group>(null);
    const hasAxe = useInventoryStore(state => state.hasAxe);

    // Load the GLB model using the imported URL
    const { scene: modelScene } = useGLTF(pickaxeUrl);

    // Animation state
    const isDigging = useRef(false);
    const digProgress = useRef(0);
    const digSpeed = 15.0; // Speed of the chop

    // Debug controls ENABLED
    const { debugPos, debugRot } = usePickaxeDebug(axeRef);

    useEffect(() => {
        const handleMouseDown = (e: MouseEvent) => {
            if (e.button === 0 && hasAxe && !isDigging.current) {
                isDigging.current = true;
                digProgress.current = 0;
            }
        };
        window.addEventListener('mousedown', handleMouseDown);
        return () => window.removeEventListener('mousedown', handleMouseDown);
    }, [hasAxe]);

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
                rotationX += -Math.sin(t) * 0.8; // Reduced intensity
                rotationZ += -Math.sin(t) * 0.5;
                positionY -= Math.sin(t) * 0.1;
                positionZ -= Math.sin(t) * 0.3; // Push forward while chopping
            } else {
                // Reset
                isDigging.current = false;
                digProgress.current = 0;
            }
        } else {
            // Idle rotation
            rotationZ += Math.sin(time * 2) * 0.02;
        }

        // Apply transforms to the inner Axe group (local offsets)
        axeRef.current.position.set(positionX, positionY, positionZ);
        axeRef.current.rotation.set(
            rotationX,
            rotationY,
            rotationZ
        );
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
function usePickaxeDebug(axeRef: React.RefObject<THREE.Group>) {
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

