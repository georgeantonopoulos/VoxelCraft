import * as THREE from 'three';
import { noise } from '@core/math/noise';

export function createNoiseTexture(size = 64): THREE.Data3DTexture {
    // Safety check: prevent catastrophic allocation failures.
    // 64^3 * 4 = 1MB. 128^3 * 4 = 8MB. 256^3 * 4 = 64MB.
    if (size > 128) {
        console.warn(`[textureGenerator] Requested large size (${size}), capping at 64 to prevent OOM.`);
        size = 64;
    }
    const data = new Uint8Array(size * size * size * 4);

    let i = 0;
    const scale = 0.1; // Determines how "zoomed out" the noise in the texture is

    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                // We sample noise at different frequencies and pack them into channels.
                // We ensure the input coordinates wrap nicely by relying on the noise implementation's
                // underlying permutation table (256).
                // Ideally, we map 'size' to a multiple of the period if we want perfect tiling without seams,
                // but since we use GL_REPEAT, we just need the values at 0 and size to be continuous.
                // Our Perlin noise isn't strictly periodic at arbitrary scales unless we force it.
                // However, for terrain texturing, seamless-ness is less critical than for heightmaps,
                // and Triplanar mapping hides seams well.

                const nx = x * scale;
                const ny = y * scale;
                const nz = z * scale;

                // Frequencies: Base, x2, x4, x8
                const n1 = noise(nx, ny, nz);
                const n2 = noise(nx * 2 + 100, ny * 2 + 100, nz * 2 + 100);
                const n3 = noise(nx * 4 + 200, ny * 4 + 200, nz * 4 + 200);
                const n4 = noise(nx * 8 + 300, ny * 8 + 300, nz * 8 + 300);

                // Normalize -1..1 to 0..255
                data[i] = (n1 * 0.5 + 0.5) * 255;
                data[i + 1] = (n2 * 0.5 + 0.5) * 255;
                data[i + 2] = (n3 * 0.5 + 0.5) * 255;
                data[i + 3] = (n4 * 0.5 + 0.5) * 255;

                i += 4;
            }
        }
    }

    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
}
