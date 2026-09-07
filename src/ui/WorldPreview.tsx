import React from 'react';
import { WorldType } from '@features/terrain/logic/BiomeManager';

const PALETTES: Record<WorldType, [string, string, string, string]> = {
  [WorldType.DEFAULT]: ['#9abdc1', '#718f84', '#3e6554', '#253f36'],
  [WorldType.SKY_ISLANDS]: ['#aac9d8', '#899dbc', '#657b91', '#425668'],
  [WorldType.FROZEN]: ['#cbdde2', '#a6bdcb', '#819aa9', '#546d7c'],
  [WorldType.LUSH]: ['#93b5a1', '#567e6c', '#305b45', '#1e3b30'],
  [WorldType.CHAOS]: ['#a4a1b9', '#82718f', '#5d536f', '#3f3b50'],
};

/** Small original landscape illustrations; no network assets or loading cost. */
export const WorldPreview: React.FC<{ type: WorldType }> = ({ type }) => {
  const colors = PALETTES[type];
  const floating = type === WorldType.SKY_ISLANDS;
  const snow = type === WorldType.FROZEN;
  return (
    <svg viewBox="0 0 260 210" aria-hidden="true" className="world-preview">
      <rect width="260" height="210" fill={colors[0]} />
      <circle cx="190" cy="48" r="23" fill="#f5e8c9" opacity=".85" />
      <path d="M-20 58 Q30 35 75 54 T155 50 M160 85 Q200 69 290 80" fill="none" stroke="#eef2e9" strokeWidth="7" opacity=".24" />
      <path d="M-20 130 38 60 90 120 149 42 225 119 280 78 V220 H-20Z" fill={colors[1]} />
      {snow && <path d="m18 84 20-24 34 39-24-9-10-11-9 12z m109-18 22-24 29 30-19-8-10-11-8 16z" fill="#eef2ee" />}
      <path d="M-20 160 Q30 104 80 138 T171 127 Q217 103 280 150 V220 H-20Z" fill={colors[2]} />
      {floating ? (
        <g>
          <path d="m12 110 58-8 34 13-44 53z m125-23 52-9 46 12-49 56z" fill={colors[3]} />
          <path d="m12 110 58-8 34 13-53 7z m125-23 52-9 46 12-49 7z" fill="#a5b5a6" />
          <path d="M56 120v45m128-68v63" stroke="#dbe9e8" strokeWidth="3" opacity=".8" />
        </g>
      ) : (
        <g fill={colors[3]}>
          <path d="M-10 202 Q40 148 94 178 T186 164 Q227 139 275 177 V220 H-10Z" />
          {[24, 48, 209, 232].map((x, i) => (
            <g key={x} transform={'translate(' + x + ' ' + (118 + i % 2 * 18) + ')'}>
              <path d="M-2 0H2V68H-2Z" />
              <path d="M0-27-17 11H-10L-24 33H24L10 11H17Z" />
            </g>
          ))}
        </g>
      )}
      <path d="M-5 206 Q65 183 115 197 T265 188" fill="none" stroke="#e4e6ce" strokeWidth="1" opacity=".22" />
    </svg>
  );
};
