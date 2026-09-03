import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type UserConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

/**
 * Dev-server settings. PORT and BASE_PATH are only required when actually
 * serving (`vite`, `vite preview`); a plain `vite build` on a clean checkout
 * must not fail because they are missing.
 */
const DEFAULT_PORT = 5173;
const DEFAULT_BASE_PATH = '/';
const DEFAULT_API_PROXY_TARGET = 'http://localhost:8080';
const ON_REPLIT = process.env.REPL_ID !== undefined;

function resolvePort(command: 'build' | 'serve'): number {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    if (command === 'serve' && process.env.REPL_ID !== undefined) {
      throw new Error(
        'PORT environment variable is required but was not provided.',
      );
    }
    return DEFAULT_PORT;
  }
  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  return port;
}

function resolveBasePath(): string {
  return process.env.BASE_PATH || DEFAULT_BASE_PATH;
}

export default defineConfig(async ({ command }): Promise<UserConfig> => {
  const port = resolvePort(command);
  const basePath = resolveBasePath();

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss({ optimize: false }),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== 'production' &&
      process.env.REPL_ID !== undefined
        ? [
            await import('@replit/vite-plugin-cartographer').then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, '..'),
              }),
            ),
            await import('@replit/vite-plugin-dev-banner').then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        '@assets': path.resolve(
          import.meta.dirname,
          '..',
          '..',
          'attached_assets',
        ),
      },
      dedupe: ['react', 'react-dom'],
    },
    root: path.resolve(import.meta.dirname),
    // Outside Replit the whole workspace shares one .env at the repo root.
    envDir: path.resolve(import.meta.dirname, '..', '..'),
    build: {
      outDir: path.resolve(import.meta.dirname, 'dist/public'),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      allowedHosts: true,
      fs: {
        strict: true,
      },
      // On Replit a platform router sends /api to the API server. Outside Replit
      // the dev server proxies it to the locally running Express app instead.
      proxy: ON_REPLIT
        ? undefined
        : {
            '/api': {
              target: process.env.JYRA_API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET,
              changeOrigin: false,
            },
          },
    },
    preview: {
      port,
      host: '0.0.0.0',
      allowedHosts: true,
    },
  };
});
