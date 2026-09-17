# Digest Command Coverage Baseline Summary

**Baseline recorded:** 2026-07-29
**Summary corrected:** 2026-09-13 (fixed branch-count typo, restored line metrics, added digest-scope totals)
**Baseline refreshed:** 2026-09-17 (fresh full-suite run, same aggregation convention — see "Refresh history")
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
| Lines       | 937   | 2,419 | 38.74% |
| Branches    | 233   |   697 | 33.43% |
| Functions   |  85   |   205 | 41.46% |
| Statements  | 419   | 1,348 | 31.08% |

Refreshed 2026-09-17 from a full-suite `npm run test:coverage` run, aggregated
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

Two measurement notes for future comparisons:

- **v8 native counting disagrees with this convention.** The `npm run
  test:coverage` text summary counts lines/statement boundaries its own way and
  reported Lines 31.71% (393/1,239) for the same run stored here (937/2,419 =
  38.74% under the statementMap convention). Both are "correct"; they count
  different things. Compare against this baseline only via the statementMap
  convention, which is what `src/coverageBaseline.test.ts` enforces.
- **The 50% thresholds in `vitest.config.ts` currently fail.** On both the
  2026-07-29 recording and the 2026-09-17 refresh, digest-scope coverage
  (31–41% by v8 native counting) sits below the configured 50% thresholds, so
  `npm run test:coverage` exits non-zero after all tests pass. The thresholds
  are aspirational; a non-zero coverage exit is not a test failure.

## Analysis Notes

- The digest-command scope sits far below overall project coverage because the
  scoped run exercised only digest-related tests; `src/cli.ts` carries every
  other CLI command, none of which those tests touch. This is expected, not a
  regression signal. (In the 2026-09-17 run `src/cli.ts` and
  `src/pathResolver.ts` contributed 0 covered lines to the istanbul aggregate —
  their logic is pinned instead by the component-level tests referenced above.)
- Within the digest scope, function coverage (41.46%) leads branch coverage
  (33.43%) — the gap is untested branch arms (error paths, option variants),
  the usual place to look for improvement.
- Path resolution itself is fully covered at the code-path level; regressions
  there are a test failure, not a coverage drift.
- The 2026-09-17 refresh left every covered count unchanged, so improvement
  work since 2026-07-29 has gone into new code and non-digest surfaces. Closing
  the digest-scope gap means covering the branch arms inside
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
