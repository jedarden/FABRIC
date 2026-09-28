/**
 * Clean-install smoke release gate (owning bead: fabric-b7b48295).
 *
 * README.md's "Verifying the installation (smoke test)" section promises an
 * end-to-end clean room: both documented installation paths (source build,
 * npm pack + clean install), command discovery via --help, a runtime smoke of
 * every documented command against the repo's JSONL fixtures, a sandboxed
 * $HOME, and graceful shutdown on SIGINT. The full validation lives in
 * scripts/smoke-clean-install.sh and performs two real npm installs by
 * design, so it can never run as part of `npm test` — which is exactly how a
 * promise like that rots: a new CLI command ships, nothing adds it to the
 * smoke, and the README is lying by the time anyone runs it.
 *
 * These tests are the release gate against that rot. They keep four surfaces
 * aligned without re-running the smoke itself:
 *
 *   README.md  <->  package.json wiring  <->  the smoke script  <->  the CLI
 *
 * - every command `fabric --help` documents must be invoked in the smoke
 * - every tool the README calls a requirement must be preflighted
 * - every documented installation path must have its phase and artifact
 *   checks present, including the files-whitelist tarball behavior
 * - every CLI invocation in the smoke must run under the sandboxed HOME, and
 *   every long-running process must have a graceful-SIGINT assertion
 * - the fixtures the smoke copies must exist
 * - every web entry point the package ships must verify the Agentation
 *   toolbar mount at the served-artifact level (workspace UI policy); the
 *   in-browser mounting proof stays in the jsdom mount check and the
 *   playwright spec
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const SMOKE_SCRIPT = 'scripts/smoke-clean-install.sh';
const smokePath = join(repoRoot, SMOKE_SCRIPT);

const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const smoke = readFileSync(smokePath, 'utf8');

// The smoke script uses backslash line continuations for long invocations;
// join them so per-statement assertions see one logical line.
const flat = smoke.replace(/\\\n\s*/g, ' ');

// commander built-ins that are help machinery, not product commands.
const BUILTIN_COMMANDS = new Set(['help']);

// The runtime commands the README's smoke section documents, and that the
// smoke script must therefore exercise.
const RUNTIME_COMMANDS = [
  'tui',
  'web',
  'tail',
  'logs',
  'replay',
  'prune',
  'digest',
  'config',
];

/** Command names actually invoked against the installed CLI in the smoke. */
function smokeInvokedCommands(): string[] {
  const invoked = new Set<string>();
  const re = /\$FABRIC_CLI"?\s+([a-z][a-z0-9-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) invoked.add(m[1]);
  return [...invoked];
}

/** The README's smoke-test section, from its heading to the next section. */
function readmeSmokeSection(): string {
  const start = readme.indexOf('### Verifying the installation');
  const end = readme.indexOf('## Quick Start');
  expect(start, 'README lost the smoke-test section heading').toBeGreaterThan(-1);
  expect(end, 'README lost the Quick Start heading after the smoke section').toBeGreaterThan(start);
  return readme.slice(start, end);
}

const distCliBuilt = () => existsSync(join(repoRoot, 'dist', 'cli.js'));

/**
 * HTML entry points in the vite frontend root (vite.config.ts `root:`) — the
 * source of the dist/web/public pages the server ships. One per page: each
 * entry point wires the Agentation toolbar independently, so mount coverage
 * is per entry point, never per repo (workspace UI policy).
 */
function frontendEntryPoints(): string[] {
  const viteConfig = readFileSync(join(repoRoot, 'vite.config.ts'), 'utf8');
  const root = viteConfig.match(/root:\s*'([^']+)'/)?.[1];
  expect(root, 'vite.config.ts lost its root: declaration').toBeTruthy();
  const found: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      const next = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, next);
      else if (name.endsWith('.html')) found.push(next);
    }
  };
  walk(join(repoRoot, root as string), '');
  return found;
}

/**
 * Command names `fabric --help` documents, parsed from the real CLI output —
 * the same discovery step the smoke's phase 4 performs on the installed
 * package. Command lines sit at exactly two spaces of indent; commander's
 * wrapped description continuations are indented deeper and never match.
 */
function helpDocumentedCommands(): string[] {
  const res = spawnSync(
    process.execPath,
    [join(repoRoot, 'dist', 'cli.js'), '--help'],
    { encoding: 'utf8', timeout: 30_000 }
  );
  expect(res.status).toBe(0);
  const lines = res.stdout.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'Commands:');
  expect(start, 'fabric --help output has no Commands: section').toBeGreaterThan(-1);
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^ {2}(\S+)/);
    if (!m) continue;
    for (const part of m[1].split('|')) {
      const bare = part.replace(/\[.*/, '').trim();
      if (bare && !BUILTIN_COMMANDS.has(bare)) names.push(bare);
    }
  }
  return names;
}

describe('smoke release gate: wiring (README <-> npm script <-> smoke script)', () => {
  it('wires npm run smoke:clean-install to the script the README documents', () => {
    const wired: unknown = pkg.scripts?.['smoke:clean-install'];
    expect(wired, 'package.json lost the smoke:clean-install script').toBeTruthy();
    expect(String(wired)).toContain(SMOKE_SCRIPT);
    expect(existsSync(smokePath), `${SMOKE_SCRIPT} is missing`).toBe(true);
  });

  it('keeps the README smoke section anchored to real entry points', () => {
    const section = readmeSmokeSection();
    expect(section).toContain('npm run smoke:clean-install');
    expect(section).toContain(SMOKE_SCRIPT);
  });

  it('honors the documented SMOKE_KEEP_WORKDIR escape hatch', () => {
    expect(readmeSmokeSection()).toContain('SMOKE_KEEP_WORKDIR=1');
    expect(smoke).toContain('SMOKE_KEEP_WORKDIR');
  });

  it('packages the tree from HEAD via git archive, as documented', () => {
    expect(readmeSmokeSection()).toContain('git archive');
    expect(smoke).toContain('archive --format=tar HEAD');
  });
});

describe('smoke release gate: documented dependencies are preflighted', () => {
  it('preflights every tool the README requires', () => {
    // README: "Requires `git`, `curl`, `tar`, and `script` (util-linux)"
    expect(readmeSmokeSection()).toContain(
      'Requires `git`, `curl`, `tar`, and `script`'
    );
    const preflight =
      smoke.match(/for tool in (.+?); do/)?.[1]?.trim().split(/\s+/) ?? [];
    for (const tool of ['git', 'curl', 'tar', 'script']) {
      expect(preflight, `smoke preflight does not check '${tool}'`).toContain(tool);
    }
    // The smoke drives builds and installs, so the toolchain is required too.
    expect(preflight).toContain('node');
    expect(preflight).toContain('npm');
  });
});

describe('smoke release gate: source-build installation path', () => {
  it('runs the README clone-and-build commands', () => {
    // npm run build, not just build:web — README lists both build steps.
    expect(flat).toMatch(/npm run build(?!:)/);
    expect(flat).toMatch(/npm run build:web/);
    expect(flat).toMatch(/npm install/);
  });

  it('asserts the generated artifacts the README documents', () => {
    expect(smoke).toContain('dist/cli.js');
    // The bin target must stay a real Node script.
    expect(smoke).toContain("'#!/usr/bin/env node'");
    expect(smoke).toContain('dist/web/public/index.html');
    // Hashed bundles, both flavors, and index.html referencing them.
    expect(smoke).toContain("index-*.js'");
    expect(smoke).toContain("index-*.css'");
  });
});

describe('smoke release gate: npm packaging installation path', () => {
  it('packs the tarball and installs it into an empty project', () => {
    expect(smoke).toMatch(/npm pack/);
    expect(smoke).toMatch(/npm install "\$TARBALL"/);
  });

  it('enforces the files whitelist: dist ships, src/ and scratch do not', () => {
    expect(smoke).toMatch(/tarball_has 'dist\/cli\.js'/);
    expect(smoke).toContain('dist/web/public/index.html');
    expect(smoke).toMatch(/\^package\/src\//);
    expect(smoke).toMatch(/\^package\/tmp\//);
  });

  it('checks the bin link and the --version / --help discovery contract', () => {
    expect(smoke).toContain('node_modules/.bin/fabric');
    expect(smoke).toMatch(/"\$BIN" --version/);
    expect(smoke).toMatch(/"\$BIN" --help/);
    // Discovery must list the primary commands before the runtime phase runs.
    for (const cmd of ['tui', 'web', 'tail', 'logs']) {
      expect(
        smoke.match(new RegExp(`for cmd in [^;]*\\b${cmd}\\b`)),
        `phase 4 --help check does not list '${cmd}'`
      ).toBeTruthy();
    }
  });
});

describe('smoke release gate: runtime coverage of documented commands', () => {
  it('exercises every command the README smoke section documents', () => {
    const section = readmeSmokeSection();
    for (const cmd of RUNTIME_COMMANDS) {
      expect(section, `README smoke section stopped documenting 'fabric ${cmd}'`).toContain(
        `fabric ${cmd}`
      );
      expect(
        smokeInvokedCommands(),
        `smoke script never exercises 'fabric ${cmd}'`
      ).toContain(cmd);
    }
  });

  it.skipIf(!distCliBuilt())(
    'exercises every command fabric --help documents',
    () => {
      const documented = helpDocumentedCommands();
      expect(documented.length).toBeGreaterThan(0);
      const invoked = smokeInvokedCommands();
      for (const cmd of documented) {
        expect(
          invoked,
          `'fabric ${cmd}' is documented in --help but never exercised by the smoke — add it to ${SMOKE_SCRIPT} or document why it is out of scope`
        ).toContain(cmd);
      }
    },
    60_000
  );

  it('covers both documented spellings of the tail/logs alias end-to-end', () => {
    for (const spelling of ['tail', 'logs']) {
      // Single-file parse (the -f + --no-follow shape)...
      expect(
        flat.match(new RegExp(`\\$FABRIC_CLI"?\\s+${spelling}\\b[^\\n]*--no-follow`)),
        `smoke never runs 'fabric ${spelling}' in single-file mode`
      ).toBeTruthy();
      // ...and directory mode (the --source shape, where hot-add lives).
      expect(
        flat.match(new RegExp(`\\$FABRIC_CLI"?\\s+${spelling}\\b[^\\n]*--source`)),
        `smoke never runs 'fabric ${spelling}' in directory mode`
      ).toBeTruthy();
    }
    // The alias contract itself: identical --help output (docs/cli.md).
    expect(smoke).toMatch(/"\$BIN" tail --help/);
    expect(smoke).toMatch(/"\$BIN" logs --help/);
  });
});

describe('smoke release gate: sandboxed HOME and graceful shutdown', () => {
  it('runs every CLI invocation under the sandboxed HOME', () => {
    expect(smoke).toMatch(/SMOKE_HOME="\$WORK\/home"/);
    for (const line of flat.split('\n')) {
      if (!line.includes('FABRIC_CLI')) continue;
      if (line.trim().startsWith('FABRIC_CLI=')) continue; // the definition
      expect(
        line,
        `CLI invocation escapes the sandboxed HOME: ${line.trim()}`
      ).toContain('HOME=');
    }
  });

  it('asserts graceful SIGINT shutdown for the long-running commands', () => {
    // logs (dir) + tail (dir) + web (unset token) + web (configured token)
    // each get kill -INT followed by a wait that fails on a nonzero exit.
    expect((flat.match(/kill -INT/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((flat.match(/wait "\$\w+" \|\| fail/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // tui and replay own a pty: timeout forwards SIGINT into the CLI and
    // --preserve-status propagates its real exit code.
    expect((flat.match(/timeout --preserve-status -s INT/g) ?? []).length).toBe(2);
  });
});

describe('smoke release gate: fixtures the runtime smoke depends on', () => {
  it('ships the JSONL fixtures the smoke copies into the clean room', () => {
    const fixtures = join(repoRoot, 'tests', 'fixtures', 'needle-logs');
    expect(existsSync(fixtures), 'tests/fixtures/needle-logs is missing').toBe(true);
    expect(readdirSync(fixtures).filter((f) => f.endsWith('.jsonl')).length).toBeGreaterThan(0);
    expect(smoke).toContain('tests/fixtures/needle-logs');
    // The parse assertions name this fixture explicitly; if it is renamed the
    // smoke fails at runtime — catch it here instead.
    expect(existsSync(join(fixtures, 'alpha-d6288428.jsonl'))).toBe(true);
  });
});

describe('smoke release gate: Agentation mount verification (UI policy)', () => {
  // Workspace UI policy: every web page loads Agentation and mounts its
  // toolbar as #agentation-root — verified by mounting, never by grepping a
  // script tag, because the toolbar's module graph can fail silently while
  // the page renders perfectly. The smoke runs no browser, so its web phase
  // verifies the served artifact instead: every HTML entry point the
  // installed package ships, fetched over HTTP, must reference bundles
  // carrying the agentation-root mount marker. The in-browser mounting proof
  // stays in the jsdom mount check and the playwright spec; the assertions
  // here keep the smoke's artifact-level coverage from rotting the way the
  // rest of the smoke contracts would without this gate.

  it('discovers the vite frontend entry points the smoke must cover', () => {
    const entries = frontendEntryPoints();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain('index.html');
  });

  it('verifies the Agentation mount marker on every served entry point', () => {
    // The loop enumerates every shipped *.html at runtime — a second entry
    // point inherits coverage without further edits — and asserts each one
    // is served, references bundles, and that every referenced bundle
    // carries the mount marker.
    expect(smoke).toContain("find . -name '*.html'");
    expect(smoke).toContain("grep -q 'agentation-root'");
    expect(smoke).toMatch(/entry point \$ENTRY/);
  });

  it('checks the mount marker in the source-build artifacts before packaging', () => {
    expect(smoke).toMatch(
      /grep -q 'agentation-root' "\$SRC"\/dist\/web\/public\/assets\/index-\*\.js/,
    );
  });

  it('documents the Agentation mount verification in the README smoke section', () => {
    expect(readmeSmokeSection()).toMatch(/Agentation/);
  });

  it('keeps the in-browser mount proofs the smoke comments point at', () => {
    expect(
      existsSync(
        join(repoRoot, 'src', 'web', 'frontend', 'src', '__agentation-mount-check.test.tsx'),
      ),
      'jsdom Agentation mount check is missing',
    ).toBe(true);
    expect(
      existsSync(join(repoRoot, 'e2e', 'agentation-mount.spec.ts')),
      'playwright Agentation mount spec is missing',
    ).toBe(true);
  });
});
