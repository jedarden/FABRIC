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

Final analysis command:

```text
npm run test:coverage -- --pool=forks --fileParallelism=false --maxWorkers=1
```

Result: 114 test files passed; 3,752 tests passed; 2 skipped. The command
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

Run the final command from the repository root. Compare its six-file raw report
with the frozen baseline using the aggregation described in
`artifacts/coverage-baseline/digest-command-baseline-summary.md`.
