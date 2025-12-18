import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER } from '@core/graphics/GroundItemShaders';
import { getItemColor } from '../logic/ItemRegistry';
import { ItemType } from '@/types';

/**
 * StickTool
 * Lightweight held stick item (first-person).
 */
export const StickTool: React.FC = () => {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[0.045, 0.04, 0.95, 8, 8]} />
        <CustomShaderMaterial
          baseMaterial={THREE.MeshStandardMaterial}
          vertexShader={STICK_SHADER.vertex}
          uniforms={{ uSeed: { value: 123.45 }, uHeight: { value: 0.95 } }}
          color={getItemColor(ItemType.STICK)}
          roughness={0.92}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};

