/**
 * Contract tests for the repeatable npm release-maintenance check.
 *
 * The maintenance command intentionally performs real npm builds, packaging,
 * installation, and (after publication) a network registry install, so it is
 * opt-in rather than part of `npm test`. These fast assertions keep the
 * command, its safety boundary, and the documented release workflow aligned.
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
const maintenancePath = join(repoRoot, 'scripts', 'release-maintenance-check.mjs');
const maintenance = readFileSync(maintenancePath, 'utf8');
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const cliDoc = readFileSync(join(repoRoot, 'docs', 'cli.md'), 'utf8');

describe('release maintenance check', () => {
  it('is wired as an executable opt-in npm script', () => {
    expect(packageJson.scripts?.['release:maintenance']).toBe(
      'node scripts/release-maintenance-check.mjs',
    );
    expect(existsSync(maintenancePath)).toBe(true);
    expect(statSync(maintenancePath).mode & 0o111).toBeGreaterThan(0);
  });

  it('validates public metadata and the documented release sequence', () => {
    for (const marker of [
      'package-lock.json',
      'publishConfig',
      'release:check',
      'release:publish',
      'npm version patch',
      'git push origin main --follow-tags',
    ]) {
      expect(maintenance, `maintenance check lost ${marker}`).toContain(marker);
    }
    expect(maintenance).toContain('no publication was attempted');
    expect(maintenance).not.toContain("execFileSync('npm', ['publish'");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('runs the gate and verifies package contents and tarball installation', () => {
    for (const marker of [
      "['run', 'release:check']",
      "'npm', [\n    'pack'",
      "'tar', ['-tzf', tarball]",
      "'dist/cli.js'",
      "'dist/web/public/index.html'",
      "'--prefix'",
      "'--no-package-lock'",
      "['--version']",
      "['--help']",
    ]) {
      expect(maintenance, `maintenance check lost ${marker}`).toContain(marker);
    }
  });

  it('requires exact-version registry verification and documents the local escape hatch', () => {
    expect(maintenance).toContain('--registry-spec');
    expect(maintenance).toContain('--skip-registry');
    expect(maintenance).toContain('smoke:registry-install');
    expect(maintenance).toContain('validateRegistrySpec');
    expect(readme).toContain('npm run release:maintenance');
    expect(readme).toContain('--skip-registry');
    expect(cliDoc).toContain('release:maintenance');
  });
});
