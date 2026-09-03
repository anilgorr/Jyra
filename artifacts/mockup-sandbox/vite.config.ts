import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

/**
 * Dev-server settings. PORT and BASE_PATH are only required when actually
 * serving (`vite`, `vite preview`); a plain `vite build` on a clean checkout
 * must not fail because they are missing.
 */
const DEFAULT_PORT = 5173;
const DEFAULT_BASE_PATH = "/";

function resolvePort(command: "build" | "serve"): number {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    if (command === "serve" && process.env.REPL_ID !== undefined) {
      throw new Error(
        "PORT environment variable is required but was not provided.",
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

export default defineConfig(async ({ command }) => {
  const port = resolvePort(command);
  const basePath = resolveBasePath();

  return {
    base: basePath,
    plugins: [
      mockupPreviewPlugin(),
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
