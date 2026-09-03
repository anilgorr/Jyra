# Running JYRA outside Replit

Everything Replit used to inject — the router that fronted `/api`, its managed
Clerk instance, its AI proxy, its Postgres — is replaced here by explicit local
pieces. One `.env` at the repo root feeds every process.

## Prerequisites (macOS)

```sh
brew install node@22 pnpm          # Node 22.x and pnpm 10.x
brew install --cask docker          # Docker Desktop, for Postgres
```

Open Docker Desktop once so the daemon is running.

## First-time setup

```sh
cd ~/projects/jyra
cp .env.example .env               # then fill in the keys below
pnpm install --frozen-lockfile
pnpm run db:up                     # Postgres 16 on localhost:5432 (db/user/pass: jyra)
pnpm run db:migrate                # baseline schema + integrity triggers + attempt columns
```

### Auth: local mode is the default for local dev

`.env.example` ships with `JYRA_AUTH_MODE=local` and `VITE_JYRA_AUTH_MODE=local`.
In this mode there is no sign-in and no Clerk at all: every API request runs
as one fixed identity (`local-dev-user`, override with `JYRA_LOCAL_USER_ID`),
the web app skips the sign-in/sign-up pages, the local developer counts as an
internal admin (`/admin/quality` works), and the sidebar footer shows a small
"Local auth mode" pill. The API logs a loud warning at boot.

Local mode cannot reach production: the API throws at boot if
`JYRA_AUTH_MODE=local` while `NODE_ENV=production` or `REPLIT_DEPLOYMENT=1`,
and `vite build` refuses a production bundle with `VITE_JYRA_AUTH_MODE=local`.
There is no override variable.

To run with real accounts, set both variables to `clerk` (or delete them —
`clerk` is the default when unset) and fill in the Clerk block. A production
bundle from a checkout whose `.env` still says `local` needs the override on
the command line: `VITE_JYRA_AUTH_MODE=clerk pnpm --dir artifacts/digisignal run build`.

### Keys you have to supply

| Variable | Where it comes from |
|---|---|
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` | Only when `JYRA_AUTH_MODE=clerk`. Your own Clerk application: dashboard.clerk.com → API Keys. Replit's Clerk was Replit-managed and does not follow you. `pk_test_`/`sk_test_` are correct for local dev; production refuses `pk_test_`. Enable Google as a sign-in provider if you want that button back. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | platform.openai.com. Base URL is already set to `https://api.openai.com/v1`. |
| `TAVILY_API_KEY`, `EXA_API_KEY`, `BRIGHTDATA_API_KEY` | Optional. The provider router skips any that are blank. |

Apify was reached through Replit's connectors SDK and is unavailable outside
Replit until the provider is re-pointed at Apify's HTTP API.

## Day to day

```sh
pnpm run dev            # API on :8080 and web on :5173, one Ctrl-C stops both
```

or in two terminals: `pnpm run dev:api` and `pnpm run dev:web`. Open
http://localhost:5173. Vite proxies `/api/*` to the API server, which is what
Replit's router did before.

`pnpm run db:down` stops Postgres; data persists in the `jyra_pgdata` volume.

## Schema changes

`pnpm --dir lib/db generate` writes a new SQL migration from the Drizzle schema;
`pnpm run db:migrate` applies it. This is the production path too:

```sh
DATABASE_URL=<prod> pnpm --dir lib/db migrate
```

`pnpm --dir lib/db push` (drizzle-kit push) still exists for fast iteration but
is fingerprint-locked to one approved development database. To approve your
local one: `pnpm --dir lib/db approve-dev-db`. It refuses non-localhost hosts.

## Verifying

```sh
pnpm run typecheck
pnpm run lint
pnpm run test:market-readiness
pnpm --dir artifacts/api-server run test:intelligence-v2-rules
pnpm --dir artifacts/api-server run test:security-guards
pnpm --dir artifacts/api-server run test:market-readiness-reliability
pnpm --dir lib/db test:migrations
```

`test:market-readiness-db`, `test:providers` and the `run-*` / `replay-*`
scripts need a live database and real provider keys.
