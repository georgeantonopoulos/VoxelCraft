import React from 'react';
import { ItemType, CustomTool } from '@/types';
import { useInventoryStore } from '@/state/InventoryStore';
import { getToolCapabilities } from '@features/interaction/logic/ToolCapabilities';

/**
 * Hand-drawn item icons in the Grove line style (same stroke language as the
 * realm glyphs on the title screen). Replaces one WebGL canvas per hotbar slot:
 * those rendered each item under its own lights, so icons never matched each
 * other (a neon flora blob next to a black shard) and cost a GL context each.
 */

const BARK = '#b08a5e';
const STONE = '#b9b6a6';
const FLINT = '#8fa3a8';
const LEAF = '#9dbd62';
const LUMINA = '#a4f2e4';
const EMBER = '#f2cf7c';
const FIBRE = '#d7c89a';

const common = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const Stick = () => (
  <g {...common} stroke={BARK} strokeWidth={2.2}>
    <path d="M8 25 L24 7" />
    <path d="M15 17.5 L11.5 13" strokeWidth={1.5} />
    <path d="M19.5 12.5 L22 14.5" strokeWidth={1.3} />
  </g>
);

const Stone = () => (
  <g {...common}>
    <path d="M7 20 C6 14, 11 9, 17 9 C23 9, 27 13, 26 19 C25 24, 19 26, 14 25 C10 24.5, 7.5 23, 7 20 Z" fill="rgba(185,182,166,0.18)" stroke={STONE} strokeWidth={1.6} />
    <path d="M12 14 C14 12.5, 17 12, 19.5 12.6" stroke={STONE} strokeWidth={1.1} opacity={0.7} />
    <path d="M18 21 C19.5 20.5, 21 19.5, 21.8 18" stroke={STONE} strokeWidth={1} opacity={0.5} />
  </g>
);

const Shard = () => (
  <g {...common}>
    <path d="M16 5 L22.5 15 L17.5 27 L10.5 16 Z" fill="rgba(143,163,168,0.22)" stroke={FLINT} strokeWidth={1.6} />
    <path d="M16 5 L16.5 17 L17.5 27 M10.5 16 L16.5 17 L22.5 15" stroke={FLINT} strokeWidth={1} opacity={0.6} />
  </g>
);

const Flora = () => (
  <g {...common}>
    <circle cx="16" cy="12" r="6.5" fill="rgba(164,242,228,0.16)" stroke="none" />
    <path d="M16 27 V14" stroke={LEAF} strokeWidth={1.6} />
    <path d="M16 21 C12 21, 9.5 18.5, 9.5 15.5 C13 15.5, 15.5 17.5, 16 20" stroke={LEAF} strokeWidth={1.4} />
    <path d="M16 18 C20 18, 22.5 15.5, 22.5 12.5 C19 12.5, 16.5 14.5, 16 17" stroke={LEAF} strokeWidth={1.4} />
    <circle cx="16" cy="11" r="3" fill={LUMINA} stroke="none" />
    <circle cx="16" cy="11" r="5" stroke={LUMINA} strokeWidth={0.8} opacity={0.5} />
  </g>
);

const Torch = () => (
  <g {...common}>
    <path d="M13 28 L17 13" stroke={BARK} strokeWidth={2.4} />
    <path d="M15.2 15.5 L19 16.5 M14.6 17.8 L18.4 18.8" stroke={FIBRE} strokeWidth={1.1} />
    <path d="M18 13 C14.5 11, 15 7.5, 17.5 4 C18 7, 21.5 8, 20.5 11.5 C20 12.8, 19 13.2, 18 13 Z" fill="rgba(242,207,124,0.35)" stroke={EMBER} strokeWidth={1.3} />
  </g>
);

const Fire = () => (
  <g {...common}>
    <path d="M8 26 L24 22 M9 22 L23 26" stroke={BARK} strokeWidth={2} />
    <path d="M16 21 C11 19, 12 13, 16 8 C16.5 12, 21 13, 20 17.5 C19.5 19.5, 18 21, 16 21 Z" fill="rgba(242,207,124,0.3)" stroke={EMBER} strokeWidth={1.4} />
  </g>
);

const Pickaxe = ({ head = FLINT }: { head?: string }) => (
  <g {...common}>
    <path d="M9 27 L21 11" stroke={BARK} strokeWidth={2.2} />
    <path d="M10 9 C14 6, 21 5.5, 26 9 L22 11.5 C19 10, 16 9.8, 12.5 11 Z" fill="rgba(143,163,168,0.2)" stroke={head} strokeWidth={1.5} />
    <path d="M19.5 12.5 L22.5 15" stroke={FIBRE} strokeWidth={1.1} />
  </g>
);

const Axe = ({ head = FLINT }: { head?: string }) => (
  <g {...common}>
    <path d="M10 27 L20 8" stroke={BARK} strokeWidth={2.2} />
    <path d="M18 10 C21 7, 25.5 8, 26.5 11.5 C27.2 14.5, 25 17.5, 21.5 17 L17 13.2 Z" fill="rgba(143,163,168,0.2)" stroke={head} strokeWidth={1.5} />
    <path d="M16.2 13.8 L18.8 15.4" stroke={FIBRE} strokeWidth={1.1} />
  </g>
);

/** Crafted tool: a stick with small marks for what is bound to it. */
const Crafted = ({ tool }: { tool: CustomTool }) => {
  const parts = Object.values(tool.attachments);
  const shards = parts.filter((p) => p === ItemType.SHARD).length;
  const stones = parts.filter((p) => p === ItemType.STONE).length;
  const flora = parts.filter((p) => p === ItemType.FLORA).length;
  // The icon follows what the tool does (same rules as its name).
  const caps = getToolCapabilities(tool);
  const head = flora ? LUMINA : FLINT;
  if (caps.canSaw && !caps.canDig && !caps.canChop) {
    return (
      <g {...common}>
        <path d="M8 27 L21 8" stroke={BARK} strokeWidth={2.2} />
        <path d="M13.5 20 L10 18.5 L15 16.5 L11.5 15 L16.5 13 L13 11.5 L18 9.5" fill="none" stroke={head} strokeWidth={1.3} />
      </g>
    );
  }
  if (caps.canDig) return <Pickaxe head={head} />;
  if (caps.canChop) return <Axe head={head} />;
  if (shards > 0 && !stones) {
    return (
      <g {...common}>
        <path d="M9 27 L21 9" stroke={BARK} strokeWidth={2.2} />
        <path d="M21 9 L25.5 3.5 L23.5 10 Z" fill="rgba(143,163,168,0.25)" stroke={head} strokeWidth={1.3} />
        <path d="M18.5 12.5 L21 14.5" stroke={FIBRE} strokeWidth={1.1} />
      </g>
    );
  }
  return (
    <g {...common}>
      <path d="M9 27 L22 8" stroke={BARK} strokeWidth={2.2} />
      {stones > 0 && <path d="M18.5 7 C21 5.5, 25 7, 24.5 10.5 C24 13, 20.5 13.5, 19 11.5 C17.8 10, 17.5 8, 18.5 7 Z" fill="rgba(185,182,166,0.2)" stroke={STONE} strokeWidth={1.4} />}
      {flora > 0 && <circle cx="21.5" cy="9.5" r={stones ? 1.6 : 3} fill={LUMINA} stroke="none" />}
      <path d="M17.5 13.5 L20 15" stroke={FIBRE} strokeWidth={1.1} />
    </g>
  );
};

export const ItemGlyph: React.FC<{ item: ItemType | string; className?: string }> = ({ item, className = 'h-8 w-8' }) => {
  const customTools = useInventoryStore((s) => s.customTools);
  let body: React.ReactNode = null;
  if (typeof item === 'string' && item.startsWith('tool_')) {
    const tool = customTools[item];
    body = tool ? <Crafted tool={tool} /> : null;
  } else {
    switch (item) {
      case ItemType.STICK: body = <Stick />; break;
      case ItemType.STONE: body = <Stone />; break;
      case ItemType.SHARD: body = <Shard />; break;
      case ItemType.FLORA: body = <Flora />; break;
      case ItemType.TORCH: body = <Torch />; break;
      case ItemType.FIRE: body = <Fire />; break;
      case ItemType.PICKAXE: body = <Pickaxe />; break;
      case ItemType.AXE: body = <Axe />; break;
    }
  }
  if (!body) return null;
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.6))' }}>
      {body}
    </svg>
  );
};
