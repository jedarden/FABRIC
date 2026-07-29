# Digest Command Coverage Baseline

**Generated:** 2026-07-29  
**Project:** FABRIC (Flow Analysis & Bead Reporting Interface Console)

## Baseline Coverage Metrics

### Overall Coverage Summary
- **Statements:** 9676/13983 (69.20%)
- **Branches:** 5169/8348 (61.92%)
- **Functions:** 1586/2393 (66.28%)
- **Lines:** 0/0 (0.00%)

### Key Metrics Breakdown

| Metric Type | Covered | Total | Percentage |
|-------------|---------|-------|------------|
| Statements | 9,676 | 13,983 | 69.20% |
| Branches | 5,168 | 8,348 | 61.92% |
| Functions | 1,586 | 2,393 | 66.28% |
| Lines | 0 | 0 | 0.00% |

## Files and Coverage

### Coverage Data Files
- **Main Coverage Report:** `digest-command-baseline-coverage.json`
- **Metrics JSON:** `metrics.json`
- **Path Resolution Baseline:** `digest-command-path-resolution-baseline.md`

## Analysis Notes

### Coverage Strengths
- Statement coverage at 69.20% indicates good overall test coverage
- Function coverage at 66.28% shows most functions are tested
- Branch coverage at 61.92% is reasonable but could be improved

### Areas for Improvement
- Line coverage shows 0/0 - this metric may not be properly tracked
- Branch coverage could be improved to match statement coverage
- Function coverage gap suggests some edge cases not tested

## Test Suite Status
- Tests run via Vitest
- Integration tests included
- Some file descriptor issues in tests (EMFILE errors) that don't affect coverage

## Usage for Future Comparison

This baseline serves as the reference point for:
1. Measuring coverage improvements over time
2. Identifying coverage regressions
3. Setting targets for test coverage goals
4. Validating that new features include appropriate tests

To compare against this baseline:
```bash
# Generate new coverage
npm test

# Extract metrics and compare with baseline
node /tmp/extract_coverage.js
```

## Repository Context
- **Path:** /home/coding/FABRIC
- **Stack:** TypeScript + Node.js, Express, WebSocket, React frontend (Vite), blessed TUI
- **Test Framework:** Vitest
- **Coverage Tool:** Vitest built-in coverage (c8)

## Next Steps
1. Set coverage improvement targets (e.g., 75% statements, 70% branches)
2. Focus on increasing branch coverage through edge case testing
3. Investigate line coverage metric collection
4. Add tests for uncovered critical paths