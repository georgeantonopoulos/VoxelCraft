// GroundItemShaders.ts - Shared procedural logic for sticks and stones

export const STICK_SHADER = {
    vertex: `
    uniform float uSeed;
    uniform float uHeight;
    varying vec2 vUv;
    
    void main() {
      vUv = uv;
      vec3 pos = position;
      
      float halfH = uHeight * 0.5;
      // Use position Y to determine vertical progress (ty)
      // This ensures caps (flat Y) stay solid and don't shred.
      float ty = clamp((pos.y + halfH) / uHeight, 0.0, 1.0);
      
      float seed = uSeed;
      #ifdef USE_INSTANCING
        seed = instanceMatrix[3].x + instanceMatrix[3].z;
      #endif
      
      // Add slight knobby nodes - only on the sides, tapered at ends
      float knobs = sin(ty * 15.0 + seed * 10.0) * 0.12 * smoothstep(0.0, 0.2, ty) * smoothstep(1.0, 0.8, ty);
      pos.xz *= (1.0 + knobs);
      
      // Add bend
      float bendStrength = 0.15 + fract(seed * 123.4) * 0.2;
      float bendDir = fract(seed * 456.7) * 6.28;
      vec2 bend = vec2(cos(bendDir), sin(bendDir)) * bendStrength * pow(ty, 1.8);
      
      pos.xz += bend;
      
      // Approximate normal update for the bend
      // Higher ty = more tilt. We tilt the normal slightly in the bend direction.
      vec3 tilt = vec3(bend.x, 0.0, bend.y) * 1.5 * ty;
      csm_Normal = normalize(normal + tilt);
      
      csm_Position = pos;
    }
  `
};

export const ROCK_SHADER = {
    vertex: `
    uniform sampler3D uNoiseTexture;
    uniform float uSeed;
    varying vec3 vWorldPos;
    
    void main() {
      vec3 pos = position;
      
      // Seed logic
      float seed = uSeed;
      vec3 worldPos = vec3(0.0);
      #ifdef USE_INSTANCING
        worldPos = instanceMatrix[3].xyz;
        seed = worldPos.x + worldPos.z;
      #endif
      
      // Use world position as a volume offset for the noise
      vec3 noiseOffset = worldPos.xyz * 2.0;
      if (length(worldPos) < 0.001) {
         noiseOffset = vec3(seed * 10.0, seed * 20.0, seed * 30.0);
      }

      // Displacement based on ORIGINAL position so we don't get recursive distortion
      vec3 noiseCoord = position * 1.5 + noiseOffset;
      float n = texture(uNoiseTexture, noiseCoord * 0.5).r;
      float nSmall = texture(uNoiseTexture, noiseCoord * 2.0).g;
      
      float displacement = (n * 0.8 + nSmall * 0.3) - 0.5;
      
      if (displacement > 0.0) displacement = pow(displacement, 0.8);
      else displacement *= 0.6;
      
      pos += normal * displacement * 0.15;
      
      csm_Position = pos;
    }
  `
};
