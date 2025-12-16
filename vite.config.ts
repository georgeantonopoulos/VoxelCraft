import path from 'path';
import fs from 'node:fs/promises';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

type RightHandPosePayload = {
  kind: 'stick' | 'stone' | 'both';
  stick?: { xOffset?: number; y: number; z: number; scale: number; rotOffset?: { x: number; y: number; z: number } };
  stone?: { xOffset?: number; y: number; z: number; scale: number; rotOffset?: { x: number; y: number; z: number } };
};

const vcPoseWriterPlugin = (): Plugin => ({
  name: 'vc-pose-writer',
  configureServer(server) {
    server.middlewares.use('/__vc/held-item-poses', async (req, res, next) => {
      if (req.method !== 'POST') return next();

      try {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString('utf8');
        const body = JSON.parse(raw || '{}') as RightHandPosePayload;

        const filePath = path.resolve(process.cwd(), 'src/features/interaction/logic/HeldItemPoses.ts');
        let content = await fs.readFile(filePath, 'utf8');

        const fmt = (n: number, digits = 3): string => {
          const v = Number.isFinite(n) ? Number(n.toFixed(digits)) : 0;
          return String(v);
        };

        const formatPose = (pose: NonNullable<RightHandPosePayload['stick']>): string => {
          const xOffset = fmt(pose.xOffset ?? 0, 3);
          const y = fmt(pose.y, 3);
          const z = fmt(pose.z, 3);
          const scale = fmt(pose.scale, 3);
          const rx = fmt(pose.rotOffset?.x ?? 0, 4);
          const ry = fmt(pose.rotOffset?.y ?? 0, 4);
          const rz = fmt(pose.rotOffset?.z ?? 0, 4);
          return `{ xOffset: ${xOffset}, y: ${y}, z: ${z}, scale: ${scale}, rotOffset: { x: ${rx}, y: ${ry}, z: ${rz} } }`;
        };

        const replacePose = (key: 'stick' | 'stone', pose: NonNullable<RightHandPosePayload['stick']>) => {
          // Keep the file format stable: one entry per line.
          const re = new RegExp(`^\\s*${key}\\s*:\\s*\\{[^\\n]*\\}\\s*,?\\s*$`, 'm');
          if (!re.test(content)) throw new Error(`Could not find ${key} pose line in HeldItemPoses.ts`);
          const replacement = `  ${key}: ${formatPose(pose)}${key === 'stick' ? ',' : ''}`;
          content = content.replace(re, replacement);
        };

        if (body.kind === 'stick' || body.kind === 'both') {
          if (!body.stick) throw new Error('Missing stick payload');
          replacePose('stick', body.stick);
        }
        if (body.kind === 'stone' || body.kind === 'both') {
          if (!body.stone) throw new Error('Missing stone payload');
          replacePose('stone', body.stone);
        }

        // Safety net: keep the previous file contents so tuning mistakes are reversible.
        try {
          await fs.writeFile(`${filePath}.bak`, await fs.readFile(filePath, 'utf8'), 'utf8');
        } catch {
          // Best-effort backup; continue even if it fails.
        }

        await fs.writeFile(filePath, content, 'utf8');

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
      }
    });
  }
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      // Enable cross-origin isolation so workers can use SharedArrayBuffer for chunk voxel fields.
      // This avoids main-thread cloning/copying during frequent remeshes.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    preview: {
      // Keep preview consistent with dev for SharedArrayBuffer usage.
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    plugins: [react(), vcPoseWriterPlugin()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@core': path.resolve(__dirname, './src/core'),
        '@features': path.resolve(__dirname, './src/features'),
        '@ui': path.resolve(__dirname, './src/ui'),
        '@state': path.resolve(__dirname, './src/state'),
        '@utils': path.resolve(__dirname, './src/utils'),
        '@assets': path.resolve(__dirname, './src/assets'),
        '@': path.resolve(__dirname, './src'),
      }
    }
  };
});
