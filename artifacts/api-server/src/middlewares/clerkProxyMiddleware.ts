/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import type { IncomingHttpHeaders } from 'http';
import type { RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const CLERK_FAPI = 'https://frontend-api.clerk.dev';
export const CLERK_PROXY_PATH = '/api/__clerk';

/**
 * Hosts this deployment is allowed to serve. Built from `JYRA_ALLOWED_HOSTS`
 * (comma-separated hostnames, optional port) plus the Replit-provided domain
 * environment variables when present. Matching is exact on the lowercase
 * host; a leading `*.` entry allows any subdomain of that domain.
 *
 * When the list is empty (local development without any of these variables)
 * every host is accepted, which keeps `pnpm dev` working — but production
 * deployments must configure it so a spoofed `X-Forwarded-Host` cannot select
 * the Clerk publishable key or pass the origin check.
 */
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const values: string[] = [];
  const push = (raw: string | undefined) => {
    for (const entry of (raw ?? '').split(',')) {
      const host = entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (host) values.push(host);
    }
  };
  push(env.JYRA_ALLOWED_HOSTS);
  push(env.REPLIT_DOMAINS);
  push(env.REPLIT_DEV_DOMAIN);
  return [...new Set(values)];
}

function hostWithoutPort(host: string): string {
  return host.replace(/:\d+$/, '');
}

export function isAllowedHost(host: string | undefined, allowed = allowedHostsFromEnv()): boolean {
  if (!host) return false;
  if (allowed.length === 0) return true;
  const candidate = host.trim().toLowerCase();
  const bare = hostWithoutPort(candidate);
  return allowed.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);
      return bare.endsWith(suffix) && bare.length > suffix.length;
    }
    return entry === candidate || entry === bare || hostWithoutPort(entry) === bare;
  });
}

/**
 * Returns the effective public hostname for the given request.
 *
 * `x-forwarded-host` is only honoured when the request came through a trusted
 * proxy (`trust proxy` is enabled in app.ts) AND the value is on the host
 * allowlist; otherwise the raw `Host` header is used. Any host that is not on
 * the allowlist yields `undefined`, so callers (the CORS origin check and the
 * Clerk publishable-key resolver) fail closed instead of trusting a spoofed
 * header. Exported so that app.ts and this proxy middleware agree on which
 * hostname is canonical.
 */
export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}, allowed = allowedHostsFromEnv()): string | undefined {
  const forwarded = req.headers['x-forwarded-host'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(',')[0]?.trim();
  if (firstHop && isAllowedHost(firstHop, allowed)) return firstHop;
  const host = req.headers.host?.trim();
  if (host && isAllowedHost(host, allowed)) return host;
  return undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (process.env.NODE_ENV !== 'production') {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  return createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    // Take over the response so it can be re-sent with a Content-Length (see
    // proxyRes); the deployment edge rejects chunked proxied responses.
    selfHandleResponse: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ''),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers['x-forwarded-proto'] || 'https';
        const host = getClerkProxyHost(req) || '';
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader('Clerk-Proxy-Url', proxyUrl);
        proxyReq.setHeader('Clerk-Secret-Key', secretKey);

        const xff = req.headers['x-forwarded-for'];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() ||
          req.socket?.remoteAddress ||
          '';
        if (clientIp) {
          proxyReq.setHeader('X-Forwarded-For', clientIp);
        }
      },
      // Clerk's dynamic Frontend API responses (/v1/environment, /v1/client,
      // JWKS, ...) arrive without a Content-Length, so relaying them would use
      // Transfer-Encoding: chunked — which the deployment edge (Cloud Run)
      // rejects, turning the app's 200 into a 500. Buffer only those so they can
      // be re-sent with a Content-Length; the body is forwarded untouched so
      // Content-Encoding is preserved. Length-known responses (e.g. /npm/*
      // assets) and body-less responses stream through without buffering.
      proxyRes: (proxyRes, req, res) => {
        const headers = { ...proxyRes.headers };
        // Transfer-Encoding/Connection are hop-by-hop (RFC 7230 §6.1).
        delete headers['transfer-encoding'];
        delete headers['connection'];
        delete headers['keep-alive'];

        const status = proxyRes.statusCode ?? 502;
        // Content-Length is forbidden on 1xx/204; HEAD/304 may keep theirs.
        if (status < 200 || status === 204) {
          delete headers['content-length'];
        }

        const bodyless =
          req.method === 'HEAD' ||
          status < 200 ||
          status === 204 ||
          status === 304;
        if (headers['content-length'] !== undefined || bodyless) {
          res.writeHead(status, headers);
          // Headers are already sent, so abort the response if the upstream
          // stream errors mid-pipe (e.g. ECONNRESET) rather than leaving an
          // unhandled 'error' or a hung client.
          proxyRes.on('error', () => res.destroy());
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          headers['content-length'] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
        });
        proxyRes.on('error', () => {
          if (!res.headersSent) {
            // Set a length so the empty 502 isn't sent chunked (which the
            // deployment edge would reject just like the original response).
            res.writeHead(502, { 'content-length': '0' });
          }
          res.end();
        });
      },
    },
  }) as RequestHandler;
}
