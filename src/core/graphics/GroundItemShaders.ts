// GroundItemShaders.ts - Shared procedural logic for sticks and stones
// Supports both instanced rendering (for terrain clutter) and standard mesh rendering (for held/thrown items).

export const STICK_SHADER = {
  vertex: `
    attribute vec3 aInstancePos;
    attribute vec3 aInstanceNormal;
    attribute float aSeed;

    uniform float uSeed;
    uniform float uHeight;
    uniform bool uInstancing;
    varying vec2 vUv;
    varying vec3 vWorldPos;

    void main() {
        vUv = uv;
        vec3 pos = position;
        float seed = uInstancing ? aSeed : uSeed;

        float randRot = fract(sin(seed * 12.9898 + 78.233) * 43758.5453) * 6.28318;
        float cRot = cos(randRot);
        float sRot = sin(randRot);
        mat3 rotY = mat3(cRot, 0.0, sRot, 0.0, 1.0, 0.0, -sRot, 0.0, cRot);

        if (uInstancing) {
            vec3 up = normalize(aInstanceNormal);
            vec3 helper = abs(up.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
            vec3 tangent = normalize(cross(helper, up));
            vec3 bitangent = cross(up, tangent);
            mat3 alignMat = mat3(tangent, up, bitangent);

            mat3 rotX90 = mat3(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, -1.0, 0.0);
            float length = 0.80 + fract(seed * 43.1) * 0.40;
            float radius = 0.035 + fract(seed * 31.7) * 0.020;
            pos *= vec3(radius, length, radius);
            pos = alignMat * (rotY * (rotX90 * pos));
            
            vec3 finalPos = aInstancePos + (alignMat * vec3(0.0, 0.10, 0.0)) + pos;
            csm_Position = finalPos;
            vWorldPos = aInstancePos;
            csm_Normal = normalize(mix(alignMat * normal, up, 0.5));
        } else {
            pos = rotY * pos;
            csm_Normal = rotY * normal;
            vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        }
    }
  `
};

export const ROCK_SHADER = {
  vertex: `
    attribute vec3 aInstancePos;
    attribute vec3 aInstanceNormal;
    attribute float aSeed;

    uniform float uSeed;
    uniform bool uInstancing;
    uniform sampler3D uNoiseTexture;
    varying vec3 vWorldPos;

    void main() {
        vec3 pos = position;
        float seed = uInstancing ? aSeed : uSeed;

        float randRot = fract(sin(seed * 12.9898 + 78.233) * 43758.5453) * 6.28318;
        float cRot = cos(randRot);
        float sRot = sin(randRot);
        mat3 rotY = mat3(cRot, 0.0, sRot, 0.0, 1.0, 0.0, -sRot, 0.0, cRot);

        float randScale = 0.85 + fract(sin(seed + 1.0) * 43758.5453) * 0.80;
        pos *= randScale;

        if (uInstancing) {
            vec3 up = normalize(aInstanceNormal);
            vec3 helper = abs(up.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
            vec3 tangent = normalize(cross(helper, up));
            vec3 bitangent = cross(up, tangent);
            mat3 alignMat = mat3(tangent, up, bitangent);

            pos = alignMat * (rotY * pos);
            vec3 finalPos = aInstancePos + pos;
            csm_Position = finalPos;
            vWorldPos = aInstancePos;
            csm_Normal = normalize(mix(alignMat * normal, up, 0.3));
        } else {
            pos = rotY * pos;
            csm_Normal = rotY * normal;
            vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        }
    }
  `
};
