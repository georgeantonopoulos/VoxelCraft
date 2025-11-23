
import * as THREE from 'three';
import React, { useRef } from 'react';
import { extend, useFrame, useThree } from '@react-three/fiber';
import { shaderMaterial } from '@react-three/drei';
import { noiseTexture } from '../utils/sharedResources';

const WaterMeshShader = shaderMaterial(
  {
    uTime: 0,
    uSunDir: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
    uColorShallow: new THREE.Color('#6ec2f7'),
    uColorDeep: new THREE.Color('#2d688f'),
    uNoiseTexture: noiseTexture,
    uCamPos: new THREE.Vector3(),
    uFogColor: new THREE.Color('#87CEEB'),
    uFogNear: 30,
    uFogFar: 300,
    uFade: 1
  },
  // Vertex
  `
    precision highp float;

    uniform float uTime;
    out vec3 vWorldPos;
    out vec3 vNormal;
    out vec3 vViewPos;

    void main() {
      vNormal = normalize(normalMatrix * normal);
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;

      vec4 mvPosition = viewMatrix * worldPos;
      vViewPos = -mvPosition.xyz;

      gl_Position = projectionMatrix * mvPosition;
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
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uFade;

    in vec3 vWorldPos;
    in vec3 vNormal;
    in vec3 vViewPos;

    out vec4 fragColor;

    vec3 getNormal(vec3 pos, vec3 baseNormal, float time) {
        float scale = 0.1;
        float speed = 0.5;

        vec3 p1 = pos * scale + vec3(time * speed * 0.1, time * speed * 0.05, time * 0.02);
        vec3 p2 = pos * scale - vec3(time * speed * 0.08, 0.0, time * speed * 0.06);

        float n1 = texture(uNoiseTexture, p1 * 0.2).r;
        float n2 = texture(uNoiseTexture, p2 * 0.2).g;

        // Perturb
        vec3 n = normalize(baseNormal + vec3(n1-0.5, n2-0.5, (n1+n2)*0.1) * 0.5);
        return n;
    }

    void main() {
        vec3 viewDir = normalize(uCamPos - vWorldPos);
        vec3 normal = getNormal(vWorldPos, vNormal, uTime);

        // Specular
        vec3 lightDir = normalize(uSunDir);
        vec3 halfVec = normalize(lightDir + viewDir);
        float NdotH = max(dot(normal, halfVec), 0.0);
        float specular = pow(NdotH, 100.0) * 1.0;

        // Fresnel
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);

        vec3 albedo = mix(uColorDeep, uColorShallow, fresnel * 0.5 + 0.3);

        vec3 shaded = albedo + vec3(specular);
        shaded = mix(uFogColor, shaded, uFade);

        float distanceToCam = distance(uCamPos, vWorldPos);
        float fogFactor = clamp((distanceToCam - uFogNear) / max(uFogFar - uFogNear, 0.0001), 0.0, 1.0);
        fogFactor = pow(fogFactor, 1.25);

        vec3 finalColor = mix(shaded, uFogColor, fogFactor * 0.6);
        float alpha = (0.75 + fresnel * 0.2) * uFade;

        fragColor = vec4(finalColor, alpha);
        fragColor.rgb = pow(fragColor.rgb, vec3(1.0 / 2.2));
    }
  `
);

extend({ WaterMeshShader });

export const WaterMaterial: React.FC<{ sunDirection?: THREE.Vector3; fade?: number }> = ({ sunDirection, fade = 1 }) => {
  const ref = useRef<any>(null);
  const { camera, scene } = useThree();

  useFrame(({ clock }) => {
    if (ref.current) {
      ref.current.uTime = clock.getElapsedTime();
      ref.current.uCamPos = camera.position;
      ref.current.uFade = fade;

      const fog = scene.fog as THREE.Fog | undefined;
      if (fog) {
        ref.current.uFogColor.copy(fog.color);
        ref.current.uFogNear = fog.near;
        ref.current.uFogFar = fog.far;
      } else {
        ref.current.uFogColor.set('#87CEEB');
        ref.current.uFogNear = 1e6;
        ref.current.uFogFar = 1e6 + 1.0;
      }

      if (sunDirection) ref.current.uSunDir = sunDirection;
      if (ref.current.uNoiseTexture !== noiseTexture) {
        ref.current.uNoiseTexture = noiseTexture;
      }
    }
  });

  return (
    // @ts-ignore
    <waterMeshShader
        ref={ref}
        transparent
        side={THREE.DoubleSide} // Render backfaces for volume feel
        depthWrite={false} // Important for transparency sorting
        glslVersion={THREE.GLSL3}
    />
  );
};
