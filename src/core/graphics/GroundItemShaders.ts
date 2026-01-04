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

/**
 * SHARD_SHADER - For sharp blade-like stone fragments
 * Uses noise displacement to create faceted, chipped edges on cone geometry.
 * The displacement is asymmetric to emphasize the blade-like quality.
 */
export const SHARD_SHADER = {
  vertex: `
    attribute vec3 aInstancePos;
    attribute vec3 aInstanceNormal;
    attribute float aSeed;

    uniform float uSeed;
    uniform bool uInstancing;
    uniform sampler3D uNoiseTexture;
    uniform float uDisplacementStrength;
    varying vec3 vWorldPos;
    varying float vEdgeFactor;

    void main() {
        vec3 pos = position;
        float seed = uInstancing ? aSeed : uSeed;

        float randRot = fract(sin(seed * 12.9898 + 78.233) * 43758.5453) * 6.28318;
        float cRot = cos(randRot);
        float sRot = sin(randRot);
        mat3 rotY = mat3(cRot, 0.0, sRot, 0.0, 1.0, 0.0, -sRot, 0.0, cRot);

        float randScale = 0.9 + fract(sin(seed + 1.0) * 43758.5453) * 0.3;

        // Noise-based displacement for faceted blade appearance
        vec3 noiseCoord = pos * 3.0 + vec3(seed * 0.15, seed * 0.21, seed * 0.09);
        vec3 texCoord = fract(noiseCoord * 0.1 + 0.5);
        float noiseVal = texture(uNoiseTexture, texCoord).r;

        // Edge factor: vertices near the base get less displacement
        // This keeps the blade tip sharp while roughening the sides
        float heightFactor = clamp((pos.y + 0.2) / 0.4, 0.0, 1.0);
        vEdgeFactor = heightFactor;

        float displacementAmt = uDisplacementStrength > 0.0 ? uDisplacementStrength : 0.08;
        float displacement = (noiseVal - 0.5) * displacementAmt * (1.0 - heightFactor * 0.7);

        vec3 vertNormal = normalize(vec3(pos.x, 0.0, pos.z));
        pos += vertNormal * displacement * randScale;

        if (uInstancing) {
            vec3 up = normalize(aInstanceNormal);
            vec3 helper = abs(up.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
            vec3 tangent = normalize(cross(helper, up));
            vec3 bitangent = cross(up, tangent);
            mat3 alignMat = mat3(tangent, up, bitangent);

            pos *= randScale;
            pos = alignMat * (rotY * pos);
            csm_Position = aInstancePos + pos;
            vWorldPos = aInstancePos;
            csm_Normal = normalize(alignMat * (rotY * normal));
        } else {
            pos *= randScale;
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
    uniform float uDisplacementStrength; // Controls fracture intensity (default 0.15)
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

        // Noise-based vertex displacement for "chipped" stone appearance
        // Sample 3D noise at position offset by seed for per-stone variation
        vec3 noiseCoord = normalize(position) * 2.5 + vec3(seed * 0.1, seed * 0.17, seed * 0.23);
        // Remap noise coords to 0-1 range for texture sampling
        vec3 texCoord = fract(noiseCoord * 0.08 + 0.5);
        float noiseVal = texture(uNoiseTexture, texCoord).r;

        // Displacement strength - push/pull vertices along normal direction
        // Center around 0.5 so some vertices push out, others pull in
        float displacementAmt = uDisplacementStrength > 0.0 ? uDisplacementStrength : 0.15;
        float displacement = (noiseVal - 0.5) * displacementAmt * randScale;

        // Apply displacement along the vertex normal (pre-rotation)
        vec3 vertNormal = normalize(position);
        pos += vertNormal * displacement;

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
            // Mix in displaced normal for proper lighting on chipped surfaces
            csm_Normal = normalize(mix(alignMat * (rotY * vertNormal), up, 0.3));
        } else {
            pos = rotY * pos;
            csm_Normal = rotY * vertNormal;
            vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        }
    }
  `
};
