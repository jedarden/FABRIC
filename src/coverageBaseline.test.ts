/**
 * Coverage Baseline Artifact Validation
 *
 * Validates that the digest-command coverage baseline artifacts are readable,
 * parseable, and internally consistent — the summary's tables must agree with
 * the raw reports they were derived from. Run before comparing a new coverage
 * run against the baseline; if these fail, the baseline cannot be trusted as
 * a comparison point.
 *
 * Artifacts validated (artifacts/coverage-baseline/):
 * - digest-command-baseline-coverage.json  raw per-file istanbul coverage
 * - metrics.json                           overall totals + path analysis
 * - digest-command-baseline-summary.md     human-readable summary of both
 * - digest-command-path-resolution-baseline.md  path-by-path breakdown
 *
 * Line convention (documented in the summary): a line is covered when any
 * statement spanning it executed — i.e. the union of start..end ranges of all
 * statements, not statement start lines only.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE_DIR = join(process.cwd(), 'artifacts', 'coverage-baseline');

/**
 * The coverage JSON keys paths against the absolute location of the repo at
 * recording time. Normalize to repo-relative so the comparison does not
 * depend on where the checkout lives.
 */
function toRepoRelative(p: string): string {
  const cwd = `${process.cwd()}/`;
  if (p.startsWith(cwd)) return p.slice(cwd.length);
  const marker = '/FABRIC/';
  const idx = p.lastIndexOf(marker);
  return idx >= 0 ? p.slice(idx + marker.length) : p;
}

const COVERAGE_JSON_PATH = join(BASELINE_DIR, 'digest-command-baseline-coverage.json');
const METRICS_JSON_PATH = join(BASELINE_DIR, 'metrics.json');
const SUMMARY_MD_PATH = join(BASELINE_DIR, 'digest-command-baseline-summary.md');
const PATH_RESOLUTION_MD_PATH = join(BASELINE_DIR, 'digest-command-path-resolution-baseline.md');

/** The six source files that make up the `fabric digest` command path. */
const DIGEST_SCOPE_FILES = [
  'src/analytics.ts',
  'src/cli.ts',
  'src/errorGrouping.ts',
  'src/pathResolver.ts',
  'src/sessionDigest.ts',
  'src/tui/components/SessionDigest.ts',
];

/**
 * Frozen baseline values (recorded 2026-07-29, corrected 2026-09-13,
 * refreshed 2026-09-17: covered counts unchanged, totals grew with the
 * codebase — see "Refresh history" in the baseline summary).
 */
const BASELINE_DIGEST_SCOPE = {
  lines: { covered: 937, total: 2419, pct: 38.74 },
  branches: { covered: 233, total: 697, pct: 33.43 },
  functions: { covered: 85, total: 205, pct: 41.46 },
  statements: { covered: 419, total: 1348, pct: 31.08 },
};

const BASELINE_OVERALL_PROJECT = {
  lines: { covered: 9095, total: 12945, pct: 70.25 },
  branches: { covered: 5169, total: 8348, pct: 61.91 },
  functions: { covered: 1586, total: 2393, pct: 66.27 },
  statements: { covered: 9676, total: 13983, pct: 69.19 },
};

interface IstanbulFileCoverage {
  path: string;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  fnMap: Record<string, unknown>;
  branchMap: Record<string, { locations: unknown[] }>;
  s: Record<string, number>;
  f: Record<string, number>;
  b: Record<string, number[]>;
  meta: unknown;
}

interface CoverageCounts {
  covered: number;
  total: number;
  pct: number;
}

/** Recompute coverage aggregates from raw istanbul per-file data. */
function aggregateIstanbul(
  files: Record<string, IstanbulFileCoverage>,
): Record<'lines' | 'branches' | 'functions' | 'statements', CoverageCounts> {
  const totals = {
    lines: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
  };

  for (const cov of Object.values(files)) {
    // Statements: s-map entries with count > 0
    const stmtCounts = Object.values(cov.s);
    totals.statements.covered += stmtCounts.filter((n) => n > 0).length;
    totals.statements.total += stmtCounts.length;

    // Lines: union of start..end lines spanned by statements
    const allLines = new Set<number>();
    const coveredLines = new Set<number>();
    for (const [id, count] of Object.entries(cov.s)) {
      const loc = cov.statementMap[id];
      if (!loc) continue;
      for (let line = loc.start.line; line <= loc.end.line; line++) {
        allLines.add(line);
        if (count > 0) coveredLines.add(line);
      }
    }
    totals.lines.covered += coveredLines.size;
    totals.lines.total += allLines.size;

    // Branches: individual arms in each b-map array
    for (const arms of Object.values(cov.b)) {
      totals.branches.covered += arms.filter((n) => n > 0).length;
      totals.branches.total += arms.length;
    }

    // Functions: f-map entries with count > 0
    const fnCounts = Object.values(cov.f);
    totals.functions.covered += fnCounts.filter((n) => n > 0).length;
    totals.functions.total += fnCounts.length;
  }

  return Object.fromEntries(
    Object.entries(totals).map(([key, t]) => [
      key,
      { ...t, pct: (100 * t.covered) / t.total },
    ]),
  ) as Record<'lines' | 'branches' | 'functions' | 'statements', CoverageCounts>;
}

/**
 * Parse a coverage table out of one `### <section>` block of the summary
 * markdown. Rows look like: `| Lines | 9,095 | 12,945 | 70.25% |`
 */
function parseSummaryTable(markdown: string, sectionPrefix: string): Record<string, CoverageCounts> {
  const section = markdown
    .split('### ')
    .find((chunk) => chunk.startsWith(sectionPrefix));
  expect(section, `summary must contain a "### ${sectionPrefix}" section`).toBeTruthy();

  const table: Record<string, CoverageCounts> = {};
  const rowRe =
    /\|\s*(Lines|Branches|Functions|Statements)\s*\|\s*([\d,]+)\s*\|\s*([\d,]+)\s*\|\s*([\d.]+)%\s*\|/g;
  for (const match of section!.matchAll(rowRe)) {
    table[match[1].toLowerCase()] = {
      covered: parseInt(match[2].replace(/,/g, ''), 10),
      total: parseInt(match[3].replace(/,/g, ''), 10),
      pct: parseFloat(match[4]),
    };
  }
  return table;
}

/** Stored percentages mix truncation and rounding (see summary notes). */
function expectPercentClose(actual: number, expectedStored: number): void {
  expect(
    Math.abs(actual - expectedStored),
    `percentage ${actual.toFixed(4)} should be within 0.01pp of stored ${expectedStored}`,
  ).toBeLessThanOrEqual(0.0101);
}

describe('coverage baseline artifacts', () => {
  test('baseline directory contains all four artifacts, non-empty and readable', () => {
    for (const p of [COVERAGE_JSON_PATH, METRICS_JSON_PATH, SUMMARY_MD_PATH, PATH_RESOLUTION_MD_PATH]) {
      const content = readFileSync(p, 'utf8');
      expect(content.length, `${p} should not be empty`).toBeGreaterThan(0);
    }
  });

  test('digest-command-baseline-coverage.json parses with exactly the 6 digest-scope files', () => {
    const raw = readFileSync(COVERAGE_JSON_PATH, 'utf8');
    const files = JSON.parse(raw) as Record<string, IstanbulFileCoverage>;
    expect(Object.keys(files).map(toRepoRelative).sort()).toEqual([...DIGEST_SCOPE_FILES].sort());
  });

  test('coverage entries are structurally valid istanbul data', () => {
    const files = JSON.parse(readFileSync(COVERAGE_JSON_PATH, 'utf8')) as Record<
      string,
      IstanbulFileCoverage
    >;

    for (const [name, cov] of Object.entries(files)) {
      for (const key of ['path', 'statementMap', 'fnMap', 'branchMap', 's', 'f', 'b']) {
        expect(cov, `${name} is missing "${key}"`).toHaveProperty(key);
      }
      expect(typeof cov.path).toBe('string');

      // Counts and maps must be keyed by the same ids
      expect(Object.keys(cov.s).sort()).toEqual(Object.keys(cov.statementMap).sort());
      expect(Object.keys(cov.f).sort()).toEqual(Object.keys(cov.fnMap).sort());
      expect(Object.keys(cov.b).sort()).toEqual(Object.keys(cov.branchMap).sort());

      // All counts are non-negative numbers; b values are per-arm arrays
      for (const [id, n] of Object.entries(cov.s)) {
        expect(typeof n, `s[${id}] in ${name}`).toBe('number');
        expect(n).toBeGreaterThanOrEqual(0);
      }
      for (const [id, arms] of Object.entries(cov.b)) {
        expect(Array.isArray(arms), `b[${id}] in ${name}`).toBe(true);
        expect(arms.length, `b[${id}] arms vs branchMap locations in ${name}`).toBe(
          cov.branchMap[id].locations.length,
        );
      }
      for (const n of Object.values(cov.f)) {
        expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('recomputed digest-scope aggregates match the frozen baseline values', () => {
    const files = JSON.parse(readFileSync(COVERAGE_JSON_PATH, 'utf8')) as Record<
      string,
      IstanbulFileCoverage
    >;
    const computed = aggregateIstanbul(files);

    for (const metric of ['lines', 'branches', 'functions', 'statements'] as const) {
      const expected = BASELINE_DIGEST_SCOPE[metric];
      expect(computed[metric].covered, `baseline ${metric} covered`).toBe(expected.covered);
      expect(computed[metric].total, `baseline ${metric} total`).toBe(expected.total);
      expectPercentClose(computed[metric].pct, expected.pct);
    }
  });

  test('summary markdown digest-scope table agrees with the coverage JSON', () => {
    const markdown = readFileSync(SUMMARY_MD_PATH, 'utf8');
    const table = parseSummaryTable(markdown, 'Digest-command scope');
    expect(Object.keys(table).sort()).toEqual(['branches', 'functions', 'lines', 'statements']);

    const files = JSON.parse(readFileSync(COVERAGE_JSON_PATH, 'utf8')) as Record<
      string,
      IstanbulFileCoverage
    >;
    const computed = aggregateIstanbul(files);

    for (const metric of ['lines', 'branches', 'functions', 'statements'] as const) {
      expect(table[metric].covered, `summary ${metric} covered`).toBe(computed[metric].covered);
      expect(table[metric].total, `summary ${metric} total`).toBe(computed[metric].total);
      expectPercentClose(computed[metric].pct, table[metric].pct);
    }
  });

  test('metrics.json parses and its overall-project totals match the frozen baseline', () => {
    // metrics.json stores percentages under "percentage" (not "pct")
    const metrics = JSON.parse(readFileSync(METRICS_JSON_PATH, 'utf8')) as {
      baseline_date: string;
      overall_project_coverage: Record<
        string,
        { covered: number; total: number; percentage: number }
      >;
      path_resolution_coverage: Record<
        string,
        { total_code_paths: number; covered_code_paths: number; coverage_percentage: number }
      >;
      test_suite: { total_tests: number; passing_tests: number; failing_tests: number; status: string };
    };

    expect(metrics.baseline_date).toBe('2026-07-29');

    for (const metric of ['lines', 'branches', 'functions', 'statements'] as const) {
      const stored = metrics.overall_project_coverage[metric];
      const expected = BASELINE_OVERALL_PROJECT[metric];
      expect(stored.covered, `metrics.json overall ${metric} covered`).toBe(expected.covered);
      expect(stored.total, `metrics.json overall ${metric} total`).toBe(expected.total);
      expectPercentClose(stored.percentage, expected.pct);
    }

    // Path-resolution logic: fully covered, and the suite recorded is green
    expect(metrics.path_resolution_coverage.resolveSource).toMatchObject({
      total_code_paths: 5,
      covered_code_paths: 5,
      coverage_percentage: 100,
    });
    expect(metrics.path_resolution_coverage.resolveFromOptions).toMatchObject({
      total_code_paths: 4,
      covered_code_paths: 4,
      coverage_percentage: 100,
    });
    expect(metrics.test_suite).toMatchObject({
      total_tests: 15,
      passing_tests: 15,
      failing_tests: 0,
      status: 'all_passing',
    });
  });

  test('summary markdown overall-project table agrees with metrics.json', () => {
    const markdown = readFileSync(SUMMARY_MD_PATH, 'utf8');
    const table = parseSummaryTable(markdown, 'Overall project');
    const metrics = JSON.parse(readFileSync(METRICS_JSON_PATH, 'utf8')) as {
      overall_project_coverage: Record<string, { covered: number; total: number; percentage: number }>;
    };

    for (const metric of ['lines', 'branches', 'functions', 'statements'] as const) {
      expect(table[metric].covered, `summary overall ${metric} covered`).toBe(
        metrics.overall_project_coverage[metric].covered,
      );
      expect(table[metric].total, `summary overall ${metric} total`).toBe(
        metrics.overall_project_coverage[metric].total,
      );
      expectPercentClose(
        metrics.overall_project_coverage[metric].percentage,
        table[metric].pct,
      );
    }
  });

  test('summary documents its scope, conventions, and source reports', () => {
    const markdown = readFileSync(SUMMARY_MD_PATH, 'utf8');

    // Every source report it references must exist alongside it
    for (const referenced of [
      'digest-command-baseline-coverage.json',
      'metrics.json',
      'digest-command-path-resolution-baseline.md',
    ]) {
      expect(markdown, `summary must reference ${referenced}`).toContain(referenced);
      expect(() => readFileSync(join(BASELINE_DIR, referenced), 'utf8')).not.toThrow();
    }

    // Scope: the six digest-command files are enumerated
    for (const file of DIGEST_SCOPE_FILES) {
      expect(markdown, `summary must list ${file} in scope`).toContain(file);
    }

    // Conventions a future comparison must honor
    expect(markdown).toContain('statementMap'); // line-coverage derivation
    expect(markdown).toContain('path-resolution-baseline.md'); // component breakdown
    expect(markdown).toContain('npm test -- --coverage'); // regeneration command
  });

  test('path-resolution baseline md documents the resolveSource/resolveFromOptions paths', () => {
    const markdown = readFileSync(PATH_RESOLUTION_MD_PATH, 'utf8');
    expect(markdown).toContain('resolveSource');
    expect(markdown).toContain('resolveFromOptions');
    expect(markdown.length).toBeGreaterThan(1000);
  });
});
