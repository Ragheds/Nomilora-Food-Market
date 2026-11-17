#!/bin/sh
# Replit development Run command. Does not deploy, migrate, seed or grant roles.
set -eu
cd "$(dirname "$0")/.."
npx --yes pnpm@11.25.0 build
export NODE_ENV=production
export PORT=8080
exec node --env-file-if-exists=.env --enable-source-maps artifacts/api-server/dist/index.mjs
