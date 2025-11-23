import { TOTAL_SIZE_XZ, TOTAL_SIZE_Y, BEDROCK_LEVEL, PAD } from '../constants';
import { BlockType, GreedyMeshResult } from '../types';
import { getTextureIndex } from './TextureGenerator';
import { getVoxel } from './chunkUtils';

const isTransparent = (type: number) => {
    return type === BlockType.WATER || type === BlockType.AIR || type === BlockType.GLASS || type === BlockType.LEAF;
};

const calcAO = (side1: boolean, side2: boolean, corner: boolean) => {
  if (side1 && side2) return 0;
  return 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
};

export const meshChunk = (voxels: Uint8Array): GreedyMeshResult => {
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const textureIndices: number[] = [];
    const aos: number[] = [];

    const tPositions: number[] = [];
    const tIndices: number[] = [];
    const tNormals: number[] = [];
    const tUvs: number[] = [];
    const tTextureIndices: number[] = [];
    const tAos: number[] = [];

    const dims = [TOTAL_SIZE_XZ, TOTAL_SIZE_Y, TOTAL_SIZE_XZ];

    for (let d = 0; d < 3; d++) {
        const i = (d + 1) % 3;
        const j = (d + 2) % 3;
        const u = [0, 0, 0];
        const q = [0, 0, 0];
        q[d] = 1;

        const mask = new Int32Array(dims[i] * dims[j]);

        for (let x = 0; x < dims[d]; x++) {
            let n = 0;
            for (let b = 0; b < dims[j]; b++) {
                for (let a = 0; a < dims[i]; a++) {
                    u[d] = x; u[i] = a; u[j] = b;
                    const t0 = getVoxel(voxels, u[0], u[1], u[2]);
                    const t1 = getVoxel(voxels, u[0] + q[0], u[1] + q[1], u[2] + q[2]);

                    let faceDir = 0;
                    let blockToDraw = 0;

                    const t0Trans = isTransparent(t0);
                    const t1Trans = isTransparent(t1);

                    if (t0 !== BlockType.AIR && (t1 === BlockType.AIR || (t1Trans && !t0Trans) || (t1Trans && t0Trans && t0 !== t1))) {
                        faceDir = 1;
                        blockToDraw = t0;
                    } else if (t1 !== BlockType.AIR && (t0 === BlockType.AIR || (t0Trans && !t1Trans) || (t0Trans && t1Trans && t1 !== t0))) {
                        faceDir = -1;
                        blockToDraw = t1;
                    }

                    if (faceDir !== 0) {
                        const normal = { x: faceDir * q[0], y: faceDir * q[1], z: faceDir * q[2] };
                        const texIdx = getTextureIndex(blockToDraw, normal);
                        mask[n] = (1 << 30) | (faceDir === 1 ? 1<<29 : 0) | (isTransparent(blockToDraw) ? 1<<28 : 0) | (texIdx & 0xFFFF);
                    } else {
                        mask[n] = 0;
                    }
                    n++;
                }
            }

            n = 0;
            for (let jPos = 0; jPos < dims[j]; jPos++) {
                for (let iPos = 0; iPos < dims[i]; ) {
                    const c = mask[n];
                    if (c !== 0) {
                        let width = 1;
                        while (iPos + width < dims[i] && mask[n + width] === c) width++;

                        let height = 1;
                        let done = false;
                        while (jPos + height < dims[j]) {
                            for (let k = 0; k < width; k++) {
                                if (mask[n + k + height * dims[i]] !== c) {
                                    done = true;
                                    break;
                                }
                            }
                            if (done) break;
                            height++;
                        }

                        const isBack = (c & (1<<29)) !== 0;
                        const isTrans = (c & (1<<28)) !== 0;
                        const texIdx = c & 0xFFFF;

                        const aoLayer = x + (isBack ? 1 : 0);

                        // Helper to get opacity at aoLayer
                        // We check if block at (u, v) in aoLayer is solid (casts shadow)
                        const solid = (du: number, dv: number) => {
                            const p = [0,0,0];
                            p[d] = aoLayer;
                            p[i] = iPos + du;
                            p[j] = jPos + dv;
                            const t = getVoxel(voxels, p[0], p[1], p[2]);
                            return t !== BlockType.AIR && !isTransparent(t);
                        };

                        const ao = new Uint8Array(4);
                        // Vertices: 00, 10, 11, 01 (Quad corners)
                        // But need to map to greedy quad size
                        // 00: (0, 0)
                        // 10: (width, 0)
                        // 11: (width, height)
                        // 01: (0, height)

                        const computeVert = (du: number, dv: number) => {
                            // Check 3 neighbors around corner (du, dv)
                            // We are at corner of block (iPos+du, jPos+dv)?
                            // No, vertices are at grid intersections.
                            // Corner (0,0) is at iPos, jPos.
                            // Neighbors are (-1, -1), (-1, 0), (0, -1) relative to corner?
                            // Yes.

                            // Let's define neighbors relative to the vertex.
                            // Vertex (du, dv) is at local (du, dv).
                            // The 4 blocks sharing this vertex in the plane are:
                            // TL: (du-1, dv-1)
                            // TR: (du, dv-1)
                            // BL: (du-1, dv)
                            // BR: (du, dv)
                            // Our quad covers BR (relative to 0,0).
                            // So we check TL, TR, BL.

                            // Adjust for width/height
                            // v00 (bottom-left in UV, top-left in loop?)
                            // Standard:
                            // v0: (0,0). Neighbors: (-1, -1), (0, -1), (-1, 0).
                            // v1: (w,0). Neighbors: (w, -1), (w-1, -1), (w, 0). -> Wait.
                            // The "Side" neighbors are adjacent to the face.

                            // Simplification:
                            // s1 = solid(du-1, dv)
                            // s2 = solid(du, dv-1)
                            // c = solid(du-1, dv-1)
                            // But this depends on which corner.
                            // Let's just use offsets relative to the vertex.

                            // Vert 0 (0,0): Checks (-1,0), (0,-1), (-1,-1)
                            // Vert 1 (w,0): Checks (w,0), (w-1,-1), (w,-1) ??
                            // No. Vert 1 is at iPos+w.
                            // Blocks to check are those NOT in the quad (or adjacent).
                            // Occluders are outside the quad.

                            // Let's use specific offsets.
                            // du, dv are vertex offsets from (iPos, jPos).
                            // We check blocks relative to (iPos+du, jPos+dv).
                            // But "block coords" are cell centers.
                            // Vertex is at corner.
                            // Blocks sharing vertex (du, dv):
                            // A: (du-1, dv-1), B: (du, dv-1), C: (du-1, dv), D: (du, dv)
                            // One of these is INSIDE the quad (D for v00?).
                            // If D is the quad, then A, B, C are potential occluders.

                            // Correct Mapping:
                            // v0 (0,0): Quad is D (0,0). Occluders: A(-1,-1), B(0,-1), C(-1,0).
                            // v1 (w,0): Quad is C (w-1, 0). Occluders: A(w-1,-1), B(w,-1), D(w,0).
                            // v2 (w,h): Quad is A (w-1, h-1). Occluders: B(w, h-1), C(w-1, h), D(w,h).
                            // v3 (0,h): Quad is B (0, h-1). Occluders: A(-1, h-1), C(-1, h), D(0, h).

                            let s1, s2, c;
                            if (du === 0 && dv === 0) { // v0
                                s1 = solid(-1, 0); s2 = solid(0, -1); c = solid(-1, -1);
                            } else if (du === width && dv === 0) { // v1
                                s1 = solid(width, 0); s2 = solid(width - 1, -1); c = solid(width, -1);
                            } else if (du === width && dv === height) { // v2
                                s1 = solid(width, height - 1); s2 = solid(width - 1, height); c = solid(width, height);
                            } else { // v3
                                s1 = solid(-1, height - 1); s2 = solid(0, height); c = solid(-1, height);
                            }
                            return calcAO(s1, s2, c);
                        };

                        const ao0 = computeVert(0, 0);
                        const ao1 = computeVert(width, 0);
                        const ao2 = computeVert(width, height);
                        const ao3 = computeVert(0, height);

                        // Geometry Generation
                        const POS = isTrans ? tPositions : positions;
                        const IND = isTrans ? tIndices : indices;
                        const NORM = isTrans ? tNormals : normals;
                        const UV = isTrans ? tUvs : uvs;
                        const TEX = isTrans ? tTextureIndices : textureIndices;
                        const AO = isTrans ? tAos : aos;

                        const idx = POS.length / 3;

                        // Coordinates
                        // u is i-axis, v is j-axis.
                        // Pos in 3D:
                        const p = [0,0,0];
                        p[d] = x + 1;

                        // Vertices
                        // 0: (0, 0)
                        // 1: (w, 0)
                        // 2: (w, h)
                        // 3: (0, h)

                        const pushVert = (du: number, dv: number, aoVal: number) => {
                             p[i] = iPos + du;
                             p[j] = jPos + dv;
                             // Convert to World
                             POS.push(p[0] - PAD, p[1] - PAD + BEDROCK_LEVEL, p[2] - PAD);

                             // Normals
                             if (isBack) NORM.push(q[0], q[1], q[2]);
                             else NORM.push(-q[0], -q[1], -q[2]);

                             // UVs (Use world coords or size?)
                             // Use size for tiling.
                             UV.push(du, dv);

                             TEX.push(texIdx);
                             AO.push(aoVal);
                        };

                        pushVert(0, 0, ao0);
                        pushVert(width, 0, ao1);
                        pushVert(width, height, ao2);
                        pushVert(0, height, ao3);

                        // Indices (0, 1, 2, 2, 3, 0)
                        if (isBack) {
                             IND.push(idx, idx+1, idx+2, idx+2, idx+3, idx);
                        } else {
                             IND.push(idx+2, idx+1, idx, idx, idx+3, idx+2);
                        }

                        // Clear mask
                        for (let l = 0; l < height; l++) {
                            for (let k = 0; k < width; k++) {
                                mask[n + k + l * dims[i]] = 0;
                            }
                        }

                        iPos += width;
                        n += width;
                    } else {
                        iPos++;
                        n++;
                    }
                }
            }
        }
    }

    return {
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        normals: new Float32Array(normals),
        uvs: new Float32Array(uvs),
        textureIndices: new Float32Array(textureIndices),
        ao: new Float32Array(aos),

        transparentPositions: new Float32Array(tPositions),
        transparentIndices: new Uint32Array(tIndices),
        transparentNormals: new Float32Array(tNormals),
        transparentUvs: new Float32Array(tUvs),
        transparentTextureIndices: new Float32Array(tTextureIndices),
        transparentAo: new Float32Array(tAos)
    };
};
