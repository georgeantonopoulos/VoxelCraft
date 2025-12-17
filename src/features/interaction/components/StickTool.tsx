import * as THREE from 'three';
import CustomShaderMaterial from 'three-custom-shader-material';
import { STICK_SHADER } from '@core/graphics/GroundItemShaders';

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
          color="#8b5a2b"
          roughness={0.92}
          metalness={0.0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
};

