# Coverage Baselines

Committed reference snapshots of FABRIC's test coverage. A baseline is the
frozen number a future coverage run is compared against; the raw generated
reports live in `artifacts/coverage/` (gitignored output, regenerated on every
`npm run test:coverage` run) — only the frozen baselines in this directory are
tracked.

`src/coverageBaseline.test.ts` validates everything here as part of `npm test`:
it recomputes the aggregates from the stored JSON and pins them against frozen
constants. If that test fails, the baseline cannot be trusted until the files
below and the test constants are reconciled together.

## What lives here

| File | Contents |
|------|----------|
| `digest-command-baseline-coverage.json` | Raw per-file istanbul coverage for the six `fabric digest` source files |
| `metrics.json` | Overall project totals (frozen 2026-07-29) + path-resolution path analysis |
| `digest-command-baseline-summary.md` | Human-readable summary, scope definitions, and refresh history — the authoritative convention document |
| `digest-command-path-resolution-baseline.md` | Path-by-path breakdown of `resolveSource` / `resolveFromOptions` |

## Refresh convention

1. Refresh = a full-suite `npm run test:coverage` run, aggregated with the
   **statementMap convention** this directory standardizes on: statements and
   functions are `s`/`f` entries > 0, branches are individual `b` arms > 0, and
   lines are the union of `statementMap` start..end ranges executed. Do not
   compare against v8's native counting — it disagrees with this convention by
   design (see "measurement notes" in the summary).
2. Update **together, in one change**: the coverage JSON, the summary table,
   and the frozen constants in `src/coverageBaseline.test.ts`
   (`BASELINE_DIGEST_SCOPE`, and `BASELINE_OVERALL_PROJECT` only if the
   overall-project scope in `metrics.json` was re-measured). All three must
   agree; `npm test` enforces it.
3. Append an entry to "Refresh history" in
   `digest-command-baseline-summary.md`, comparing covered counts absolutely
   (not just percentages — totals grow as code is added, so percentage drift
   alone is not a regression signal).
4. Re-run `npm test` before committing; it re-validates the artifacts in this
   directory.

`npm run test:coverage` may exit non-zero even when all tests pass — the 50%
thresholds in `vitest.config.ts` are aspirational and currently unmet. A
non-zero coverage exit is not a test failure.
