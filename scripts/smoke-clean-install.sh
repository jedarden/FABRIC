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
#                                fabric logs  single-file parse, directory hot-add,
#                                             graceful SIGINT
#                                fabric web   /api/health, SPA assets served from
#                                             the installed package, graceful SIGINT
#                                fabric tui   pty startup, graceful SIGINT
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
pass "dist/cli.js (with shebang) and web assets (js+css) generated"

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
for cmd in tui web tail; do
  if ! printf '%s' "$HELP_OUT" | grep -q "$cmd"; then
    fail "fabric --help does not list the '$cmd' command"
  fi
done
pass "bin link works; --version=$VERSION_OUT; --help lists tui/web/tail"

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

# 5b. fabric logs — directory mode, hot-added file, graceful SIGINT
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

# 5c. fabric web — health, SPA assets from the installed package, graceful SIGINT
PORT=""
for _ in $(seq 1 5); do
  CAND=$((20000 + RANDOM % 20000))
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$CAND") 2>/dev/null; then PORT="$CAND"; break; fi
done
if [ -z "$PORT" ]; then fail "could not find a free port for fabric web"; fi

OUT_C="$OUT_DIR/web.log"
env HOME="$SMOKE_HOME" NO_COLOR=1 node "$FABRIC_CLI" web --port "$PORT" --source "$LOGS" >"$OUT_C" 2>&1 &
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

INDEX_HTML="$(curl -sf "http://127.0.0.1:$PORT/")" || fail "fabric web: GET / failed"
printf '%s' "$INDEX_HTML" | grep -q '<div id="root">' || fail "fabric web: index served without React root"
printf '%s' "$INDEX_HTML" | grep -q '/assets/' || fail "fabric web: index served without built asset references"

curl -sf "http://127.0.0.1:$PORT/api/summary" >/dev/null || fail "fabric web: GET /api/summary failed"

kill -INT "$WPID"
wait "$WPID" || fail "fabric web: nonzero exit after SIGINT"
if [ -d "$SMOKE_HOME/.needle" ]; then
  pass "sandbox ~/.needle created under clean HOME (state dirs auto-created)"
fi
pass "fabric web: /api/health, SPA assets served, graceful SIGINT exit"

# 5d. fabric tui — pty startup + graceful SIGINT.
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

# --- Summary -------------------------------------------------------------------

phase "summary"
log "source build, packaged tarball, clean npm install, and tui/web/logs startup all verified"
