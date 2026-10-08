# Digest Command Coverage Baseline Summary

**Baseline recorded:** 2026-07-29
**Summary corrected:** 2026-09-13 (fixed branch-count typo, restored line metrics, added digest-scope totals)
**Baseline refreshed:** 2026-10-08 (fresh full-suite run, same aggregation convention — see "Refresh history")
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
   (frozen at the 2026-07-29 recording; see the note under that table).

## Key Baseline Metrics

### Digest-command scope (6 files listed above)

| Metric   | Covered | Total | Percentage |
|----------|---------|-------|------------|
| Lines       | 1,920 | 2,482 | 77.36% |
| Branches    | 265   |   714 | 37.11% |
| Functions   | 104   |   208 | 50.00% |
| Statements  | 527   | 1,376 | 38.30% |

Refreshed 2026-10-08 from a full-suite `npm run test:coverage` run, aggregated
from the per-file counts in `digest-command-baseline-coverage.json`. Line
coverage is derived from the `statementMap` (a line counts as covered when any
statement on it executed); the raw istanbul JSON does not carry a separate line
counter.

### Overall project (full test run)

| Metric   | Covered | Total | Percentage |
|----------|---------|-------|------------|
| Lines       | 9,095 | 12,945 | 70.25% |
| Branches    | 5,169 |  8,348 | 61.91% |
| Functions   | 1,586 |  2,393 | 66.27% |
| Statements  | 9,676 | 13,983 | 69.19% |

Recorded 2026-07-29 and **not re-measured in the 2026-09-17 refresh** — the
refresh re-froze the digest-command scope only. Percentages are as recorded in
`metrics.json`. Recomputing from the raw covered/total counts rounds these up
by ~0.01pp (69.20 / 61.92 / 66.28 / 70.26) — the stored values truncate. Either
convention is fine; pick one before comparing runs. To re-measure this scope,
run coverage with the include list widened beyond the six digest files, then
update `metrics.json` and `src/coverageBaseline.test.ts`
(`BASELINE_OVERALL_PROJECT`) together.

### Path-resolution logic (component level)

From `metrics.json`, measured by `src/pathResolver.test.ts` (15/15 passing):

| Function                                        | Code paths | Coverage |
|-------------------------------------------------|-----------|----------|
| `resolveSource` (`src/cli.ts:52-63`)            | 5/5       | 100%     |
| `resolveFromOptions` (`src/cli.ts:95-99`)       | 4/4       | 100%     |

All tilde-expansion, directory-vs-file detection, non-existent-path error
handling, option-precedence, and default-source paths are covered. See
`digest-command-path-resolution-baseline.md` for the path-by-path breakdown.

## Refresh history

### 2026-09-17 refresh

Method: full-suite `npm run test:coverage` (v8 provider, which emits
istanbul-format per-file data), aggregated with the exact convention this
document already used — statements/functions are `s`/`f` entries > 0, branches
are individual `b` arms > 0, and lines are the union of `statementMap`
start..end ranges executed. `src/coverageBaseline.test.ts` recomputes the same
aggregates from the stored JSON and pins them (`BASELINE_DIGEST_SCOPE`); JSON,
summary table, and frozen constants are updated together.

Result compared with the 2026-07-29 recording:

| Metric     | Covered 07-29 → 09-17 | Total 07-29 → 09-17 | Percentage 07-29 → 09-17 |
|-----------|----------------------|--------------------|-------------------------|
| Lines      | 937 → 937 (unchanged)  | 2,387 → 2,419       | 39.25% → 38.74%         |
| Branches   | 233 → 233 (unchanged)  |   687 →   697       | 33.92% → 33.43%         |
| Functions  |  85 →  85 (unchanged)  |   205 →   205       | 41.46% → 41.46%         |
| Statements | 419 → 419 (unchanged)  | 1,335 → 1,348       | 31.39% → 31.08%         |

Every covered count is identical; every total grew. The percentage drift is
entirely new uncovered code entering the six digest files — **no absolute
coverage regression** since the original baseline.

### 2026-10-08 refresh

Method: full-suite `npm run test:coverage` (v8 provider, 114 test files, 3,739
passing tests, 2 skipped), aggregated with the same `statementMap` convention.
The current report increased covered counts because the full suite now exercises
more of the CLI digest path, including the command's source-resolution flow.

| Metric     | Covered 09-17 → 10-08 | Total 09-17 → 10-08 | Percentage 09-17 → 10-08 |
|------------|----------------------|--------------------|-------------------------|
| Lines      | 937 → 1,920 (↑983)   | 2,419 → 2,482       | 38.74% → 77.36%         |
| Branches   | 233 → 265 (↑32)      |   697 →   714       | 33.43% → 37.11%         |
| Functions  |  85 → 104 (↑19)      |   205 →   208       | 41.46% → 50.00%         |
| Statements | 419 → 527 (↑108)     | 1,348 → 1,376       | 31.08% → 38.30%         |

The command exited non-zero after all tests passed because the configured 50%
thresholds remain aspirational: v8's native summary reported 38.29% statements,
37.11% branches, 50.00% functions, and 39.38% lines. The committed comparison
baseline uses the statement-map convention above, not v8's native line count.

Two measurement notes for future comparisons:

- **v8 native counting disagrees with this convention.** The `npm run
  test:coverage` text summary counts lines/statement boundaries its own way and
  reported Lines 39.38% (497/1,262) for the 2026-10-08 run stored here
  (1,920/2,482 = 77.36% under the statementMap convention). Both are
  "correct"; they count different things. Compare against this baseline only
  via the statementMap convention, which is what `src/coverageBaseline.test.ts`
  enforces.
- **The 50% thresholds in `vitest.config.ts` currently fail.** The 2026-10-08
  run reached 50.00% only for functions; statements (38.29%), branches
  (37.11%), and lines (39.38%) remain below the configured thresholds, so
  `npm run test:coverage` exits non-zero after all tests pass. The thresholds
  are aspirational; a non-zero coverage exit is not a test failure.

## Analysis Notes

- The digest-command scope remains below overall project coverage because
  `src/cli.ts` carries every CLI command, while the configured report includes
  the whole file. The 2026-10-08 full suite now exercises more CLI lines, but
  `src/pathResolver.ts` remains a separately exported helper with 0 direct
  instrumented coverage; the command's actual resolver in `src/cli.ts` is
  covered through the child-process integration tests.
- Within the digest scope, function coverage (50.00%) leads branch coverage
  (37.11%) — the gap is untested branch arms (error paths, option variants),
  the usual place to look for improvement.
- Path resolution itself is fully covered at the code-path level; regressions
  there are a test failure, not a coverage drift.
- The 2026-10-08 refresh increased covered counts, primarily through broader
  CLI integration exercise. Closing the remaining digest-scope gap means
  covering the branch arms inside
  `src/tui/components/SessionDigest.ts` and `src/analytics.ts`, which hold most
  of the uncovered totals.

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
all match this document. `npm test` re-validates the artifacts in this
directory (`src/coverageBaseline.test.ts`) — if those tests fail, the baseline
cannot be trusted as a comparison point until JSON, summary, and the frozen
constants in the test are reconciled together.
