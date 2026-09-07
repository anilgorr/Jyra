# Deploying JYRA (Render API + Supabase DB + Vercel web + Clerk auth)

## Status
- **Supabase**: JYRA project provisioned (org Digipuush, region ap-southeast-1, ref `ffikwanfkezebuxduxli`). Empty — migrations run automatically on the first Render deploy (`preDeployCommand`).
- **render.yaml**: committed (API service blueprint) on branch `audit/production-fixes`.

## One-time prerequisites (yours)
1. **Push the branch** so Render/GitHub can see it (needs your git credentials):
   `git push origin audit/production-fixes`
2. **Create a free Clerk app** at dashboard.clerk.com → API Keys. Copy the **Publishable key** (pk_…) and **Secret key** (sk_…).
3. **Supabase DB URL**: Supabase dashboard → JYRA project → Connect → "Session pooler" (port 5432) URI. That is `DATABASE_URL`.

## Render (API)
- New → **Blueprint** → pick the `anilgorr/Jyra` repo → set branch **`audit/production-fixes`** (the render.yaml lives there, not on `main`).
- When prompted, fill the `sync:false` env vars:
  - `DATABASE_URL` = Supabase session-pooler URI
  - `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` = from Clerk
  - `AI_INTEGRATIONS_OPENAI_API_KEY` (+ `AI_INTEGRATIONS_OPENAI_BASE_URL` if you use one)
  - `EXPLEE_API_KEY`, `TAVILY_API_KEY`, `EXA_API_KEY`, `BRIGHTDATA_API_KEY`
- Deploy. `preDeployCommand` runs the DB migrations; health check is `/api/healthz`.
- After it's live, add `JYRA_ALLOWED_HOSTS` = your Render host (e.g. `jyra-api.onrender.com`) and the web host, then redeploy.

## Web (Vercel)
- Import `anilgorr/Jyra`, root `artifacts/digisignal`, build `pnpm build`, output `dist`.
- Env: `VITE_CLERK_PUBLISHABLE_KEY` = Clerk pk_… (leave `VITE_JYRA_AUTH_MODE` unset so it uses Clerk).
- Add a `vercel.json` rewrite so the browser stays same-origin:
  `{ "rewrites": [ { "source": "/api/:path*", "destination": "https://<render-host>/api/:path*" } ] }`

## Known follow-ups (productionization)
- The V2 engine and provider seeds are gated to `NODE_ENV=development` in code — that's why the blueprint runs the API in development mode (secured by Clerk). Proper `NODE_ENV=production` support (ungate V2 in `routes/intelligence-v2.ts` `enabled()`, and run the `ensureDevelopment*Provider` seeds in production) is the main hardening task before a public launch.
- Free Render web services cold-start after inactivity.
