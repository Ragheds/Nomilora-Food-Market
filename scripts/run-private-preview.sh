#!/bin/sh
# Development Run command. Does not deploy, migrate, seed or grant roles.
set -eu
cd "$(dirname "$0")/.."
npx --yes pnpm@11.25.0 build
exec node scripts/private-preview.mjs
