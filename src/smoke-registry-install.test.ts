/**
 * Release-contract tests for the post-publication registry smoke.
 *
 * The real registry install is intentionally not part of npm test: it must
 * run only after a version is published and it downloads external packages.
 * These tests keep the script, package wiring, and documentation aligned.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
  version?: string;
};
const scriptPath = join(repoRoot, 'scripts', 'smoke-registry-install.sh');
const script = readFileSync(scriptPath, 'utf8');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const cliDoc = readFileSync(join(repoRoot, 'docs', 'cli.md'), 'utf8');

describe('post-publication registry install smoke', () => {
  it('is wired as an executable npm script', () => {
    expect(packageJson.scripts?.['smoke:registry-install']).toBe(
      'bash scripts/smoke-registry-install.sh',
    );
    expect(existsSync(scriptPath)).toBe(true);
    expect(statSync(scriptPath).mode & 0o111).toBeGreaterThan(0);
  });

  it('installs the requested published spec in an isolated prefix', () => {
    expect(script).toContain('mktemp -d /tmp/fabric-registry-smoke.');
    expect(script).toContain('--prefix "$INSTALL"');
    expect(script).toContain('"$PACKAGE_SPEC"');
    expect(script).not.toContain('npm pack');
    expect(script).not.toContain('npm install -g');
  });

  it('checks the published bin, version, help, and generated web assets', () => {
    expect(script).toContain('node_modules/.bin/fabric');
    expect(script).toContain('readlink -f "$BIN"');
    expect(script).toContain('"$BIN" --version');
    expect(script).toContain('"$BIN" --help');
    expect(script).toContain('dist/web/public/index.html');
    expect(script).toContain("-name 'index-*.js'");
    expect(script).toContain("-name 'index-*.css'");
  });

  it('documents the published package and the exact-version smoke command', () => {
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readme).toContain('npm run smoke:registry-install -- @needle/fabric@<version>');
    expect(readme).toContain('release:publish');
    expect(cliDoc).toContain('smoke:registry-install');
    expect(readme).not.toContain('is not yet published');
    expect(cliDoc).not.toContain('not yet published');
  });
});
