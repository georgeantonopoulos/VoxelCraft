import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Vite only bundles a worker when the call site is literally
 * `new Worker(new URL('./x.worker.ts', import.meta.url), ...)`. Any other form
 * works in `npm run dev` but ships the raw TypeScript as a data: URL in
 * production builds, so the worker never starts (no terrain at all).
 */
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return name === 'tests' ? [] : walk(path);
  return /\.(ts|tsx)$/.test(name) ? [path] : [];
});

describe('worker bundling', () => {
  it('every Worker is constructed with an inline new URL(..., import.meta.url)', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/new Worker\(([^)]*)/g)) {
        if (!/^\s*new URL\(\s*['"][^'"]+\.worker\.ts['"]\s*,\s*import\.meta\.url\s*$/.test(m[1])) {
          offenders.push(`${file}: new Worker(${m[1]})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
