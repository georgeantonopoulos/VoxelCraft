import * as THREE from 'three';
import { TreeType } from '@features/terrain/logic/VegetationConfig';

/**
 * Leaf-card textures, drawn once per species on a canvas at load time.
 * RGB = leaf albedo (sRGB), A = coverage (alpha tested in the leaf shader).
 * Card UV v runs from the twig (0) outward (1); palm fronds grow along v.
 */

const SIZE = 256;
const cache = new Map<number, THREE.Texture>();

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

const hsl = (h: number, s: number, l: number) => `hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;

/** One broad leaf: bezier blade with a gradient, midrib and a darker edge. */
function drawLeaf(ctx: Ctx, x: number, y: number, angle: number, len: number, width: number, hue: number, light: number, rand: () => number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(0, 0, len, 0);
  g.addColorStop(0, hsl(hue - 4, 0.55, light * 0.75));
  g.addColorStop(0.6, hsl(hue, 0.6, light));
  g.addColorStop(1, hsl(hue + 6, 0.55, light * 1.08));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -width, len * 0.75, -width * 0.9, len, 0);
  ctx.bezierCurveTo(len * 0.75, width * 0.9, len * 0.25, width, 0, 0);
  ctx.fill();
  // Shaded half (leaf folds along the midrib).
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, width, len * 0.75, width * 0.9, len, 0);
  ctx.lineTo(0, 0);
  ctx.fill();
  // Midrib and a few side veins.
  ctx.strokeStyle = hsl(hue + 10, 0.4, light * 1.35);
  ctx.lineWidth = Math.max(0.6, width * 0.08);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * 0.95, 0); ctx.stroke();
  ctx.lineWidth = Math.max(0.4, width * 0.04);
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    ctx.beginPath();
    ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.12), -width * 0.55 * (1 - t * 0.5));
    ctx.moveTo(len * t, 0); ctx.lineTo(len * (t + 0.12), width * 0.55 * (1 - t * 0.5));
    ctx.stroke();
  }
  // Occasional blemish.
  if (rand() < 0.25) {
    ctx.fillStyle = `rgba(90,70,30,${0.25 + rand() * 0.25})`;
    ctx.beginPath(); ctx.arc(len * (0.4 + rand() * 0.4), (rand() - 0.5) * width, width * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawTwig(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, w: number) {
  ctx.strokeStyle = '#4a3a28';
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}

function paint(type: TreeType, ctx: Ctx) {
  const rand = mulberry32(0x1eaf + type * 31);
  ctx.clearRect(0, 0, SIZE, SIZE);
  // Canvas y grows downward; card v = 0 at the twig, drawn at the bottom.
  const bx = SIZE / 2, by = SIZE * 0.95;
  switch (type) {
    case TreeType.PINE: {
      // Needle spray: a twig up the middle with dense needles angled forward.
      drawTwig(ctx, bx, by, bx, SIZE * 0.05, 3);
      for (let i = 0; i < 260; i++) {
        const t = rand();
        const y = by - t * (by - SIZE * 0.06);
        const side = rand() < 0.5 ? -1 : 1;
        const len = SIZE * (0.12 + 0.12 * (1 - Math.abs(t - 0.45)));
        const a = side * (0.6 + rand() * 0.5);
        ctx.strokeStyle = hsl(128 + rand() * 18, 0.45, 0.16 + rand() * 0.14);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(bx, y);
        ctx.lineTo(bx + Math.sin(a) * len, y - Math.cos(a) * len * 0.8);
        ctx.stroke();
      }
      break;
    }
    case TreeType.PALM: {
      // Frond: rachis along v with long drooping leaflets.
      ctx.strokeStyle = '#6f7a3a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(bx, SIZE); ctx.lineTo(bx, 0); ctx.stroke();
      for (let i = 0; i < 46; i++) {
        const t = i / 46;
        const y = SIZE * (1 - t);
        const len = SIZE * 0.47 * Math.sin(Math.PI * Math.min(1, 0.15 + t)) ;
        for (const side of [-1, 1]) {
          ctx.strokeStyle = hsl(95 + rand() * 20, 0.5, 0.22 + rand() * 0.1);
          ctx.lineWidth = 3.2 - t * 1.6;
          ctx.beginPath();
          ctx.moveTo(bx, y);
          ctx.quadraticCurveTo(bx + side * len * 0.5, y - len * 0.1, bx + side * len, y + len * 0.25);
          ctx.stroke();
        }
      }
      break;
    }
    case TreeType.ACACIA: {
      // Bipinnate: thin stems covered in tiny leaflets.
      for (let s = 0; s < 7; s++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
        const len = SIZE * (0.35 + rand() * 0.4);
        const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
        drawTwig(ctx, bx, by, ex, ey, 1.4);
        for (let i = 0; i < 26; i++) {
          const t = 0.15 + (i / 26) * 0.85;
          const px = bx + (ex - bx) * t, py = by + (ey - by) * t;
          for (const side of [-1, 1]) {
            ctx.fillStyle = hsl(88 + rand() * 18, 0.45, 0.22 + rand() * 0.12);
            ctx.beginPath();
            ctx.ellipse(px + Math.cos(a + side * 1.3) * 6, py + Math.sin(a + side * 1.3) * 6, 5, 2.2, a + side * 1.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      break;
    }
    case TreeType.JUNGLE: {
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * 2.6;
        const len = SIZE * (0.4 + rand() * 0.2);
        drawTwig(ctx, bx, by, bx + Math.cos(a) * len * 0.3, by + Math.sin(a) * len * 0.3, 2);
        drawLeaf(ctx, bx + Math.cos(a) * len * 0.25, by + Math.sin(a) * len * 0.25, a, len * 0.8, len * 0.28, 120 + rand() * 18, 0.2 + rand() * 0.08, rand);
      }
      break;
    }
    default: {
      // Broadleaf cluster (oak and generic).
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
        drawTwig(ctx, bx, by, bx + Math.cos(a) * SIZE * 0.45, by + Math.sin(a) * SIZE * 0.45, 2.2);
      }
      for (let i = 0; i < 30; i++) {
        const a = -Math.PI / 2 + (rand() - 0.5) * 2.8;
        const r = SIZE * (0.12 + rand() * 0.4);
        const len = SIZE * (0.16 + rand() * 0.1);
        drawLeaf(ctx, bx + Math.cos(a) * r, by + Math.sin(a) * r * 0.95, a + (rand() - 0.5) * 0.9, len, len * 0.36,
          102 + rand() * 22, 0.24 + rand() * 0.12, rand);
      }
    }
  }
}

/** Leaf texture for a tree type (cached; null outside the browser). */
export function getLeafTexture(type: TreeType): THREE.Texture | null {
  const cached = cache.get(type);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(type, ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = true; // canvas top = v 1 (the card's outer end)
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  cache.set(type, tex);
  return tex;
}
