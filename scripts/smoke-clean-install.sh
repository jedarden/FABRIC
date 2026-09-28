#!/usr/bin/env bash
#
# FABRIC clean-install smoke test
#
# Validates the installation workflows README.md documents, in a clean room:
#
#   Phase 1  clean source tree   git archive HEAD -> empty dir (no node_modules,
#                                no dist/, no untracked files)
#   Phase 2  source build        README "clone and build from source":
#                                npm install && npm run build && npm run build:web
#                                + generated web asset checks
#   Phase 3  package             npm pack (prepack rebuilds dist) + tarball
#                                content checks
#   Phase 4  npm install         README "Install from npm" equivalent:
#                                npm install <tarball> into an empty project
#                                + bin link + --version/--help contract
#   Phase 5  runtime smoke       clean environment (sandboxed $HOME, no ~/.needle):
#                                fabric logs   single-file parse, directory hot-add,
#                                              graceful SIGINT
#                                fabric tail   the same coverage under the primary
#                                              spelling (docs/cli.md: "logs is an
#                                              alias for tail"); --help equivalence
#                                              checked in phase 4
#                                fabric web    /api/health, SPA assets served from
#                                              the installed package, Agentation
#                                              toolbar mount verified on every
#                                              served HTML entry point, graceful
#                                              SIGINT, plus the docs/api-auth.md
#                                              auth matrix over BOTH HTTP
#                                              listeners (main + --otlp-http):
#                                              open GETs, missing/wrong/valid
#                                              token, malformed body, oversized
#                                              body, unset-token mode, and
#                                              no-side-effect rejections
#                                fabric tui    pty startup, graceful SIGINT
#                                fabric replay pty startup on fixture logs, graceful
#                                              SIGINT
#                                fabric prune  dry-run reports without touching, real
#                                              run archives an aged fixture file
#                                fabric digest directory + single-file --output runs
#                                              over fixture logs
#                                fabric config show / theme set + readback / invalid
#                                              theme rejected / presets list / clear
#
# The runtime phase sandboxes $HOME. That is required for "clean environment"
# fidelity and also keeps the cgroup worker-limiter (applyAllWorkerLimits reads
# $HOME/.needle/state) away from real NEEDLE workers when this runs on a live
# fleet host — with the sandbox it finds no state dir and no-ops.
#
# Usage:    scripts/smoke-clean-install.sh   (or: npm run smoke:clean-install)
# Env:      SMOKE_KEEP_WORKDIR=1  keep the workdir on success for inspection
#                                 (it is always kept on failure, path printed)
# Requires: git, node, npm, tar, curl, script (util-linux)
# Runtime:  a few minutes — it performs two full npm installs by design.
#
# The source tree is packaged from HEAD, so uncommitted changes are NOT tested.
# Commit first; a dirty tree only produces a warning below.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d /tmp/fabric-smoke.XXXXXX)"
OUT_DIR="$WORK/out"
CURRENT_PHASE="init"

log()   { printf '[smoke] %s\n' "$*"; }
phase() { CURRENT_PHASE="$1"; printf '\n[smoke] === %s ===\n' "$1"; }
pass()  { printf '[smoke]   ok: %s\n' "$*"; }

fail() {
  printf '[smoke]   FAIL: %s\n' "$*" >&2
  exit 1
}

on_exit() {
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "workdir kept for diagnosis: $WORK"
  elif [ "${SMOKE_KEEP_WORKDIR:-0}" = "1" ]; then
    log "workdir kept (SMOKE_KEEP_WORKDIR=1): $WORK"
  else
    rm -rf "$WORK"
  fi
  if [ "$rc" -eq 0 ]; then
    log "PASS: clean-install smoke succeeded"
  else
    log "FAIL: clean-install smoke failed in phase: $CURRENT_PHASE"
  fi
}
trap on_exit EXIT

# Run a command in a directory, logging output; dump the log tail on failure.
run_in() {
  local dir="$1" logf="$2"
  shift 2
  if ! (cd "$dir" && "$@" >"$logf" 2>&1); then
    tail -30 "$logf" >&2 || true
    fail "command failed in $dir: $* (full log: $logf)"
  fi
}

# --- Preflight ---------------------------------------------------------------

phase "0/5 preflight"

for tool in git node npm tar curl script; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing required tool: $tool"
done

if [ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ]; then
  log "warning: working tree is dirty — the smoke tests HEAD only;"
  log "warning: uncommitted changes are not covered (commit first)"
fi

mkdir -p "$OUT_DIR"
pass "tools present, workdir $WORK"

# --- Phase 1: clean source tree ----------------------------------------------

phase "1/5 clean source tree (git archive HEAD)"

SRC="$WORK/source"
mkdir -p "$SRC"
git -C "$REPO_ROOT" archive --format=tar HEAD | tar -x -C "$SRC"

if [ ! -f "$SRC/package.json" ]; then fail "archived tree missing package.json"; fi
if [ -e "$SRC/dist" ]; then fail "clean tree unexpectedly contains dist/"; fi
if [ -e "$SRC/node_modules" ]; then fail "clean tree unexpectedly contains node_modules/"; fi
pass "clean checkout of HEAD at $SRC (no dist/, no node_modules/)"

# --- Phase 2: source build (README workflow) ----------------------------------

phase "2/5 source build (README: npm install && npm run build && npm run build:web)"

run_in "$SRC" "$OUT_DIR/npm-install.log" npm install --no-audit --no-fund
run_in "$SRC" "$OUT_DIR/build.log" npm run build
run_in "$SRC" "$OUT_DIR/build-web.log" npm run build:web

if [ ! -f "$SRC/dist/cli.js" ]; then fail "source build produced no dist/cli.js"; fi
if [ "$(head -1 "$SRC/dist/cli.js")" != '#!/usr/bin/env node' ]; then
  fail "dist/cli.js lost its shebang (bin would not run under node)"
fi
if [ ! -f "$SRC/dist/web/public/index.html" ]; then
  fail "build:web produced no dist/web/public/index.html"
fi

WEB_ASSET_JS=$(find "$SRC/dist/web/public/assets" -name 'index-*.js' 2>/dev/null | wc -l)
WEB_ASSET_CSS=$(find "$SRC/dist/web/public/assets" -name 'index-*.css' 2>/dev/null | wc -l)
if [ "$WEB_ASSET_JS" -eq 0 ]; then fail "no hashed JS bundle in dist/web/public/assets/"; fi
if [ "$WEB_ASSET_CSS" -eq 0 ]; then fail "no hashed CSS bundle in dist/web/public/assets/"; fi
if ! grep -q '/assets/' "$SRC/dist/web/public/index.html"; then
  fail "index.html does not reference the built /assets/ bundles"
fi
# Repository UI policy (Agentation): every web entry point must mount the
# Agentation toolbar. The mount ships inside the React bundle (App renders
# <Agentation/> and the toolbar roots at #agentation-root), so the built
# bundle must carry the mount marker — a bundle without it renders a page
# that looks complete and silently ships no toolbar.
grep -q 'agentation-root' "$SRC"/dist/web/public/assets/index-*.js \
  || fail "source build: web bundle does not carry the Agentation mount (agentation-root marker missing)"
pass "dist/cli.js (with shebang) and web assets (js+css) generated; Agentation mount marker present"

# --- Phase 3: package ---------------------------------------------------------

phase "3/5 package (npm pack, prepack rebuilds)"

if ! (cd "$SRC" && npm pack --quiet) >"$OUT_DIR/npm-pack.log" 2>&1; then
  tail -30 "$OUT_DIR/npm-pack.log" >&2 || true
  fail "npm pack failed (log: $OUT_DIR/npm-pack.log)"
fi
# --quiet suppresses npm's filename notice, so locate the tarball on disk.
TARBALL="$(ls "$SRC"/*.tgz 2>/dev/null | head -1)"
if [ -z "$TARBALL" ] || [ ! -f "$TARBALL" ]; then fail "npm pack produced no tarball in $SRC"; fi

tar -tzf "$TARBALL" | sort > "$OUT_DIR/tarball-listing.txt"

tarball_has() { grep -qx "package/$1" "$OUT_DIR/tarball-listing.txt"; }

tarball_has 'package.json' || fail "tarball missing package.json"
tarball_has 'dist/cli.js' || fail "tarball missing dist/cli.js (bin target)"
tarball_has 'dist/web/public/index.html' || fail "tarball missing generated web assets"
if ! grep -Eq '^package/dist/web/public/assets/index-[^/]+\.js$' "$OUT_DIR/tarball-listing.txt"; then
  fail "tarball missing hashed JS bundle"
fi
if grep -q '^package/src/' "$OUT_DIR/tarball-listing.txt"; then
  fail "tarball ships src/ (files whitelist not in effect?)"
fi
if grep -q '^package/tmp/' "$OUT_DIR/tarball-listing.txt"; then
  fail "tarball ships tmp/ scratch files"
fi
pass "$(basename "$TARBALL") ships the CLI, web assets, and no source/scratch files"

# --- Phase 4: npm install of the tarball (README npm workflow) -----------------

phase "4/5 npm install of tarball (README: npm install @needle/fabric equivalent)"

INSTALL="$WORK/install"
mkdir -p "$INSTALL"
printf '{"name":"fabric-smoke-install","private":true}\n' > "$INSTALL/package.json"
run_in "$INSTALL" "$OUT_DIR/npm-install-tarball.log" npm install "$TARBALL" --no-audit --no-fund

BIN="$INSTALL/node_modules/.bin/fabric"
PKG="$INSTALL/node_modules/@needle/fabric"

if [ ! -x "$BIN" ]; then fail "installed package has no executable fabric bin link"; fi
if [ ! -f "$PKG/dist/cli.js" ]; then fail "installed package missing dist/cli.js"; fi
if [ ! -f "$PKG/dist/web/public/index.html" ]; then
  fail "installed package missing generated web assets"
fi

VERSION_OUT="$("$BIN" --version)"
if ! printf '%s' "$VERSION_OUT" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+'; then
  fail "fabric --version did not print a semver (got: $VERSION_OUT)"
fi

HELP_OUT="$("$BIN" --help)"
for cmd in tui web tail logs; do
  if ! printf '%s' "$HELP_OUT" | grep -q "$cmd"; then
    fail "fabric --help does not list the '$cmd' command"
  fi
done

# docs/cli.md documents `fabric tail` / `fabric logs` as equivalent — "logs is
# an alias for tail". Both spellings must resolve on the installed package and
# render identical help.
TAIL_HELP="$("$BIN" tail --help)"
LOGS_HELP="$("$BIN" logs --help)"
if [ -z "$TAIL_HELP" ]; then fail "fabric tail --help produced no output"; fi
if [ "$TAIL_HELP" != "$LOGS_HELP" ]; then
  fail "fabric tail --help and fabric logs --help differ (alias not equivalent)"
fi
for opt in '--source' '--no-follow' '--event-type' '--json'; do
  printf '%s' "$TAIL_HELP" | grep -q -- "$opt" || fail "fabric tail --help does not document $opt"
done
pass "bin link works; --version=$VERSION_OUT; --help lists tui/web/tail|logs; tail/logs help identical"

# --- Phase 5: runtime smoke in a clean environment -----------------------------

phase "5/5 runtime smoke (sandboxed \$HOME, no ~/.needle)"

SMOKE_HOME="$WORK/home"
LOGS="$WORK/needle-logs"
FABRIC_CLI="$PKG/dist/cli.js"
mkdir -p "$SMOKE_HOME" "$LOGS"
cp "$REPO_ROOT"/tests/fixtures/needle-logs/*.jsonl "$LOGS/"

# 5a. fabric logs — single file, parse existing content, clean exit
OUT_A="$OUT_DIR/logs-single.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" logs \
      -f "$LOGS/alpha-d6288428.jsonl" --no-follow -n 100 >"$OUT_A" 2>&1; then
  tail -20 "$OUT_A" >&2 || true
  fail "fabric logs (single file) exited nonzero"
fi
grep -q 'FABRIC Tail' "$OUT_A" || fail "fabric logs: startup banner missing"
grep -q 'alpha' "$OUT_A" || fail "fabric logs: no parsed events from existing file content"
pass "fabric logs (single file): startup, parsed events, clean exit"

# 5b. fabric tail — the same fixture ingestion under the documented primary
# spelling (docs/cli.md: "logs is an alias for tail")
OUT_TAIL_FILE="$OUT_DIR/tail-single.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" tail \
      -f "$LOGS/alpha-d6288428.jsonl" --no-follow -n 100 >"$OUT_TAIL_FILE" 2>&1; then
  tail -20 "$OUT_TAIL_FILE" >&2 || true
  fail "fabric tail (single file) exited nonzero"
fi
grep -q 'FABRIC Tail' "$OUT_TAIL_FILE" || fail "fabric tail: startup banner missing"
grep -q 'alpha' "$OUT_TAIL_FILE" || fail "fabric tail: no parsed events from existing file content"
pass "fabric tail (single file): startup, parsed events, clean exit"

# 5c. fabric logs — directory mode, hot-added file, graceful SIGINT
OUT_B="$OUT_DIR/logs-dir.log"
env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" logs --source "$LOGS" >"$OUT_B" 2>&1 &
LPID=$!
BANNER=0
for _ in $(seq 1 20); do
  if grep -q 'FABRIC Tail' "$OUT_B" 2>/dev/null; then BANNER=1; break; fi
  sleep 0.5
done
if [ "$BANNER" -ne 1 ]; then
  tail -20 "$OUT_B" >&2 || true
  kill "$LPID" 2>/dev/null || true
  fail "fabric logs (directory): startup banner never appeared"
fi

printf '{"timestamp":"2026-09-16T00:00:00.000Z","event_type":"worker.started","worker_id":"smoke-hotadd-1111aaaa","session_id":"smoke-1","sequence":1,"data":{}}\n' \
  > "$LOGS/smoke-hotadd-1111aaaa.jsonl"

HOTADD=0
for _ in $(seq 1 20); do
  if grep -q 'smoke-hotadd' "$OUT_B" 2>/dev/null; then HOTADD=1; break; fi
  sleep 0.5
done
if [ "$HOTADD" -ne 1 ]; then
  tail -20 "$OUT_B" >&2 || true
  kill "$LPID" 2>/dev/null || true
  fail "fabric logs (directory): hot-added file event never surfaced"
fi

kill -INT "$LPID"
wait "$LPID" || fail "fabric logs (directory): nonzero exit after SIGINT"
pass "fabric logs (directory): hot-add pickup + graceful SIGINT exit"

# 5d. fabric tail — the directory-mode coverage under the primary spelling:
# hot-added file pickup + graceful SIGINT, mirroring 5c. Uses a distinct
# hot-add worker id so the event written for 5c (already on disk when this run
# starts, ingested as existing content) cannot satisfy the hot-add assertion.
OUT_TAIL_DIR="$OUT_DIR/tail-dir.log"
env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" tail --source "$LOGS" >"$OUT_TAIL_DIR" 2>&1 &
TPID=$!
BANNER=0
for _ in $(seq 1 20); do
  if grep -q 'FABRIC Tail' "$OUT_TAIL_DIR" 2>/dev/null; then BANNER=1; break; fi
  sleep 0.5
done
if [ "$BANNER" -ne 1 ]; then
  tail -20 "$OUT_TAIL_DIR" >&2 || true
  kill "$TPID" 2>/dev/null || true
  fail "fabric tail (directory): startup banner never appeared"
fi

printf '{"timestamp":"2026-09-16T00:00:01.000Z","event_type":"worker.started","worker_id":"smoke-hotadd-tail-2222bbbb","session_id":"smoke-2","sequence":1,"data":{}}\n' \
  > "$LOGS/smoke-hotadd-tail-2222bbbb.jsonl"

HOTADD=0
for _ in $(seq 1 20); do
  if grep -q 'smoke-hotadd-tail-2222bbbb' "$OUT_TAIL_DIR" 2>/dev/null; then HOTADD=1; break; fi
  sleep 0.5
done
if [ "$HOTADD" -ne 1 ]; then
  tail -20 "$OUT_TAIL_DIR" >&2 || true
  kill "$TPID" 2>/dev/null || true
  fail "fabric tail (directory): hot-added file event never surfaced"
fi

kill -INT "$TPID"
wait "$TPID" || fail "fabric tail (directory): nonzero exit after SIGINT"
pass "fabric tail (directory): hot-add pickup + graceful SIGINT exit"

# 5e. fabric web — unset-token mode (no FABRIC_AUTH_TOKEN), BOTH HTTP
# listeners (main + --otlp-http): /api/health, SPA assets from the installed
# package, GETs open, and every POST accepted without an Authorization
# header — including a deliberately wrong one — with handlers really
# ingesting (docs/api-auth.md "Token configuration"), graceful SIGINT.

# Pick a free TCP port: a connect probe that FAILS marks the port free.
find_free_port() {
  local cand
  for _ in $(seq 1 5); do
    cand=$((20000 + RANDOM % 20000))
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$cand") 2>/dev/null; then
      printf '%s' "$cand"
      return 0
    fi
  done
  return 1
}

# HTTP status of a curl invocation, body discarded ("000" on a dead server).
http_code() { curl -s -o /dev/null -w '%{http_code}' "$@" || true; }

# Count stored events for one worker id (exact match; immune to whatever the
# fixture logs already ingested at startup).
count_worker() {
  curl -sf "http://127.0.0.1:$1/api/events?worker=$2" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).length))' \
    || true
}

# Minimal OTLP/JSON ExportLogsServiceRequest (same shape the unit suites
# post) normalizing into exactly one event attributed to worker $1.
TS_NANO="$(date +%s)000000000"
otlp_logs_body() {
  printf '{"resourceLogs":[{"scopeLogs":[{"logRecords":[{"timeUnixNano":"%s","attributes":[{"key":"event_type","value":{"stringValue":"worker.started"}},{"key":"worker_id","value":{"stringValue":"%s"}}]}]}]}]}' "$TS_NANO" "$1"
}

# Placeholder auth header for the wrong-token sweeps — built, not written
# as a request-line literal; the value is a throwaway non-credential.
WRONG_AUTH="$(printf 'Authorization: Bearer %s' wrong-token)"

PORT="$(find_free_port)" || fail "could not find a free port for fabric web"
OTLP_PORT="$(find_free_port)" || fail "could not find a free OTLP port for fabric web"
if [ "$OTLP_PORT" = "$PORT" ]; then fail "web and OTLP port probes collided on $PORT"; fi

OUT_C="$OUT_DIR/web.log"
env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" web --port "$PORT" --otlp-http ":$OTLP_PORT" --source "$LOGS" >"$OUT_C" 2>&1 &
WPID=$!

HEALTH=""
for _ in $(seq 1 60); do
  if HEALTH="$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; then break; fi
  sleep 0.5
done
if [ -z "$HEALTH" ]; then
  tail -20 "$OUT_C" >&2 || true
  kill "$WPID" 2>/dev/null || true
  fail "fabric web: /api/health never came up"
fi
printf '%s' "$HEALTH" | grep -q '"version"' || fail "fabric web: health JSON missing version field"

curl -sf "http://127.0.0.1:$OTLP_PORT/api/health" >/dev/null || fail "fabric web: /api/health on the OTLP listener failed"

INDEX_HTML="$(curl -sf "http://127.0.0.1:$PORT/")" || fail "fabric web: GET / failed"
printf '%s' "$INDEX_HTML" | grep -q '<div id="root">' || fail "fabric web: index served without React root"
printf '%s' "$INDEX_HTML" | grep -q '/assets/' || fail "fabric web: index served without built asset references"

# Agentation mount verification (repository UI policy): every web entry point
# the installed package serves must load the Agentation toolbar. The smoke
# runs no browser, so it verifies the served artifact instead: every shipped
# HTML entry point, fetched over HTTP, must reference bundles carrying the
# agentation-root mount marker. The in-browser mounting proof lives in
# src/web/frontend/src/__agentation-mount-check.test.tsx (jsdom) and
# e2e/agentation-mount.spec.ts (playwright).
[ -d "$PKG/dist/web/public" ] || fail "installed package missing dist/web/public"
ENTRY_COUNT=0
for ENTRY in $(cd "$PKG/dist/web/public" && find . -name '*.html' | sed 's|^\./||' | sort); do
  ENTRY_COUNT=$((ENTRY_COUNT + 1))
  if [ "$ENTRY" = "index.html" ]; then ENTRY_URL="/"; else ENTRY_URL="/$ENTRY"; fi
  ENTRY_HTML="$(curl -sf "http://127.0.0.1:$PORT$ENTRY_URL")" \
    || fail "fabric web: entry point $ENTRY not served at $ENTRY_URL"
  ENTRY_BUNDLES="$(printf '%s' "$ENTRY_HTML" | grep -oE '/assets/index-[^"]+\.js' | sort -u)"
  [ -n "$ENTRY_BUNDLES" ] || fail "fabric web: entry point $ENTRY references no built JS bundle"
  for ENTRY_BUNDLE in $ENTRY_BUNDLES; do
    curl -sf "http://127.0.0.1:$PORT$ENTRY_BUNDLE" -o "$OUT_DIR/agentation-bundle-check.js" \
      || fail "fabric web: entry point $ENTRY bundle $ENTRY_BUNDLE failed to load"
    grep -q 'agentation-root' "$OUT_DIR/agentation-bundle-check.js" \
      || fail "fabric web: entry point $ENTRY bundle $ENTRY_BUNDLE does not mount the Agentation toolbar (agentation-root marker missing)"
  done
done
[ "$ENTRY_COUNT" -ge 1 ] || fail "fabric web: no HTML entry points found in dist/web/public"
pass "fabric web: Agentation toolbar mount verified on $ENTRY_COUNT served entry point(s)"

curl -sf "http://127.0.0.1:$PORT/api/summary" >/dev/null || fail "fabric web: GET /api/summary failed"

# Unset-token contract: with no token configured the gate is a no-op on both
# listeners, and handlers really run (an ingested event per request).
CODE="$(http_code -X POST -H 'Content-Type: application/json' \
  -d '{"ts":"2026-09-26T00:00:00.000Z","event":"worker.started","worker":"smoke-unset-main"}' \
  "http://127.0.0.1:$PORT/api/events")"
[ "$CODE" = "201" ] || fail "fabric web unset-token: POST /api/events without a header answered $CODE (want 201)"
CODE="$(http_code -X POST -H 'Content-Type: application/json' \
  -d '{"ts":"2026-09-26T00:00:01.000Z","event":"worker.started","worker":"smoke-unset-otlp"}' \
  "http://127.0.0.1:$OTLP_PORT/api/events")"
[ "$CODE" = "201" ] || fail "fabric web unset-token: POST /api/events on the OTLP listener answered $CODE (want 201)"
CODE="$(http_code -X POST -H 'Content-Type: application/json' \
  -d "$(otlp_logs_body smoke-unset-otlp-log)" \
  "http://127.0.0.1:$OTLP_PORT/v1/logs")"
[ "$CODE" = "200" ] || fail "fabric web unset-token: POST /v1/logs on the OTLP listener answered $CODE (want 200)"
CODE="$(http_code -X POST -H 'Content-Type: application/json' \
  -d "$(otlp_logs_body smoke-unset-main-log)" \
  "http://127.0.0.1:$PORT/v1/logs")"
[ "$CODE" = "200" ] || fail "fabric web unset-token: POST /v1/logs on the main listener answered $CODE (want 200)"
CODE="$(http_code -X POST -H 'Content-Type: application/json' \
  -H "$WRONG_AUTH" \
  -d '{"ts":"2026-09-26T00:00:02.000Z","event":"worker.started","worker":"smoke-unset-wrong"}' \
  "http://127.0.0.1:$PORT/api/events")"
[ "$CODE" = "201" ] || fail "fabric web unset-token: POST with a wrong token answered $CODE (want 201 — no token configured means no gate)"

for W in smoke-unset-main smoke-unset-otlp smoke-unset-otlp-log smoke-unset-main-log smoke-unset-wrong; do
  [ "$(count_worker "$PORT" "$W")" = "1" ] \
    || fail "fabric web unset-token: worker $W should have exactly 1 ingested event"
done

kill -INT "$WPID"
wait "$WPID" || fail "fabric web: nonzero exit after SIGINT"
if [ -d "$SMOKE_HOME/.needle" ]; then
  pass "sandbox ~/.needle created under clean HOME (state dirs auto-created)"
fi
pass "fabric web (unset token): GETs open, POSTs accepted on both listeners, handlers really ran, graceful SIGINT exit"

# 5e2. fabric web — configured-token mode (FABRIC_AUTH_TOKEN in the
# environment: the systemd deployment shape), the docs/api-auth.md matrix
# exercised with curl against BOTH listeners of the installed server:
#
#   GET                          open (200), /v1/* SPA fall-through — never a
#                                401/403 challenge, even with a wrong token
#   POST missing token           401 {"error":"Missing authorization"}
#   POST wrong token             403 {"error":"Forbidden"}
#   POST valid token             passes the gate; the handler runs
#   malformed body + valid token 400 (/api/* body-parser) / 500 (/v1/* decode)
#   oversized body + valid token 413 (64 KiB /api/* cap, 5 MB /v1/* cap)
#
# 401/403 sweeps carry deliberately malformed bodies: the middleware is
# registered before body parsing, so a rejection that happened after parsing
# would answer 400 instead. Side-effect checks use valid-shaped bodies under
# unique worker ids so a rejection that reached a handler would be visible
# as an ingested event.
SMOKE_TOKEN="fabric-clean-install-smoke-token"  # placeholder, not a credential

post_auth() { # listener path token body -> status on stdout; token "-" sends no header
  local listener="$1" path="$2" token="$3" body="$4"
  if [ "$token" = "-" ]; then
    http_code -X POST -H 'Content-Type: application/json' -d "$body" "http://127.0.0.1:$listener$path"
  else
    http_code -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $token" -d "$body" "http://127.0.0.1:$listener$path"
  fi
}

PORT="$(find_free_port)" || fail "could not find a free port for fabric web (auth run)"
OTLP_PORT="$(find_free_port)" || fail "could not find a free OTLP port for fabric web (auth run)"
if [ "$OTLP_PORT" = "$PORT" ]; then fail "web and OTLP port probes collided on $PORT (auth run)"; fi

OUT_C2="$OUT_DIR/web-auth.log"
env HOME="$SMOKE_HOME" NO_COLOR=1 FABRIC_AUTH_TOKEN="$SMOKE_TOKEN" \
  node "$FABRIC_CLI" web --port "$PORT" --otlp-http ":$OTLP_PORT" --source "$LOGS" >"$OUT_C2" 2>&1 &
WPID=$!

HEALTH=""
for _ in $(seq 1 60); do
  if HEALTH="$(curl -sf "http://127.0.0.1:$PORT/api/health" 2>/dev/null)"; then break; fi
  sleep 0.5
done
if [ -z "$HEALTH" ]; then
  tail -20 "$OUT_C2" >&2 || true
  kill "$WPID" 2>/dev/null || true
  fail "fabric web (auth): /api/health never came up"
fi
curl -sf "http://127.0.0.1:$OTLP_PORT/api/health" >/dev/null || fail "fabric web (auth): /api/health on the OTLP listener failed"

for LISTENER in "$PORT" "$OTLP_PORT"; do
  CODE="$(http_code "http://127.0.0.1:$LISTENER/api/health")"
  [ "$CODE" = "200" ] || fail "fabric web (auth): GET /api/health on $LISTENER answered $CODE (want 200)"
  CODE="$(http_code -H "$WRONG_AUTH" "http://127.0.0.1:$LISTENER/api/summary")"
  [ "$CODE" = "200" ] || fail "fabric web (auth): GET /api/summary with a wrong token on $LISTENER answered $CODE (want 200)"
  # GET on the receiver's POST-only /v1/* falls through to the SPA fallback —
  # with the installed package's built frontend that is the index page (200);
  # the invariant under test is that it is never an auth challenge.
  CODE="$(http_code "http://127.0.0.1:$LISTENER/v1/logs")"
  if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
    fail "fabric web (auth): GET /v1/logs on $LISTENER answered $CODE (must never be an auth challenge)"
  fi
done

MALFORMED='{this-is-not-json'
for LISTENER in "$PORT" "$OTLP_PORT"; do
  CODE="$(post_auth "$LISTENER" /api/events - "$MALFORMED")"
  [ "$CODE" = "401" ] || fail "fabric web (auth): POST /api/events missing token on $LISTENER answered $CODE (want 401)"
  CODE="$(post_auth "$LISTENER" /v1/logs - "$MALFORMED")"
  [ "$CODE" = "401" ] || fail "fabric web (auth): POST /v1/logs missing token on $LISTENER answered $CODE (want 401)"
  CODE="$(post_auth "$LISTENER" /api/events wrong-token "$MALFORMED")"
  [ "$CODE" = "403" ] || fail "fabric web (auth): POST /api/events wrong token on $LISTENER answered $CODE (want 403)"
  CODE="$(post_auth "$LISTENER" /v1/logs wrong-token "$MALFORMED")"
  [ "$CODE" = "403" ] || fail "fabric web (auth): POST /v1/logs wrong token on $LISTENER answered $CODE (want 403)"
done
BODY401="$(curl -s -X POST -H 'Content-Type: application/json' -d "$MALFORMED" "http://127.0.0.1:$PORT/api/events")"
printf '%s' "$BODY401" | grep -q 'Missing authorization' || fail "fabric web (auth): 401 body missing 'Missing authorization'"
BODY403="$(curl -s -X POST -H 'Content-Type: application/json' -H "$WRONG_AUTH" -d "$MALFORMED" "http://127.0.0.1:$PORT/api/events")"
printf '%s' "$BODY403" | grep -q 'Forbidden' || fail "fabric web (auth): 403 body missing 'Forbidden'"

# Valid token passes the gate and the handler runs, on both listeners.
VALID_EVENT='{"ts":"2026-09-26T00:00:03.000Z","event":"worker.started","worker":"smoke-auth-valid"}'
CODE="$(post_auth "$PORT" /api/events "$SMOKE_TOKEN" "$VALID_EVENT")"
[ "$CODE" = "201" ] || fail "fabric web (auth): POST /api/events with the valid token answered $CODE (want 201)"
CODE="$(post_auth "$OTLP_PORT" /v1/logs "$SMOKE_TOKEN" "$(otlp_logs_body smoke-auth-valid-log)")"
[ "$CODE" = "200" ] || fail "fabric web (auth): POST /v1/logs with the valid token answered $CODE (want 200)"

# Malformed body + valid token dies at the parse layer, not the gate.
CODE="$(post_auth "$PORT" /api/events "$SMOKE_TOKEN" "$MALFORMED")"
[ "$CODE" = "400" ] || fail "fabric web (auth): malformed /api/events body with valid token answered $CODE (want 400 from body-parser)"
CODE="$(post_auth "$OTLP_PORT" /v1/logs "$SMOKE_TOKEN" "$MALFORMED")"
[ "$CODE" = "500" ] || fail "fabric web (auth): malformed /v1/logs body with valid token answered $CODE (want 500 decode failure)"

# Oversized body + valid token dies at the transport cap: 64 KiB on /api/*
# (express.json limit), 5 MB on /v1/* (receiver raw-body cap).
OVERSIZE_API="$WORK/oversize-api.json"
node -e 'process.stdout.write(JSON.stringify({ts:"2026-09-26T00:00:04.000Z",event:"worker.started",worker:"smoke-auth-oversize",pad:"x".repeat(80*1024)}))' > "$OVERSIZE_API"
OVERSIZE_OTLP="$WORK/oversize-otlp.json"
node -e 'process.stdout.write(JSON.stringify({pad:"x".repeat(6*1024*1024)}))' > "$OVERSIZE_OTLP"
for LISTENER in "$PORT" "$OTLP_PORT"; do
  CODE="$(http_code -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $SMOKE_TOKEN" \
    --data-binary @"$OVERSIZE_API" "http://127.0.0.1:$LISTENER/api/events")"
  [ "$CODE" = "413" ] || fail "fabric web (auth): oversized /api/events body on $LISTENER answered $CODE (want 413)"
  CODE="$(http_code -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $SMOKE_TOKEN" \
    --data-binary @"$OVERSIZE_OTLP" "http://127.0.0.1:$LISTENER/v1/logs")"
  [ "$CODE" = "413" ] || fail "fabric web (auth): oversized /v1/logs body on $LISTENER answered $CODE (want 413)"
done

# Side-effect proof: the two valid-token submissions ingested exactly one
# event each; no rejected request left anything behind.
[ "$(count_worker "$PORT" smoke-auth-valid)" = "1" ] || fail "fabric web (auth): valid /api/events event not ingested exactly once"
[ "$(count_worker "$PORT" smoke-auth-valid-log)" = "1" ] || fail "fabric web (auth): valid /v1/logs event not ingested exactly once"

CODE="$(post_auth "$PORT" /api/events - '{"ts":"2026-09-26T00:00:05.000Z","event":"worker.started","worker":"smoke-auth-missing"}')"
[ "$CODE" = "401" ] || fail "fabric web (auth): valid-shaped body with missing token answered $CODE (want 401)"
CODE="$(post_auth "$PORT" /api/events wrong-token '{"ts":"2026-09-26T00:00:06.000Z","event":"worker.started","worker":"smoke-auth-wrong"}')"
[ "$CODE" = "403" ] || fail "fabric web (auth): valid-shaped body with wrong token answered $CODE (want 403)"
for W in smoke-auth-missing smoke-auth-wrong smoke-auth-oversize; do
  [ "$(count_worker "$PORT" "$W")" = "0" ] \
    || fail "fabric web (auth): rejected/oversized worker $W must have ingested nothing"
done

kill -INT "$WPID"
wait "$WPID" || fail "fabric web (auth): nonzero exit after SIGINT"
pass "fabric web (configured token): GETs open, 401/403/valid/malformed/oversized on both listeners, no rejected side effects, graceful SIGINT exit"

# 5f. fabric tui — pty startup + graceful SIGINT.
# `script` allocates the pty blessed needs; `timeout` runs inside it so SIGINT
# reaches node directly; --preserve-status propagates the CLI's real exit code.
OUT_D="$OUT_DIR/tui.log"
TUI_CMD="env HOME=$SMOKE_HOME NO_COLOR=1 timeout --preserve-status -s INT 6 node $FABRIC_CLI tui --source $LOGS"
set +e
script -qec "$TUI_CMD" /dev/null >"$OUT_D" 2>&1
TUI_RC=$?
set -e
if [ "$TUI_RC" -ne 0 ]; then
  tail -40 "$OUT_D" >&2 || true
  fail "fabric tui exited $TUI_RC (expected 0 after SIGINT)"
fi
if ! grep -a -q 'FABRIC' "$OUT_D"; then fail "fabric tui: no UI rendered in pty output"; fi
if grep -a -q 'Failed to start TUI' "$OUT_D"; then fail "fabric tui: reported startup failure"; fi
pass "fabric tui: pty startup + graceful SIGINT exit"

# 5g. fabric replay — pty startup on the fixture logs + graceful SIGINT.
# Like tui, replay is a blessed screen; blessed's own SIGINT handler exits 0.
OUT_E="$OUT_DIR/replay.log"
REPLAY_CMD="env HOME=$SMOKE_HOME NO_COLOR=1 timeout --preserve-status -s INT 6 node $FABRIC_CLI replay --source $LOGS"
set +e
script -qec "$REPLAY_CMD" /dev/null >"$OUT_E" 2>&1
REPLAY_RC=$?
set -e
if [ "$REPLAY_RC" -ne 0 ]; then
  tail -40 "$OUT_E" >&2 || true
  fail "fabric replay exited $REPLAY_RC (expected 0 after SIGINT)"
fi
if ! grep -a -q 'Session Replay' "$OUT_E"; then
  fail "fabric replay: no session-replay banner in pty output"
fi
if grep -a -q 'Failed to start replay' "$OUT_E"; then fail "fabric replay: reported startup failure"; fi
pass "fabric replay: pty startup over fixture logs + graceful SIGINT exit"

# 5h. fabric prune — dry-run reports without touching, real run archives an
# aged fixture copy. Everything happens under $WORK (scratch dir + sandboxed
# HOME), never the real ~/.needle/logs.
PRUNE_LOGS="$WORK/prune-logs"
mkdir -p "$PRUNE_LOGS"
cp "$LOGS"/*.jsonl "$PRUNE_LOGS/"
printf '{"timestamp":"2026-04-22T10:00:00.000Z","event_type":"worker.started","worker_id":"smoke-aged-1111aaaa","session_id":"smoke-1","sequence":1,"data":{}}\n' \
  > "$PRUNE_LOGS/smoke-aged-1111aaaa.jsonl"
touch -d '30 days ago' "$PRUNE_LOGS/smoke-aged-1111aaaa.jsonl"

OUT_F="$OUT_DIR/prune-dry.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" prune \
      --dry-run --archive-after 7 --source "$PRUNE_LOGS" >"$OUT_F" 2>&1; then
  tail -20 "$OUT_F" >&2 || true
  fail "fabric prune (dry run) exited nonzero"
fi
grep -q '\[DRY RUN\] Prune complete' "$OUT_F" || fail "fabric prune: dry run did not report a dry-run pass"
grep -q 'Files archived: 1' "$OUT_F" || fail "fabric prune: dry run did not report the aged file as archivable"
[ -f "$PRUNE_LOGS/smoke-aged-1111aaaa.jsonl" ] || fail "fabric prune: dry run deleted the aged file"
pass "fabric prune (dry run): aged fixture reported, nothing touched"

OUT_F2="$OUT_DIR/prune-run.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" prune \
      --archive-after 7 --source "$PRUNE_LOGS" >"$OUT_F2" 2>&1; then
  tail -20 "$OUT_F2" >&2 || true
  fail "fabric prune (real run) exited nonzero"
fi
grep -q 'Archives created: 1' "$OUT_F2" || fail "fabric prune: real run created no archive"
grep -q 'Files archived: 1' "$OUT_F2" || fail "fabric prune: real run archived nothing"
[ ! -f "$PRUNE_LOGS/smoke-aged-1111aaaa.jsonl" ] || fail "fabric prune: real run left the aged file in place"
ARCHIVE_TAR="$(ls "$PRUNE_LOGS"/archive/*.tar.gz 2>/dev/null | head -1)"
if [ -z "$ARCHIVE_TAR" ] || [ ! -f "$ARCHIVE_TAR" ]; then fail "fabric prune: no tarball in the archive directory"; fi
tar -tzf "$ARCHIVE_TAR" | grep -q 'smoke-aged-1111aaaa.jsonl' || fail "fabric prune: archive tarball missing the aged file"
pass "fabric prune (real run): aged fixture archived into $(basename "$ARCHIVE_TAR")"

# 5i. fabric digest — deterministic digest over the fixture logs, both the
# directory source (stdout) and the single-file --output workflow.
OUT_G="$OUT_DIR/digest-dir.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" digest \
      --source "$LOGS" >"$OUT_G" 2>&1; then
  tail -20 "$OUT_G" >&2 || true
  fail "fabric digest (directory source) exited nonzero"
fi
grep -q '# Session Digest' "$OUT_G" || fail "fabric digest: markdown header missing"
grep -q '## Summary' "$OUT_G" || fail "fabric digest: summary section missing"
grep -q 'alpha-d6288428' "$OUT_G" || fail "fabric digest: fixture workers missing from digest"
grep -Eq '^Loaded [1-9][0-9]* events' "$OUT_G" || fail "fabric digest: no events loaded from fixtures"
pass "fabric digest (directory): events loaded, markdown digest on stdout"

OUT_G2="$OUT_DIR/digest-file.md"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" digest \
      -f "$LOGS/alpha-d6288428.jsonl" --output "$OUT_G2" >"$OUT_DIR/digest-file.log" 2>&1; then
  tail -20 "$OUT_DIR/digest-file.log" >&2 || true
  fail "fabric digest (single file, --output) exited nonzero"
fi
[ -s "$OUT_G2" ] || fail "fabric digest: --output produced no file"
grep -q '# Session Digest' "$OUT_G2" || fail "fabric digest: --output file lacks the markdown header"
grep -q 'Digest written to' "$OUT_DIR/digest-file.log" || fail "fabric digest: --output path not reported"
pass "fabric digest (--output): digest written to $OUT_G2"

# 5j. fabric config — show, theme set + readback (persisted under the sandboxed
# HOME), invalid-theme contract, presets listing, clear.
OUT_H="$OUT_DIR/config-show.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" config >"$OUT_H" 2>&1; then
  tail -20 "$OUT_H" >&2 || true
  fail "fabric config (show) exited nonzero"
fi
grep -q 'FABRIC Configuration' "$OUT_H" || fail "fabric config: header missing"
grep -q 'Current: dark' "$OUT_H" || fail "fabric config: default theme not reported"
pass "fabric config: configuration rendered with the default theme"

THEME_SET_LOG="$OUT_DIR/config-theme-set.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" config theme light >"$THEME_SET_LOG" 2>&1; then
  tail -20 "$THEME_SET_LOG" >&2 || true
  fail "fabric config theme light exited nonzero"
fi
grep -q 'Theme set to: light' "$THEME_SET_LOG" || fail "fabric config theme: set confirmation missing"
grep -q '"theme": "light"' "$SMOKE_HOME/.fabric/theme.json" || fail "fabric config theme: light not persisted to ~/.fabric/theme.json"
THEME_GET_LOG="$OUT_DIR/config-theme-get.log"
env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" config theme >"$THEME_GET_LOG" 2>&1
grep -q 'Current theme: light' "$THEME_GET_LOG" || fail "fabric config theme: readback did not return the persisted theme"
pass "fabric config theme: set, persisted, and read back"

THEME_BAD_LOG="$OUT_DIR/config-theme-invalid.log"
set +e
env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" config theme mauve >"$THEME_BAD_LOG" 2>&1
THEME_BAD_RC=$?
set -e
if [ "$THEME_BAD_RC" -eq 0 ]; then fail "fabric config theme: invalid theme accepted"; fi
grep -q "Invalid theme: mauve" "$THEME_BAD_LOG" || fail "fabric config theme: invalid theme error not reported"
pass "fabric config theme: invalid theme rejected with exit $THEME_BAD_RC"

PRESETS_LOG="$OUT_DIR/config-presets.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" config presets list >"$PRESETS_LOG" 2>&1; then
  tail -20 "$PRESETS_LOG" >&2 || true
  fail "fabric config presets list exited nonzero"
fi
grep -q 'Focus Presets' "$PRESETS_LOG" || fail "fabric config presets list: header missing"
pass "fabric config presets list: renders in a clean HOME"

CLEAR_LOG="$OUT_DIR/config-clear.log"
if ! env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" config clear --all >"$CLEAR_LOG" 2>&1; then
  tail -20 "$CLEAR_LOG" >&2 || true
  fail "fabric config clear --all exited nonzero"
fi
grep -q 'Deleted' "$CLEAR_LOG" || fail "fabric config clear: no deletions reported"
[ ! -f "$SMOKE_HOME/.fabric/theme.json" ] || fail "fabric config clear: theme.json survived --all"
pass "fabric config clear --all: persisted config removed"

# --- Summary -------------------------------------------------------------------

phase "summary"
log "source build, packaged tarball, clean npm install, and startup smoke for logs/tail/web/tui/replay/prune/digest/config all verified"
