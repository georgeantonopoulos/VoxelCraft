import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * three-custom-shader-material inlines the user's main() body at the start of
 * three's own main(). A `return;` there skips three's code: in a vertex shader
 * gl_Position is never written (stray triangles), in a fragment shader the
 * colour output is never written.
 */
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'tests' ? [] : walk(path);
  return /\.(ts|tsx)$/.test(name) ? [path] : [];
});

describe('CustomShaderMaterial shader rules', () => {
  it('no early return inside a CSM shader main()', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/`([^`]*csm_[^`]*)`/g)) {
        const body = m[1];
        const mainAt = body.search(/void\s+main\s*\(\s*\)/);
        if (mainAt < 0) continue;
        if (/\breturn\s*;/.test(body.slice(mainAt))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
