import * as THREE from 'three';
import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';

// @ts-ignore
const BlockShaderMaterial = shaderMaterial(
  {
    uMap: null,
    uSunIntensity: 1.0,
  },
  `
    precision highp float;
    precision highp int;

    in vec3 position;
    in vec3 normal;
    in vec2 uv;
    in float aTextureIndex;
    in float aAo;

    uniform mat4 modelMatrix;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;
    uniform mat3 normalMatrix;

    out vec2 vUv;
    out float vTextureIndex;
    out float vAo;
    out vec3 vNormal;

    void main() {
      vUv = uv;
      vTextureIndex = aTextureIndex;
      vAo = aAo / 3.0;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  `
    precision highp float;
    precision highp int;
    precision highp sampler2DArray;

    uniform sampler2DArray uMap;
    uniform float uSunIntensity;

    in vec2 vUv;
    in float vTextureIndex;
    in float vAo;
    in vec3 vNormal;

    out vec4 fragColor;

    void main() {
      vec4 color = texture(uMap, vec3(vUv, vTextureIndex));
      if (color.a < 0.1) discard;

      vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
      float diff = max(dot(vNormal, sunDir), 0.0);
      float light = 0.3 + 0.7 * diff;

      float ao = smoothstep(0.0, 1.0, vAo);
      light *= (0.5 + 0.5 * ao);

      fragColor = vec4(color.rgb * light * uSunIntensity, color.a);
    }
  `
);

extend({ BlockShaderMaterial });

export { BlockShaderMaterial };
