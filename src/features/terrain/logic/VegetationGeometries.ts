import * as THREE from 'three';

// 1. Grass Clump (Blade clusters)
// Generates 3-5 blades radiating from center with curvature
function createGrassGeo(bladeCount: number, height: number, width: number) {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    let idx = 0;
    const SEGMENTS = 2; // Reduced segments for cleaner look

    for (let i = 0; i < bladeCount; i++) {
        const angle = (i / bladeCount) * Math.PI * 2 + (Math.random() * 0.5);
        const lean = (Math.random() * 0.3) + 0.1;
        const curve = (Math.random() * 0.2) + 0.05;

        // Blade properties - Wider base
        const w = width * (1.2 + Math.random() * 0.5);
        const h = height * (0.7 + Math.random() * 0.6);

        // Base center
        const bx = 0;
        const bz = 0;

        // Generate segments
        for (let j = 0; j <= SEGMENTS; j++) {
            const t = j / SEGMENTS; // 0 to 1

            // Width tapers to point
            const currentW = w * (1.0 - t);

            // Height grows linearly
            const y = h * t;

            // X/Z offset (Lean + Curve)
            const offset = (lean * t) + (curve * t * t);

            const cx = bx + Math.sin(angle) * offset;
            const cz = bz + Math.cos(angle) * offset;

            // Left and Right vertices at this height
            const px = Math.cos(angle) * currentW * 0.5;
            const pz = -Math.sin(angle) * currentW * 0.5;

            // Vertex 1 (Left)
            positions.push(cx + px, y, cz + pz);
            // Vertex 2 (Right)
            positions.push(cx - px, y, cz - pz);

            // Normals (approximate up/out)
            const ny = 1.0;
            const nx = Math.sin(angle) * 0.5;
            const nz = Math.cos(angle) * 0.5;
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

            normals.push(nx / len, ny / len, nz / len);
            normals.push(nx / len, ny / len, nz / len);

            uvs.push(0, t);
            uvs.push(1, t);
        }

        // Indices for quads between segments
        for (let j = 0; j < SEGMENTS; j++) {
            const base = idx + j * 2;
            indices.push(
                base, base + 1, base + 2,
                base + 2, base + 1, base + 3,
                // Back face
                base + 1, base, base + 2,
                base + 1, base + 2, base + 3
            );
        }

        idx += (SEGMENTS + 1) * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    return geo;
}

// 2. Flower (Stem + Head)
function createFlowerGeo() {
    const pos: number[] = [];
    const ind: number[] = [];
    const norm: number[] = [];

    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        const p = g.attributes.position.array;
        const n = g.attributes.normal.array;
        const i = g.index!.array;
        const offset = pos.length / 3;

        for (let k = 0; k < p.length; k++) pos.push(p[k]);
        for (let k = 0; k < n.length; k++) norm.push(n[k]);
        for (let k = 0; k < i.length; k++) ind.push(i[k] + offset);
    };

    addBox(0.02, 0.3, 0.02, 0, 0.15, 0); // Stem
    addBox(0.1, 0.1, 0.1, 0, 0.35, 0);   // Head

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm), 3));
    geo.setIndex(ind);
    return geo;
}

// 4. Shrub (Cluster of boxes)
function createShrubGeo() {
    const pos: number[] = [];
    const ind: number[] = [];
    const norm: number[] = [];

    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
        const g = new THREE.BoxGeometry(w, h, d);
        g.translate(x, y, z);
        const p = g.attributes.position.array;
        const n = g.attributes.normal.array;
        const i = g.index!.array;
        const offset = pos.length / 3;
        for (let k = 0; k < p.length; k++) pos.push(p[k]);
        for (let k = 0; k < n.length; k++) norm.push(n[k]);
        for (let k = 0; k < i.length; k++) ind.push(i[k] + offset);
    };

    addBox(0.25, 0.25, 0.25, 0, 0.125, 0);
    addBox(0.15, 0.15, 0.15, 0.15, 0.15, 0);
    addBox(0.15, 0.15, 0.15, -0.1, 0.2, 0.1);
    addBox(0.15, 0.15, 0.15, 0, 0.15, -0.15);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(norm), 3));
    geo.setIndex(ind);
    return geo;
}

export const VEGETATION_GEOMETRIES = {
    grass_low: createGrassGeo(3, 0.3, 0.08),
    grass_tall: createGrassGeo(4, 0.6, 0.1),
    grass_carpet: createGrassGeo(12, 0.4, 0.05),
    flower: createFlowerGeo(),
    fern: createGrassGeo(6, 0.25, 0.2),
    broadleaf: createGrassGeo(3, 0.45, 0.24),
    shrub: createShrubGeo(),
    box: new THREE.BoxGeometry(0.2, 0.5, 0.2)
};
