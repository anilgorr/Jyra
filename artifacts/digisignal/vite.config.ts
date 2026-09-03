import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv, type UserConfig } from 'vite';

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

const ENV_DIR = path.resolve(import.meta.dirname, '..', '..');

/**
 * Local auth mode (VITE_JYRA_AUTH_MODE=local) has no sign-in and must never be
 * shipped: refuse a production build outright. src/lib/auth/mode.ts repeats the
 * check at runtime for any bundle that slips past this one.
 */
function assertAuthModeAllowed(command: 'build' | 'serve', mode: string): void {
  const env = { ...loadEnv(mode, ENV_DIR, 'VITE_'), ...process.env };
  const authMode = (env.VITE_JYRA_AUTH_MODE ?? '').trim().toLowerCase();
  if (command === 'build' && mode === 'production' && authMode === 'local') {
    throw new Error(
      'VITE_JYRA_AUTH_MODE=local is forbidden in a production build: local auth mode has no sign-in. ' +
        'Unset it (or set "clerk") and build again.',
    );
  }
}

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  assertAuthModeAllowed(command, mode);
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
    envDir: ENV_DIR,
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
