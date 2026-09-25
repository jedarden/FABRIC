/**
 * Packaging contract tests — guard the installation workflows README documents.
 *
 * `npm install -g @needle/fabric` only works if the published tarball actually
 * ships the compiled CLI (`dist/cli.js`) and the generated web assets
 * (`dist/web/public/`). dist/ is gitignored, so npm's default
 * gitignore-respecting file selection would exclude it entirely — the `files`
 * whitelist in package.json is what makes the npm workflow valid, and the
 * `prepack` script is what keeps the tarball correct even when packed from a
 * checkout that has not been built.
 *
 * The full clean-room validation (source build → npm pack → clean install →
 * tui/web/logs runtime smoke) lives in scripts/smoke-clean-install.sh; these
 * tests cover the fast invariants that run as part of `npm test`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, symlinkSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

describe('npm packaging contract (README install workflows)', () => {
  it('exposes a fabric bin pointing at the compiled CLI', () => {
    expect(pkg.bin?.fabric).toBe('./dist/cli.js');
  });

  it('whitelists dist/ in files so the tarball ships the built CLI', () => {
    // dist/ is gitignored; without the files whitelist npm pack excludes
    // dist/cli.js and `npm install -g @needle/fabric` installs a dead bin.
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain('dist');
  });

  it('rebuilds dist and web assets on npm pack via prepack', () => {
    expect(pkg.scripts?.prepack).toBeTruthy();
    expect(pkg.scripts?.build).toBeTruthy();
    expect(pkg.scripts?.['build:web']).toBeTruthy();
  });

  it('keeps the CLI entrypoint a Node executable (shebang first line)', () => {
    const cliSrc = readFileSync(join(repoRoot, 'src/cli.ts'), 'utf8');
    expect(cliSrc.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('declares a supported Node engine range', () => {
    expect(pkg.engines?.node).toMatch(/^>=18/);
  });
});

const distCliBuilt = () => existsSync(join(repoRoot, 'dist', 'cli.js'));
const webAssetsBuilt = () =>
  existsSync(join(repoRoot, 'dist', 'web', 'public', 'index.html'));

/**
 * List the files npm pack would ship, without running prepack or writing a
 * tarball. npm prints the JSON document to stdout; notices go to stderr.
 *
 * The document is an array of pack results whose first entry carries a
 * `files` array (older npm versions emitted a bare file array). Paths are
 * package-relative; a leading `package/` is stripped if present.
 *
 * The listing is cached — npm stats and hashes every candidate file, which
 * can take several seconds under a loaded test run.
 */
let packFilesCache: string[] | null = null;
function packDryRunFiles(): string[] {
  if (packFilesCache) return packFilesCache;
  const stdout = execFileSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const parsed = JSON.parse(stdout) as unknown;
  const first = Array.isArray(parsed)
    ? (parsed as Array<{ files?: Array<Record<string, unknown>> }>)[0]
    : (parsed as { files?: Array<Record<string, unknown>> });
  const entries: Array<Record<string, unknown>> = first?.files ?? [];
  packFilesCache = entries
    .map((e) => e.path)
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.replace(/^package\//, ''));
  return packFilesCache;
}

describe('npm pack contents (requires dist; pretest builds the CLI)', () => {
  // `npm test` runs pretest → `npm run build` (tsc), so dist/cli.js exists by
  // the time vitest runs. build:web is a separate step in CI ordering, so the
  // web-asset tarball check skips unless those assets are present too — the
  // authoritative check for the full chain is scripts/smoke-clean-install.sh.
  it.skipIf(!distCliBuilt())(
    'tarball ships the compiled CLI, not the sources',
    () => {
      const files = packDryRunFiles();
      expect(files).toContain('dist/cli.js');
      expect(files).not.toContain('src/cli.ts');
      expect(files.some((f) => f.startsWith('tmp/'))).toBe(false);
    },
    60_000
  );

  it.skipIf(!distCliBuilt() || !webAssetsBuilt())(
    'tarball ships the generated web assets',
    () => {
      const files = packDryRunFiles();
      expect(files).toContain('dist/web/public/index.html');
      expect(
        files.some((f) => /^dist\/web\/public\/assets\/index-[^/]+\.js$/.test(f))
      ).toBe(true);
    },
    60_000
  );
});

describe('bin-link invocation contract (requires dist; pretest builds the CLI)', () => {
  // npm's bin link is a symlink (node_modules/.bin/fabric -> dist/cli.js).
  // Node reports the entry module's realpath in import.meta.url while
  // process.argv[1] keeps the invoked path, so cli.ts's parse guard must
  // realpath argv[1] before comparing — an unrealtimed comparison made every
  // bin-link invocation a silent no-op (exit 0, no output), which the
  // clean-install smoke caught in phase 4. Spawning node with the symlink as
  // the script reproduces that mismatch without needing the exec bit npm
  // sets at install time.
  it.skipIf(!distCliBuilt())(
    'answers --version when invoked through a bin-style symlink',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'fabric-binlink-'));
      try {
        const link = join(dir, 'fabric');
        symlinkSync(join(repoRoot, 'dist', 'cli.js'), link);
        const res = spawnSync(process.execPath, [link, '--version'], {
          encoding: 'utf8',
          timeout: 30_000,
        });
        expect(res.status).toBe(0);
        expect(res.stdout.trim()).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    60_000
  );
});
