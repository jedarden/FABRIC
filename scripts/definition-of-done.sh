#!/usr/bin/env bash
# FABRIC definition of done: type-check, build, the full unit suite, and the
# coverage threshold gate.
#
# Runnable in a clean `git archive` extraction — installs dependencies when
# node_modules is missing — so NEEDLE's close gate can re-run it verbatim.
# The unit suites spawn the compiled CLI (node dist/cli.js); a clean
# extraction has no dist/ until the build emits it, so build before the
# suite. `--fast` scopes the suite to the alert-policy test files and skips
# the instrumented coverage run. Exit 0 means done.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  npm ci --no-audit --no-fund
fi

npx tsc --noEmit
npm run build

if [ "${1:-}" = "--fast" ]; then
  exec npx vitest run \
    src/alertManager.test.ts \
    src/alertManager.contract.test.ts \
    src/alertBeadFiler.test.ts \
    src/store.alerts.integration.test.ts \
    src/alertDurability.test.ts
fi

npx vitest run
exec npm run test:coverage
