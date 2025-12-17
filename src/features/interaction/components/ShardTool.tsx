import React from 'react';

export const ShardTool: React.FC = () => {
    return (
        <group>
            {/* Small Tetrahedron */}
            <mesh castShadow receiveShadow position={[0, 0, 0]} rotation={[0.5, 0.5, 0]}>
                <tetrahedronGeometry args={[0.08, 0]} />
                <meshStandardMaterial color="#aaaaaa" roughness={0.5} />
            </mesh>
        </group>
    );
};
