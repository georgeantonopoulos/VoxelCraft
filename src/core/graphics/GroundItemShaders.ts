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
    varying vec3 vLocalPos;
    varying float vSeed;

    void main() {
        vUv = uv;
        vec3 pos = position;
        float seed = uInstancing ? aSeed : uSeed;
        vSeed = seed;
        vLocalPos = position;

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
  `,
  fragment: `
    precision highp sampler3D;
    uniform sampler3D uNoiseTexture;
    uniform vec3 uColor;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vLocalPos;
    varying float vSeed;

    void main() {
        // Cylindrical UV for bark pattern
        float angle = atan(vLocalPos.x, vLocalPos.z);
        vec2 barkUV = vec2(angle * 2.0, vLocalPos.y * 8.0);

        // Multi-scale noise sampling
        vec3 noiseCoord = vLocalPos * 5.0 + vec3(vSeed * 0.1);
        float nBark = texture(uNoiseTexture, vec3(barkUV.x, barkUV.y, 0.0) * 0.3).r;
        float nFine = texture(uNoiseTexture, noiseCoord * 0.6).g;
        float nMicro = texture(uNoiseTexture, noiseCoord * 1.5).b;

        // Wood grain - vertical lines
        float grainPattern = sin(barkUV.y * 30.0 + nFine * 4.0);
        float grain = smoothstep(0.6, 0.9, grainPattern);

        // Bark ridges
        float ridges = smoothstep(0.35, 0.65, nBark);

        // Knots and imperfections
        float knots = smoothstep(0.75, 0.8, nFine) * smoothstep(0.6, 0.65, nMicro);

        // Base wood color with variation
        vec3 col = uColor;
        col *= 0.85 + nBark * 0.3;

        // Darken grain lines
        col *= 0.92 + grain * 0.1;

        // Ridge highlights
        col += vec3(0.03, 0.025, 0.015) * ridges;

        // Knot darkening
        col *= 1.0 - knots * 0.4;

        // Weathering at ends
        float endWeather = smoothstep(0.4, 0.5, abs(vLocalPos.y));
        col *= 0.95 + endWeather * 0.1;
        col = mix(col, col * vec3(0.9, 0.88, 0.82), endWeather * 0.3);

        // Micro fiber detail
        float fibers = sin(barkUV.y * 80.0 + nMicro * 10.0) * 0.5 + 0.5;
        col += vec3(0.015) * fibers * (1.0 - knots);

        csm_DiffuseColor = vec4(col, 1.0);

        // Variable roughness
        float rough = 0.88 + ridges * 0.08 - grain * 0.05 + knots * 0.04;
        csm_Roughness = clamp(rough, 0.8, 0.98);
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
    varying vec3 vLocalPos;
    varying float vEdgeFactor;
    varying float vSeed;

    void main() {
        vec3 pos = position;
        float seed = uInstancing ? aSeed : uSeed;
        vSeed = seed;
        vLocalPos = position;

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
  `,
  fragment: `
    precision highp sampler3D;
    uniform sampler3D uNoiseTexture;
    uniform vec3 uColor;
    varying vec3 vWorldPos;
    varying vec3 vLocalPos;
    varying float vEdgeFactor;
    varying float vSeed;

    void main() {
        // Multi-scale noise for obsidian/flint detail
        vec3 noiseCoord = vLocalPos * 8.0 + vec3(vSeed * 0.1);
        float nBase = texture(uNoiseTexture, noiseCoord * 0.2).r;
        float nFine = texture(uNoiseTexture, noiseCoord * 0.5).g;
        float nMicro = texture(uNoiseTexture, noiseCoord * 1.2).b;

        // Conchoidal fracture pattern (characteristic of obsidian/flint)
        float fracture = sin(vLocalPos.y * 15.0 + nFine * 6.0 + vLocalPos.x * 8.0);
        float conchoidal = smoothstep(0.6, 0.9, fracture);

        // Flow banding (volcanic glass striations)
        float banding = sin(vLocalPos.y * 25.0 + nBase * 3.0) * 0.5 + 0.5;
        banding = smoothstep(0.4, 0.6, banding);

        // Sharp edge highlights
        float edgeShine = smoothstep(0.7, 1.0, vEdgeFactor);

        // Base obsidian color with depth variation
        vec3 col = uColor;
        col *= 0.9 + nBase * 0.2;

        // Iridescent shimmer (oil-slick effect on obsidian)
        vec3 iridescence = vec3(
            0.5 + 0.5 * sin(nFine * 6.28 + 0.0),
            0.5 + 0.5 * sin(nFine * 6.28 + 2.09),
            0.5 + 0.5 * sin(nFine * 6.28 + 4.19)
        );
        col = mix(col, col + iridescence * 0.08, nMicro * edgeShine);

        // Flow banding - subtle color variation
        col *= 0.95 + banding * 0.1;

        // Conchoidal fracture highlights
        col += vec3(0.04) * conchoidal * edgeShine;

        // Micro-scratches
        float scratches = smoothstep(0.7, 0.75, nMicro);
        col *= 1.0 - scratches * 0.15;

        csm_DiffuseColor = vec4(col, 1.0);

        // Glassy roughness - very smooth on edges, slightly rougher on flat faces
        float rough = 0.12 + (1.0 - edgeShine) * 0.15 + scratches * 0.1;
        rough -= conchoidal * 0.05;
        csm_Roughness = clamp(rough, 0.05, 0.35);

        // Slight metalness for glass-like reflection
        csm_Metalness = 0.8 + edgeShine * 0.15;
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
    varying vec3 vLocalPos;
    varying vec3 vWorldNormal;
    varying float vSeed;

    void main() {
        vec3 pos = position;
        float seed = uInstancing ? aSeed : uSeed;
        vSeed = seed;
        vLocalPos = position;

        float randRot = fract(sin(seed * 12.9898 + 78.233) * 43758.5453) * 6.28318;
        float cRot = cos(randRot);
        float sRot = sin(randRot);
        mat3 rotY = mat3(cRot, 0.0, sRot, 0.0, 1.0, 0.0, -sRot, 0.0, cRot);

        float randScale = 0.85 + fract(sin(seed + 1.0) * 43758.5453) * 0.80;
        pos *= randScale;

        // Noise-based vertex displacement for "chipped" stone appearance
        vec3 noiseCoord = normalize(position) * 2.5 + vec3(seed * 0.1, seed * 0.17, seed * 0.23);
        vec3 texCoord = fract(noiseCoord * 0.08 + 0.5);
        float noiseVal = texture(uNoiseTexture, texCoord).r;

        float displacementAmt = uDisplacementStrength > 0.0 ? uDisplacementStrength : 0.15;
        float displacement = (noiseVal - 0.5) * displacementAmt * randScale;

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
            csm_Normal = normalize(mix(alignMat * (rotY * vertNormal), up, 0.3));
            vWorldNormal = csm_Normal;
        } else {
            pos = rotY * pos;
            csm_Normal = rotY * vertNormal;
            vWorldNormal = csm_Normal;
            vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        }
    }
  `,
  fragment: `
    precision highp sampler3D;
    uniform sampler3D uNoiseTexture;
    uniform vec3 uColor;
    varying vec3 vWorldPos;
    varying vec3 vLocalPos;
    varying vec3 vWorldNormal;
    varying float vSeed;

    void main() {
        // Multi-scale noise for stone detail
        vec3 noiseCoord = vLocalPos * 4.0 + vec3(vSeed * 0.1);
        float nBase = texture(uNoiseTexture, noiseCoord * 0.25).r;
        float nFine = texture(uNoiseTexture, noiseCoord * 0.6).g;
        float nMicro = texture(uNoiseTexture, noiseCoord * 1.5).b;

        // Mineral crystal sparkle
        float crystals = smoothstep(0.72, 0.78, nMicro);
        float mica = smoothstep(0.8, 0.85, nFine) * smoothstep(0.6, 0.65, nMicro);

        // Veins/cracks pattern
        float veinPattern = sin(vLocalPos.x * 12.0 + nBase * 4.0 + vLocalPos.y * 8.0);
        float veins = smoothstep(0.85, 0.95, veinPattern);

        // Iron staining (rusty patches)
        float ironStain = smoothstep(0.6, 0.7, nBase) * smoothstep(0.5, 0.55, nFine);

        // Base stone color with variation
        vec3 col = uColor;
        col *= 0.85 + nBase * 0.3;

        // Color temperature variation
        col.r *= 1.0 + (nFine - 0.5) * 0.08;
        col.b *= 1.0 - (nFine - 0.5) * 0.06;

        // Vein coloring (slightly lighter)
        col = mix(col, col * 1.15, veins * 0.5);

        // Iron staining (orange-brown tint)
        vec3 rustColor = vec3(0.6, 0.35, 0.2);
        col = mix(col, rustColor, ironStain * 0.35);

        // Crystal sparkle (bright spots)
        col += vec3(0.08) * crystals;

        // Mica shimmer (subtle iridescent)
        vec3 micaColor = vec3(0.9, 0.85, 0.7);
        col = mix(col, micaColor, mica * 0.4);

        // Moss on top surfaces
        float upFactor = dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0));
        float mossNoise = texture(uNoiseTexture, vLocalPos * 1.5 + vec3(3.0)).g;
        if (upFactor > 0.3 && mossNoise > 0.55) {
            vec3 mossCol = vec3(0.12, 0.4, 0.1);
            float mossMix = (mossNoise - 0.55) * 3.0 * upFactor;
            col = mix(col, mossCol, mossMix * 0.6);
        }

        // Micro grain
        float grain = nMicro * 2.0 - 1.0;
        col *= 1.0 + grain * 0.06;

        csm_DiffuseColor = vec4(col, 1.0);

        // Variable roughness
        float rough = 0.88;
        rough -= crystals * 0.2;  // Crystals are shiny
        rough -= mica * 0.25;     // Mica is very shiny
        rough += veins * 0.05;    // Veins slightly rougher
        rough += ironStain * 0.08; // Rust is rougher
        csm_Roughness = clamp(rough, 0.55, 0.98);
    }
  `
};
