#!/usr/bin/env node
/**
 * Run the game in test mode in Chrome, wait until the scene is ready, run
 * steps, and save screenshots, state and errors to a folder.
 *
 *   npm run scene -- <scenario> [options] [steps...]
 *   npm run scene -- all        every scenario + a contact sheet (the smoke check)
 *   npm run scene -- --list
 *
 * World options (passed to ?test=...): --world W  --seed N  --at x,z  --yaw deg
 *   --pitch deg  --time hour|live  --weather clear|gathering|rain|clearing
 *   --hud normal|awake|hidden  --give saw,stick:3  --keep
 * Steps (run in the order given, after ready; `t` is window.__vcTest):
 *   --do "<js>"        e.g. --do "t.look(90, -10)"  --do "await t.key('KeyW', 800)"
 *   --shot <name>      screenshot now
 *   --wait <ms>
 *   --key <Code>[:ms]  a real key press (e.g. KeyQ, KeyW:1500, Digit3)
 *   --click left|right a real mouse press at the crosshair
 *   --fps <seconds>    measure frame rate
 *   --steps <file.json> an array of the same, e.g. [{"do":"..."},{"shot":"a"},{"wait":500}]
 * A final screenshot "final" is always taken.
 * Runner: --size 1280x720  --headed  --url http://localhost:3000 (use a running
 *   server; by default a fresh Vite is started on port 3100, since Vite's watcher
 *   misses edits on /Volumes)  --out <dir>  --timeout <s>  --keep-open (headed only)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3100;

// ---- arguments ----
const argv = process.argv.slice(2);
const opts = { scenario: 'meadow', query: {}, steps: [], size: [1280, 720], headed: false, url: null, out: null, timeout: 150, keepOpen: false, list: false };
const QUERY_KEYS = ['world', 'seed', 'at', 'yaw', 'pitch', 'time', 'weather', 'hud', 'give'];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    return v;
  };
  if (!a.startsWith('--')) { opts.scenario = a; continue; }
  const k = a.slice(2);
  if (QUERY_KEYS.includes(k)) opts.query[k] = next();
  else if (k === 'keep') opts.query.keep = '';
  else if (k === 'do') opts.steps.push({ do: next() });
  else if (k === 'shot') opts.steps.push({ shot: next() });
  else if (k === 'wait') opts.steps.push({ wait: Number(next()) });
  else if (k === 'key') opts.steps.push({ key: next() });
  else if (k === 'click') opts.steps.push({ click: next() });
  else if (k === 'fps') opts.steps.push({ fps: Number(next()) });
  else if (k === 'steps') opts.steps.push(...JSON.parse(await fs.readFile(next(), 'utf8')));
  else if (k === 'size') opts.size = next().split('x').map(Number);
  else if (k === 'headed') opts.headed = true;
  else if (k === 'keep-open') opts.keepOpen = true;
  else if (k === 'url') opts.url = next();
  else if (k === 'out') opts.out = next();
  else if (k === 'timeout') opts.timeout = Number(next());
  else if (k === 'list') opts.list = true;
  else throw new Error(`unknown option ${a}`);
}

// ---- dev server ----
const isUp = async (base) => {
  try { return (await fetch(base, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
};
let server = null;
let base = opts.url;
if (!base) {
  base = `http://localhost:${PORT}`;
  if (await isUp(base)) {
    console.error(`[scene] port ${PORT} is already serving; using it (stop it to get a fresh build)`);
  } else {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let log = '';
    server.stdout.on('data', (d) => { log += d; });
    server.stderr.on('data', (d) => { log += d; });
    const until = Date.now() + 60000;
    while (!(await isUp(base))) {
      if (Date.now() > until || server.exitCode != null) { console.error(log); throw new Error('Vite did not start'); }
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
const stopServer = () => {
  if (server && server.exitCode == null) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
};
process.on('exit', stopServer);
process.on('SIGINT', () => { stopServer(); process.exit(130); });

// ---- browser ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: !opts.headed,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
});

/** Load one scenario in a fresh page, run the steps, save shots/report/console to outDir. */
async function runScene(scenario, outDir, steps) {
  await fs.mkdir(outDir, { recursive: true });
  const params = new URLSearchParams({ test: scenario, ...opts.query });
  const url = `${base}/?${params.toString().replace(/=(?=&|$)/g, '')}`;
  const page = await browser.newPage({ viewport: { width: opts.size[0], height: opts.size[1] }, deviceScaleFactor: 1 });
  const consoleLines = [];
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

  const result = { scenario, url, outDir, ready: null, renderer: null, steps: [], shots: [], state: null, errors: [] };
  let shotIndex = 0;
  const shot = async (name) => {
    const file = path.join(outDir, `${String(++shotIndex).padStart(2, '0')}-${name.replace(/[^\w.-]+/g, '_')}.png`);
    await page.screenshot({ path: file });
    result.shots.push(path.relative(ROOT, file));
  };

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__vcTest, null, { timeout: 30000 });
    result.ready = await page.evaluate((ms) => Promise.race([
      window.__vcTest.ready(),
      new Promise((r) => setTimeout(() => r({ ok: false, failed: `not ready after ${ms / 1000}s`, state: window.__vcTest.state() }), ms)),
    ]), opts.timeout * 1000);
    result.renderer = await page.evaluate(() => {
      const gl = window.__three?.gl?.getContext();
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });

    if (result.ready.ok) {
      for (const step of steps) {
        const rec = { ...step };
        try {
          if (step.shot) await shot(step.shot);
          else if (step.wait) await page.waitForTimeout(step.wait);
          else if (step.fps) rec.value = await page.evaluate((sec) => window.__vcTest.fps(sec), step.fps);
          else if (step.key) {
            const [code, ms] = step.key.split(':');
            await page.keyboard.down(code);
            await page.waitForTimeout(Number(ms ?? 80));
            await page.keyboard.up(code);
          } else if (step.click) {
            const button = step.click === 'right' ? 'right' : 'left';
            await page.mouse.move(opts.size[0] / 2, opts.size[1] / 2);
            await page.mouse.down({ button });
            await page.waitForTimeout(60);
            await page.mouse.up({ button });
          } else if (step.do) {
            rec.value = await page.evaluate(async (src) => {
              const t = window.__vcTest;
              const body = /^\s*(await\s|return\s|const\s|let\s|for\s|if\s)/.test(src) || src.includes(';') ? src : `return (${src});`;
              // eslint-disable-next-line no-new-func
              const out = await new Function('t', `return (async () => { ${body} })();`)(t);
              try { return JSON.parse(JSON.stringify(out ?? null)); } catch { return String(out); }
            }, step.do);
          }
        } catch (e) {
          rec.error = e.message.split('\n')[0];
        }
        result.steps.push(rec);
      }
    }
    await shot('final');
    result.state = await page.evaluate(() => window.__vcTest.state());
    result.errors = await page.evaluate(() => window.__vcTest.errors());
  } catch (e) {
    result.failed = e.message.split('\n')[0];
    try { await shot('failure'); } catch { /* page gone */ }
  }

  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(result, null, 2));
  await fs.writeFile(path.join(outDir, 'console.log'), consoleLines.join('\n'));
  if (!(opts.headed && opts.keepOpen)) await page.close();
  return result;
}

const summarise = (result, verbose) => {
  const r = result.ready;
  return [
    `scene ${result.scenario}: ${r?.ok ? `ready in ${(r.ms / 1000).toFixed(1)}s` : `NOT READY (${r?.failed ?? result.failed})`}  seed ${r?.seed ?? '?'} ${r?.world ?? ''}`,
    verbose ? `renderer: ${result.renderer ?? 'unknown'}` : null,
    verbose && r?.player ? `player: ${r.player.x.toFixed(1)}, ${r.player.y.toFixed(1)}, ${r.player.z.toFixed(1)}` : null,
    ...result.steps.filter((s) => s.value !== undefined || s.error).map((s) => `step ${JSON.stringify(s.do ?? s.fps ?? s)} -> ${s.error ? `ERROR ${s.error}` : JSON.stringify(s.value)}`),
    `errors: ${result.errors.length}${result.errors.length ? '\n  ' + result.errors.slice(0, 8).map((e) => e.slice(0, 300)).join('\n  ') : ''}`,
    verbose ? `shots: ${result.shots.join('  ')}` : null,
    verbose ? `report: ${path.relative(ROOT, path.join(result.outDir, 'report.json'))}` : null,
  ].filter(Boolean).join('\n');
};

/** One image of every scenario's final shot (needs ffmpeg). */
const contactSheet = async (results, file) => {
  const shots = results.map((r) => r.shots[r.shots.length - 1]).filter(Boolean).map((f) => path.resolve(ROOT, f));
  if (!shots.length) return null;
  const cols = 3, w = 640, h = 360;
  const scaled = shots.map((_, i) => `[${i}]scale=${w}:${h}[s${i}]`).join(';');
  const layout = shots.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join('|');
  const filter = shots.length === 1 ? `[0]scale=${w}:${h}` : `${scaled};${shots.map((_, i) => `[s${i}]`).join('')}xstack=inputs=${shots.length}:layout=${layout}:fill=black`;
  return new Promise((resolve) => {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...shots.flatMap((f) => ['-i', f]), '-filter_complex', filter, file]);
    ff.on('error', () => resolve(null));
    ff.on('exit', (code) => resolve(code === 0 ? file : null));
  });
};

let exitCode = 0;
if (opts.list) {
  const page = await browser.newPage();
  await page.goto(`${base}/?test`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vcTest, null, { timeout: 30000 });
  for (const s of await page.evaluate(() => window.__vcTest.scenarios())) console.log(`${s.name.padEnd(12)} ${s.description}`);
} else if (opts.scenario === 'all') {
  // Every scenario, one after another in the same browser: the smoke check.
  const page = await browser.newPage();
  await page.goto(`${base}/?test`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vcTest, null, { timeout: 30000 });
  const names = (await page.evaluate(() => window.__vcTest.scenarios())).map((s) => s.name);
  await page.close();
  const root = path.resolve(ROOT, opts.out ?? `output/scenes/all-${stamp}`);
  const results = [];
  for (const name of names) {
    const res = await runScene(name, path.join(root, name), opts.steps);
    results.push(res);
    console.log(summarise(res, false));
    if (!res.ready?.ok || res.failed || res.errors.length) exitCode = 1;
  }
  const sheet = await contactSheet(results, path.join(root, 'sheet.png'));
  console.log(sheet ? `sheet: ${path.relative(ROOT, sheet)} (${names.join(', ')}; left to right, top to bottom)` : 'sheet: none (ffmpeg missing)');
} else {
  const res = await runScene(opts.scenario, path.resolve(ROOT, opts.out ?? `output/scenes/${opts.scenario}-${stamp}`), opts.steps);
  console.log(summarise(res, true));
  if (!res.ready?.ok || res.failed) exitCode = 1;
}

if (opts.headed && opts.keepOpen) {
  console.log('[scene] browser left open; Ctrl+C to quit');
  await new Promise(() => {});
}
await browser.close();
stopServer();
process.exit(exitCode);
