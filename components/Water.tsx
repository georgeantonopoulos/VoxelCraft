
import * as THREE from 'three';
import React, { useRef } from 'react';
import { extend, useFrame, useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { WATER_LEVEL } from '../constants';
import { noiseTexture } from '../utils/sharedResources';

const WaterShaderMaterial = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    uColorShallow: new THREE.Color('#4fa1d6'),
    uColorDeep: new THREE.Color('#1d4f70'),
    uNoiseTexture: noiseTexture,
    uCamPos: new THREE.Vector3()
  },
  // Vertex
  `
    precision highp float;

    uniform float uTime;

    out vec3 vWorldPos;
    out vec2 vUv;
    out float vWaveHeight;

    void main() {
      vUv = uv;
      vec3 pos = position;

      // Plane is defined in XY, rotated to XZ.
      // So pos.z is the normal direction (World Y).

      float wave1 = sin(pos.x * 0.05 + uTime * 0.8) * 0.3;
      float wave2 = cos(pos.y * 0.04 + uTime * 0.6) * 0.3; // pos.y corresponds to World Z
      float wave3 = sin((pos.x + pos.y) * 0.02 + uTime * 0.4) * 0.4;

      float totalWave = wave1 + wave2 + wave3;
      pos.z += totalWave; // Displace up

      vWaveHeight = totalWave;

      vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `,
  // Fragment
  `
    precision highp float;
    precision highp sampler3D;

    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uColorShallow;
    uniform vec3 uColorDeep;
    uniform sampler3D uNoiseTexture;
    uniform vec3 uCamPos;

    in vec3 vWorldPos;
    in vec2 vUv;
    in float vWaveHeight;

    out vec4 fragColor;

    vec3 getNormal(vec3 pos, float time) {
        // Sample noise for ripples
        // Scale needs to be fine for ripples
        float scale = 0.08;
        float speed = 0.5;

        // Scroll noise
        vec3 p1 = pos * scale + vec3(time * speed * 0.1, time * speed * 0.05, 0.0);
        vec3 p2 = pos * scale - vec3(time * speed * 0.08, 0.0, time * speed * 0.06);

        // Sample from 3D noise (using 3rd dimension as animation/variation too)
        float n1 = texture(uNoiseTexture, p1 * 0.2).r;
        float n2 = texture(uNoiseTexture, p2 * 0.2).g;

        float val = n1 + n2;

        // Perturb normal
        // Base normal is (0,1,0) in World Space
        vec3 n = vec3(0.0, 1.0, 0.0);
        n.x += (n1 - 0.5) * 0.5;
        n.z += (n2 - 0.5) * 0.5;

        return normalize(n);
    }

    void main() {
        vec3 viewDir = normalize(uCamPos - vWorldPos);
        vec3 normal = getNormal(vWorldPos, uTime);

        // Sun reflection (Specular)
        // Light coming from SunDir
        vec3 lightDir = normalize(uSunDir);
        vec3 halfVec = normalize(lightDir + viewDir);
        float NdotH = max(dot(normal, halfVec), 0.0);
        float specular = pow(NdotH, 200.0) * 1.5; // Sharp, bright sun

        // Fresnel
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);

        vec3 albedo = mix(uColorDeep, uColorShallow, fresnel * 0.6 + 0.2);

        // Brighten peaks
        albedo += vec3(vWaveHeight * 0.1);

        vec3 finalColor = albedo + vec3(specular);

        // SAFETY: Clamp to avoid NaN/Infinity
        finalColor = clamp(finalColor, 0.0, 10.0);

        // Opacity
        float alpha = 0.9 + fresnel * 0.1;

        fragColor = vec4(finalColor, alpha);
        // Tone mapping
        fragColor.rgb = pow(fragColor.rgb, vec3(1.0 / 2.2));
    }
  `
);

extend({ WaterShaderMaterial });

export const Water: React.FC = () => {
  const ref = useRef<any>(null);
  const { camera } = useThree();

  useFrame(({ clock }) => {
    if (ref.current) {
        ref.current.uTime = clock.getElapsedTime();
        ref.current.uCamPos = camera.position;
        // Sun direction matching App.tsx
        ref.current.uSunDir = new THREE.Vector3(50, 80, 30).normalize();

        // Ensure texture is set
        if (ref.current.uNoiseTexture !== noiseTexture) {
            ref.current.uNoiseTexture = noiseTexture;
        }
    }
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow>
      <planeGeometry args={[1000, 1000, 128, 128]} />
      {/* @ts-ignore */}
      <waterShaderMaterial
          ref={ref}
          transparent
          side={THREE.DoubleSide}
          glslVersion={THREE.GLSL3}
      />
    </mesh>
  );
};
