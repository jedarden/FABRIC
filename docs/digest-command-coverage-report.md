# Digest Command Coverage Report

**Measurement date:** 2026-10-08  
**Scope:** `fabric digest` source-resolution and digest-generation path  
**Baseline:** `artifacts/coverage-baseline/digest-command-baseline-coverage.json`

## Summary

The tests added for the digest edge cases improved the frozen digest-scope
coverage in every metric. Direct coverage of the extracted path resolver is now
100% for lines, branches, functions, and statements. The report also confirms
that the resolver's nine logical paths (five in `resolveSource` and four in
`resolveFromOptions`) are exercised.

The digest scope still has uncovered code outside path resolution, primarily in
the all-command `cli.ts` entry point, `analytics.ts`, and the TUI
`SessionDigest` component. The configured 50% thresholds therefore still reject
the coverage command for lines, branches, and statements even though all tests
passed in the controlled run.

## Before and after

The comparison uses the repository's baseline convention: statements,
functions, and branch arms are counted from Istanbul maps; lines are the union
of the `statementMap` ranges for each file. Percentages are rounded to two
decimal places.

| Metric | Baseline | Final | Change |
| --- | ---: | ---: | ---: |
| Lines | 1,920 / 2,482 (77.36%) | 1,940 / 2,469 (78.57%) | **+1.22 pp**; +20 covered |
| Branches | 265 / 714 (37.11%) | 293 / 702 (41.74%) | **+4.62 pp**; +28 covered |
| Functions | 104 / 208 (50.00%) | 106 / 206 (51.46%) | **+1.46 pp**; +2 covered |
| Statements | 527 / 1,376 (38.30%) | 552 / 1,365 (40.44%) | **+2.14 pp**; +25 covered |

The small reductions in total counts reflect the resolver extraction from
`src/cli.ts` into `src/pathResolver.ts`; the final measurement covers the same
six-file digest scope defined by the baseline.

## Path-resolution result

| Metric | Baseline `src/pathResolver.ts` | Final `src/pathResolver.ts` |
| --- | ---: | ---: |
| Lines | 0 / 13 (0.00%) | 13 / 13 (100.00%) |
| Branches | 0 / 10 (0.00%) | 10 / 10 (100.00%) |
| Functions | 0 / 2 (0.00%) | 2 / 2 (100.00%) |
| Statements | 0 / 11 (0.00%) | 11 / 11 (100.00%) |

Logical path coverage:

- `resolveSource`: 5 / 5 paths — tilde directory, tilde file, absolute
  directory, absolute file, and missing-path error.
- `resolveFromOptions`: 4 / 4 paths — validated `--source` precedence, tilde
  legacy file option, non-tilde legacy file option, and the default log
  directory.

## Verification

> **Current status (2026-10-23, bead fabric-798c7ae3):** the standard
> `npm run test:coverage` command now **exits 0** — verified live on
> 2026-10-23 (exit 0; 116 test files, 3,774 passed, 2 skipped) after the
> threshold right-sizing in the
> [2026-10-23 section](#2026-10-23-threshold-right-sizing-bead-fabric-f8802679).
> The exit-code-1 result below is the historical 2026-10-08 measurement taken
> before the thresholds were retuned; it no longer describes the expected
> outcome of any current command.

Final analysis command:

```text
npm run test:coverage -- --pool=forks --fileParallelism=false --maxWorkers=1
```

Result (2026-10-08, pre-right-sizing): 114 test files passed; 3,752 tests passed; 2 skipped. The command
returned exit code 1 only because the configured 50% coverage thresholds are
not yet met for lines (41.50%), branches (41.73%), and statements (40.43%);
the final digest-scope values above use the documented `statementMap`
aggregation rather than Vitest's native line total. The generated raw report is
`artifacts/coverage/coverage-final.json`.

The standard parallel command was also attempted and returned exit code 1
after five unrelated web-server tests timed out at the default 5-second test
limit. The controlled single-worker run removed those timeouts and is the
measurement reported here.

## Reproduction

Run the standard parallel command (`npm run test:coverage`) from the
repository root — since the 2026-10-23 web-server timeout headroom
(bead fabric-7165df98, below) it completes green (exit 0) with no controlled
invocation; the single-worker command in the Verification section is kept
only as the historical 2026-10-08 record. Compare the six-file raw report
with the frozen baseline using the aggregation described in
`artifacts/coverage-baseline/digest-command-baseline-summary.md`.

## 2026-10-23 threshold right-sizing (bead fabric-f8802679)

The measurement above was reproduced unchanged on 2026-10-23 with the default
parallel command (`npx vitest run --coverage`): 116 test files, 3,774 passed,
2 skipped, and the same global totals — statements 40.43% (552/1365), branches
41.73% (293/702), functions 51.45% (106/206), lines 41.50% (520/1253). The
five web-server timeouts from the 2026-10-08 parallel attempt did not
reproduce; the run completed in ~53 s and the only failure was the threshold
gate itself.

A permanently red gate provides no regression signal and pushes every
measurement onto the controlled single-worker workaround, so the thresholds
were right-sized to the maintained baseline rather than chased. The shortfall
is structural, not a test gap on the digest path: `sessionDigest.ts` and
`pathResolver.ts` measure 100% and `errorGrouping.ts` 98.5%, while the
all-command `src/cli.ts` entry point measures 5.24% lines, `src/analytics.ts`
20.43%, and the TUI `SessionDigest` component 33.57%.

`vitest.config.ts` now floors each measured value to a whole percent minus one
point of churn headroom:

| Metric    | Measured | Threshold |
| --------- | -------: | --------: |
| Lines     | 41.50%   | 40        |
| Branches  | 41.73%   | 40        |
| Functions | 51.45%   | 50        |
| Statements| 40.43%   | 39        |

`npm run test:coverage` exits 0 again; ordinary churn on the six in-scope
files stays green, and a real regression (~19 covered lines, ~12 branches,
~20 statements) still fails the gate. Restoring the 50/50/50/50 gate after
raising `cli.ts`, `analytics.ts`, and the TUI `SessionDigest` component is
tracked by follow-up bead fabric-d48e8f7f.

## 2026-10-23 web-server timeout headroom (bead fabric-7165df98)

The five web-server timeouts from the 2026-10-08 parallel attempt are closed
out, and the controlled single-worker invocation above is retired: the
reproduction command for this report is now the standard parallel
`npm run test:coverage`.

The 2026-10-08 run did not record the five test names. A live measurement
under the standard parallel invocation (116 files, 3,774 passed, ~53 s)
identifies the failure shape instead: the slowest tests in every web-server
suite are the suite's first tests, which absorb the instrumented
transform + import + listener-startup window (`server.getRoutes.test.ts`
peaked at 2.2 s on an unloaded box; actual test-async time is tens of
milliseconds). The 2026-10-08 controlled run passed single-worker WITH the
same instrumentation, so the cause is coverage-instrumentation plus
parallel-scheduling overhead on a loaded box, not genuinely slow async paths.

The fix is explicit per-suite headroom rather than a slower workaround: each
web-server suite that binds real listeners — `server.test.ts`,
`server.getRoutes.test.ts`, `server.authRoutes.test.ts`,
`server.metrics.test.ts`, `server.alerts.test.ts`, `server.heap.test.ts`,
`eventsApi.contract.test.ts`, `retentionControls.integration.test.ts` —
now sets `vi.setConfig({ testTimeout: 30_000 })`, so instrumented startup on
a contended box cannot trip the 5 s default while a genuine hang still fails
fast at 30 s. Verified 2026-10-23: the standard parallel invocation exits 0
twice in a row (with and without the headroom commit in history — the first
run reproduced the 2026-10-23 baseline, the second ran the patched suites).

## 2026-10-23 dispatch resolution and CI-visibility decision (bead fabric-36f7093d)

The dispatch behind this report asked for one of three resolutions — (a) add
tests until the global gate passes, (b) scope the gate to a defined inventory,
or (c) lower/replace the threshold — plus a decision on whether coverage
should join the `fabric-ci` Argo template. Resolution:

- **Executed — right-size the gate (option c):** closed twin bead
  fabric-f8802679 right-sized the thresholds to the measured baseline in
  commit b515547 (section above). No duplicate implementation was performed
  here.
- **Owned elsewhere — restore 50/50/50/50 (option a):** open follow-up bead
  fabric-d48e8f7f owns raising `src/cli.ts`, `src/analytics.ts`, and the TUI
  `SessionDigest` component, then restoring the 50% gate with real margin.
- **Decided here — CI visibility: coverage should join `fabric-ci`,
  replacing the `npm test` step rather than being added alongside it.**

Rationale for the CI decision:

1. The gate is green again, so the historical reason it stayed out of CI (a
   permanently red gate would fail every run) is gone. Without a coverage
   step, a change that silently drops the six-file digest scope below the
   floor ships unflagged — exactly the failure shape this dispatch was
   admitted to close.
2. `npm run test:coverage` is a strict superset of `npm test`: the same vitest
   suite (verified above: identical 116 files / 3,774 passed / 2 skipped),
   any test failure still fails the step, plus the threshold gate. Replacing
   keeps CI time near-flat — one instrumented run (~53 s locally, measured
   twice on 2026-10-23) instead of the suite twice back to back.
3. `pretest:coverage` runs `npm run build`, which the template already
   performs as its own step; the redundant rebuild is a no-op tsc pass and
   needs no template restructuring.

The template edit itself is a one-line change in `jedarden/declarative-config`
(`k8s/iad-ci/argo-workflows/fabric-ci-workflowtemplate.yml`: `npm test` →
`npm run test:coverage`). That repository is outside this one, so the edit is
follow-up work for declarative-config, recorded here and on the owning bead
for admission. Fallback if a CI runner cannot afford the instrumented run:
keep `npm test` and add `npm run test:coverage` as an additional step — same
signal, roughly doubled suite time.

One scope caution to carry into that edit: `coverage.include` in
`vitest.config.ts` is the six-file digest scope, so the CI gate would protect
that scope only, not the whole tree. That is the scoping this report
documents; widening it belongs to fabric-d48e8f7f alongside the 50% restore.

Fresh verification on the committed tree (bead fabric-36f7093d, 2026-10-23):
`npx tsc --noEmit` exit 0; `npx vitest run` exit 0 (116 files, 3,774 passed,
2 skipped); `npm run test:coverage` exit 0 — totals identical to the
2026-10-08/23 measurement (statements 40.43% 552/1365, branches 41.73%
293/702, functions 51.45% 106/206, lines 41.50% 520/1253), confirming the
right-sized gate holds with its headroom intact.
