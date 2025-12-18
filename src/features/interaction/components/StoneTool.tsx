import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { ROCK_SHADER } from '@core/graphics/GroundItemShaders';
import { noiseTexture } from '@core/memory/sharedResources';
import { getItemColor } from '../logic/ItemRegistry';
import { ItemType } from '@/types';

/**
 * StoneTool
 * Lightweight held stone item (first-person).
 */
export const StoneTool: React.FC = () => {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <dodecahedronGeometry args={[0.22, 1]} />
        <CustomShaderMaterial
          baseMaterial={THREE.MeshStandardMaterial}
          vertexShader={ROCK_SHADER.vertex}
          uniforms={{
            uInstancing: { value: false },
            uNoiseTexture: { value: noiseTexture },
            uSeed: { value: 67.89 }
          }}
          color={getItemColor(ItemType.STONE)}
          roughness={0.92}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};
