import React, { useEffect, useRef } from 'react';

/**
 * Small shared pieces of The Grove's visual language: vine rules, realm
 * glyphs and the firefly field used behind menus.
 */

/** Thin horizontal rule with a leaf bud in the middle. */
export const VineRule: React.FC<{ className?: string; width?: number }> = ({ className = '', width = 180 }) => (
  <svg
    className={className}
    width={width}
    height="14"
    viewBox="0 0 180 14"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="vr-fade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#d7dcb6" stopOpacity="0" />
        <stop offset="0.5" stopColor="#d7dcb6" stopOpacity="0.55" />
        <stop offset="1" stopColor="#d7dcb6" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M0 7 H78 M102 7 H180" stroke="url(#vr-fade)" strokeWidth="1" />
    <path d="M78 7 C82 3, 86 3, 90 7 C86 11, 82 11, 78 7 Z" fill="#9dbd62" fillOpacity="0.85" />
    <path d="M102 7 C98 3, 94 3, 90 7 C94 11, 98 11, 102 7 Z" fill="#9dbd62" fillOpacity="0.55" />
    <circle cx="90" cy="7" r="1.6" fill="#f2cf7c" />
  </svg>
);

export type RealmGlyphKind = 'grove' | 'sky' | 'frozen' | 'lush' | 'chaos';

/** Line-drawn glyph for each world type. */
export const RealmGlyph: React.FC<{ kind: RealmGlyphKind; className?: string }> = ({ kind, className = '' }) => {
  const common = { stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      {kind === 'grove' && (
        <g {...common}>
          <path d="M16 28 V14" />
          <path d="M16 18 C11 17, 8 13, 9 8 C13 8, 16 11, 16 16" />
          <path d="M16 15 C20 14, 23 10, 23 5 C19 5, 16 8, 16 13" />
          <path d="M10 28 C13 26, 19 26, 22 28" />
        </g>
      )}
      {kind === 'sky' && (
        <g {...common}>
          <path d="M6 14 H26 L22 18 L19 24 L16 20 L12 22 L10 18 Z" />
          <path d="M14 14 V9 M14 9 C12 8, 11 6, 12 4 C14 5, 15 7, 14 9" />
          <path d="M4 8 H9 M22 7 H28" opacity="0.6" />
        </g>
      )}
      {kind === 'frozen' && (
        <g {...common}>
          <path d="M16 4 V28 M5.6 10 L26.4 22 M26.4 10 L5.6 22" />
          <path d="M13 6 L16 9 L19 6 M13 26 L16 23 L19 26" />
          <path d="M6 13.5 L10 12.5 L8.5 8.8 M26 18.5 L22 19.5 L23.5 23.2" />
        </g>
      )}
      {kind === 'lush' && (
        <g {...common}>
          <path d="M8 28 C8 18, 12 10, 24 5" />
          <path d="M10 21 C6 20, 4 17, 4 14 M12 16 C9 13, 9 10, 10 8 M15 12 C15 9, 17 7, 19 6" />
          <path d="M11 22 C15 23, 18 22, 20 19 M13 17 C17 17, 20 15, 22 12 M17 12 C20 11, 23 9, 25 9" />
        </g>
      )}
      {kind === 'chaos' && (
        <g {...common}>
          <path d="M16 16 C16 13, 19 12, 20.5 14 C22.5 17, 19.5 21, 15.5 20.5 C10.5 20, 9.5 13.5, 13 10.5 C17.5 6.5, 25 9, 25.5 15.5 C26 23, 17 27.5, 10.5 24 C3.5 20, 4.5 9, 11 5.5" />
          <circle cx="24" cy="25" r="1" fill="currentColor" />
          <circle cx="6" cy="27" r="0.8" fill="currentColor" />
        </g>
      )}
    </svg>
  );
};

interface Firefly {
  x: number; y: number;
  vx: number; vy: number;
  phase: number; speed: number;
  size: number; hue: 'ember' | 'lumina';
  depth: number;
}

/**
 * Drifting, blinking fireflies on a 2D canvas. Cheap (one draw per fly with
 * a pre-rendered glow sprite) and paused when the tab is hidden.
 */
export const FireflyField: React.FC<{ count?: number; className?: string }> = ({ count = 60, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    const makeSprite = (inner: string, outer: string) => {
      const s = document.createElement('canvas');
      s.width = s.height = 64;
      const g = s.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.12, inner);
      grad.addColorStop(0.4, outer);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return s;
    };
    const sprites = {
      ember: makeSprite('rgba(246, 219, 140, 1)', 'rgba(242, 190, 90, 0.18)'),
      lumina: makeSprite('rgba(180, 246, 234, 1)', 'rgba(110, 220, 210, 0.16)'),
    };

    let w = 0, h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w));
      canvas.height = Math.max(1, Math.floor(h));
    };
    resize();
    window.addEventListener('resize', resize);

    const flies: Firefly[] = Array.from({ length: count }, () => {
      const depth = 0.35 + Math.random() * 0.65;
      return {
        x: Math.random(), y: 0.25 + Math.random() * 0.75,
        vx: (Math.random() - 0.5) * 0.012, vy: (Math.random() - 0.5) * 0.008,
        phase: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.9,
        size: (5 + Math.random() * 9) * depth,
        hue: Math.random() < 0.78 ? 'ember' : 'lumina',
        depth,
      };
    });

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const t = now / 1000;
      for (const f of flies) {
        if (!reduced) {
          // Wandering drift: smooth random steering plus a slow upward lift.
          f.vx += Math.sin(t * 0.37 * f.speed + f.phase * 3.1) * 0.0009 * dt * 60;
          f.vy += Math.cos(t * 0.29 * f.speed + f.phase * 1.7) * 0.0006 * dt * 60 - 0.00005;
          f.vx *= 0.985; f.vy *= 0.985;
          f.x += f.vx * dt * f.depth;
          f.y += f.vy * dt * f.depth;
          if (f.x < -0.05) f.x = 1.05; else if (f.x > 1.05) f.x = -0.05;
          if (f.y < 0.1) f.y = 1.05; else if (f.y > 1.08) f.y = 0.15;
        }
        // Blink: mostly dim, brief warm pulses.
        const pulse = Math.pow(Math.max(0, Math.sin(t * f.speed * 1.3 + f.phase)), 6);
        const alpha = (0.12 + 0.88 * pulse) * (0.45 + 0.55 * f.depth);
        const size = f.size * (0.8 + 0.5 * pulse) * 2.4;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprites[f.hue], f.x * w - size / 2, f.y * h - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [count]);

  return <canvas ref={canvasRef} className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} aria-hidden="true" />;
};

/**
 * The key-art logo, cropped to the lettering. Its near-black background is
 * turned into transparency by an SVG filter (alpha from luminance, with gain),
 * so it sits cleanly over any backdrop. A screen blend only worked over the
 * title's black page: over the loading flyover it showed a dark box, because
 * the overlay's own layer isolated the blend from the canvas behind it.
 */
export const GroveLogo: React.FC<{ src: string; className?: string }> = ({ src, className = '' }) => (
  <div className={`relative aspect-[2.3/1] w-full select-none ${className}`}>
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <filter id="grove-logo-alpha" colorInterpolationFilters="sRGB">
        {/* RGB kept (slightly lifted); A = 3.2 * luma - 0.3 (clamped). */}
        <feColorMatrix
          type="matrix"
          values={'1.08 0 0 0 0  0 1.08 0 0 0  0 0 1.08 0 0  0.68 2.29 0.23 0 -0.3'}
        />
      </filter>
    </svg>
    <img
      src={src}
      alt="The Grove"
      draggable={false}
      className="grove-fade-in absolute inset-0 h-full w-full object-cover"
      style={{
        objectPosition: '50% 47%',
        filter: 'url(#grove-logo-alpha)',
        WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 62%, transparent 96%)',
        maskImage: 'radial-gradient(ellipse 60% 50% at 50% 50%, #000 62%, transparent 96%)',
      }}
    />
  </div>
);
