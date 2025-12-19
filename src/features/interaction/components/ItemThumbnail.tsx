import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, Center } from '@react-three/drei';
import { UniversalTool } from './UniversalTool';
import { ItemType } from '@/types';
import { useInventoryStore } from '@/state/InventoryStore';

interface ItemThumbnailProps {
    item: ItemType | string;
    size?: string;
}

export const ItemThumbnail: React.FC<ItemThumbnailProps> = ({ item, size = "100%" }) => {
    const customTools = useInventoryStore(state => state.customTools);

    // Resolve custom tool if item is an ID
    const toolData = (typeof item === 'string' && item.startsWith('tool_'))
        ? customTools[item]
        : item;

    if (!toolData) return null;

    return (
        <div style={{ width: size, height: size }} className="pointer-events-none">
            <Canvas
                shadows={false}
                camera={{ position: [0, 0, 1.5], fov: 35 }}
                gl={{ antialias: true, alpha: true }}
                dpr={[1, 2]}
            >
                <ambientLight intensity={0.7} />
                <pointLight position={[5, 5, 5]} intensity={1.5} />
                <Suspense fallback={null}>
                    <Center>
                        <group rotation={[Math.PI / 8, -Math.PI / 4, 0]}>
                            <UniversalTool item={toolData} isThumbnail />
                        </group>
                    </Center>
                    <Environment preset="studio" />
                </Suspense>
            </Canvas>
        </div>
    );
};
