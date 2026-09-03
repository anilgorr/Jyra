#!/bin/sh
# Runs the API (Express, :8080) and the web app (Vite, :5173) together for
# local development outside Replit. Ctrl-C stops both.
set -e
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env at repo root. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

trap 'kill 0' INT TERM EXIT
pnpm --dir artifacts/api-server run dev &
pnpm --dir artifacts/digisignal run dev &
wait
