#!/usr/bin/env bash
#
# Post-publication registry-install smoke test for @needle/fabric.
#
# This intentionally installs from the configured npm registry into a fresh
# temporary prefix. It does not use the repository checkout or a global npm
# location, so it proves the package that consumers can actually
# download after publication.
#
# Usage:
#   npm run smoke:registry-install -- @needle/fabric@0.1.0
#
# The package spec is optional and defaults to the version in this checkout.
# Pass an explicit version after publishing so the check cannot accidentally
# validate a different dist-tag.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
PACKAGE_SPEC="${1:-@needle/fabric@${DEFAULT_VERSION}}"
WORK="$(mktemp -d /tmp/fabric-registry-smoke.XXXXXX)"
INSTALL="$WORK/install"

log() { printf '[registry-smoke] %s\n' "$*"; }
fail() {
  printf '[registry-smoke] FAIL: %s\n' "$*" >&2
  printf '[registry-smoke] workdir kept for diagnosis: %s\n' "$WORK" >&2
  exit 1
}

cleanup() {
  rc=$?
  if [ "$rc" -eq 0 ]; then
    rm -rf "$WORK"
    log "PASS: isolated registry install smoke succeeded"
  fi
}
trap cleanup EXIT

case "$PACKAGE_SPEC" in
  @needle/fabric@*) ;;
  *) fail "package spec must target @needle/fabric@<version> (got: $PACKAGE_SPEC)" ;;
esac

for tool in node npm readlink find grep; do
  command -v "$tool" >/dev/null 2>&1 || fail "missing required tool: $tool"
done

mkdir -p "$INSTALL"
printf '{"name":"fabric-registry-smoke","private":true}\n' > "$INSTALL/package.json"

log "installing $PACKAGE_SPEC into isolated prefix $INSTALL"
npm install \
  --prefix "$INSTALL" \
  "$PACKAGE_SPEC" \
  --no-package-lock \
  --no-audit \
  --no-fund \
  >/dev/null

BIN="$INSTALL/node_modules/.bin/fabric"
PKG="$INSTALL/node_modules/@needle/fabric"

if [ ! -L "$BIN" ] || [ ! -x "$BIN" ]; then
  fail "registry install did not create an executable fabric bin symlink"
fi
RESOLVED_BIN="$(readlink -f "$BIN")"
if [ "$RESOLVED_BIN" != "$PKG/dist/cli.js" ]; then
  fail "fabric bin resolves to $RESOLVED_BIN, not $PKG/dist/cli.js"
fi

if [ ! -f "$PKG/dist/cli.js" ]; then
  fail "registry package is missing dist/cli.js"
fi
if [ ! -f "$PKG/dist/web/public/index.html" ]; then
  fail "registry package is missing dist/web/public/index.html"
fi
if [ -z "$(find "$PKG/dist/web/public/assets" -maxdepth 1 -type f -name 'index-*.js' -print -quit 2>/dev/null)" ]; then
  fail "registry package is missing the hashed web JavaScript bundle"
fi
if [ -z "$(find "$PKG/dist/web/public/assets" -maxdepth 1 -type f -name 'index-*.css' -print -quit 2>/dev/null)" ]; then
  fail "registry package is missing the hashed web CSS bundle"
fi

INSTALLED_VERSION="$(node -p "require('$PKG/package.json').version")"
VERSION_OUT="$("$BIN" --version)"
if [ "$VERSION_OUT" != "$INSTALLED_VERSION" ]; then
  fail "fabric --version ($VERSION_OUT) does not match installed version ($INSTALLED_VERSION)"
fi

HELP_OUT="$("$BIN" --help)"
for command_name in tui web tail logs; do
  printf '%s' "$HELP_OUT" | grep -q "[[:space:]]$command_name[[:space:]]" \
    || fail "fabric --help does not list the $command_name command"
done

log "verified $PACKAGE_SPEC: bin link, --version=$VERSION_OUT, --help, and web assets"
