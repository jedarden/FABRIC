# Digest Command Coverage Baseline Summary

**Baseline recorded:** 2026-07-29
**Summary corrected:** 2026-09-13 (fixed branch-count typo, restored line metrics, added digest-scope totals)
**Project:** FABRIC (Flow Analysis & Bead Reporting Interface Console)
**Command scope:** `fabric digest` — session digest generation and its path-resolution logic

## Scope

This baseline records two distinct measurements. Do not compare a new run against
the wrong one:

1. **Digest-command scope** — per-file istanbul coverage
   (`digest-command-baseline-coverage.json`) covering the six source files that
   make up the `fabric digest` command path:
   - `src/analytics.ts`
   - `src/cli.ts`
   - `src/errorGrouping.ts`
   - `src/pathResolver.ts`
   - `src/sessionDigest.ts`
   - `src/tui/components/SessionDigest.ts`
2. **Overall project** — full-suite totals as recorded in `metrics.json`
   (9,676/13,983 statements across the whole repo, not just the files above).

## Key Baseline Metrics

### Digest-command scope (6 files listed above)

| Metric   | Covered | Total | Percentage |
|----------|---------|-------|------------|
| Lines       | 937   | 2,387 | 39.25% |
| Branches    | 233   |   687 | 33.92% |
| Functions   |  85   |   205 | 41.46% |
| Statements  | 419   | 1,335 | 31.39% |

Totals aggregated from the per-file counts in
`digest-command-baseline-coverage.json`. Line coverage is derived from the
`statementMap` (a line counts as covered when any statement on it executed);
the raw istanbul JSON does not carry a separate line counter.

### Overall project (full test run)

| Metric   | Covered | Total | Percentage |
|----------|---------|-------|------------|
| Lines       | 9,095 | 12,945 | 70.25% |
| Branches    | 5,169 |  8,348 | 61.91% |
| Functions   | 1,586 |  2,393 | 66.27% |
| Statements  | 9,676 | 13,983 | 69.19% |

Percentages are as recorded in `metrics.json`. Recomputing from the raw
covered/total counts rounds these up by ~0.01pp (69.20 / 61.92 / 66.28 /
70.26) — the stored values truncate. Either convention is fine; pick one
before comparing runs.

### Path-resolution logic (component level)

From `metrics.json`, measured by `src/pathResolver.test.ts` (15/15 passing):

| Function                                        | Code paths | Coverage |
|-------------------------------------------------|-----------|----------|
| `resolveSource` (`src/cli.ts:52-63`)            | 5/5       | 100%     |
| `resolveFromOptions` (`src/cli.ts:95-99`)       | 4/4       | 100%     |

All tilde-expansion, directory-vs-file detection, non-existent-path error
handling, option-precedence, and default-source paths are covered. See
`digest-command-path-resolution-baseline.md` for the path-by-path breakdown.

## Analysis Notes

- The digest-command scope sits far below overall project coverage because the
  scoped run exercised only digest-related tests; `src/cli.ts` carries every
  other CLI command, none of which those tests touch. This is expected, not a
  regression signal.
- Within the digest scope, function coverage (41.46%) leads branch coverage
  (33.92%) — the gap is untested branch arms (error paths, option variants),
  the usual place to look for improvement.
- Path resolution itself is fully covered at the code-path level; regressions
  there are a test failure, not a coverage drift.

## Source Reports

| File | Contents |
|------|----------|
| `digest-command-baseline-coverage.json` | Raw per-file istanbul coverage for the 6 digest-command files |
| `metrics.json` | Overall project totals, path-resolution path analysis, test-suite status |
| `digest-command-path-resolution-baseline.md` | Detailed path-by-path analysis of `resolveSource` / `resolveFromOptions` |

## Comparing Against This Baseline

```bash
# Full-suite coverage (compare against "Overall project" above)
npm test -- --coverage

# Digest-scope regeneration: run only the digest/path-resolution tests and
# aggregate the resulting per-file istanbul output the same way
# (statements = s-map entries > 0; branches = individual arms in b-map > 0;
# functions = f-map entries > 0; lines = distinct statementMap lines executed)
```

A comparison is only meaningful when scope, aggregation, and rounding convention
all match this document.
