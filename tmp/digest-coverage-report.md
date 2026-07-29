╔══════════════════════════════════════════════════════════════════════════════╗
║              FABRIC DIGEST COMMAND COVERAGE ANALYSIS REPORT                 ║
║                         Generated: 2026-07-29                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

📄 src/sessionDigest.ts
   Session digest generator - core logic for generating session summaries
   ┌─────────────────────────────────────────────────────────────┐
   │ Statements:  193/ 207 ( 93.2%) │
   │ Branches:    112/ 133 ( 84.2%) │
   │ Functions:    27/  27 (100.0%) │
   └─────────────────────────────────────────────────────────────┘

❌ src/pathResolver.ts
   Path resolution module - handles source path validation for digest command
   ⚠️  NO COVERAGE DATA FOUND - File not included in test run

📄 src/tui/components/SessionDigest.ts
   TUI Session Digest component - terminal UI for digest display
   ┌─────────────────────────────────────────────────────────────┐
   │ Statements:   85/ 447 ( 19.0%) │
   │ Branches:     83/ 176 ( 47.2%) │
   │ Functions:    13/  46 ( 28.3%) │
   └─────────────────────────────────────────────────────────────┘

📄 src/errorGrouping.ts
   Error grouping and categorization - error analysis for digest reports
   ┌─────────────────────────────────────────────────────────────┐
   │ Statements:  139/ 141 ( 98.6%) │
   │ Branches:     38/  43 ( 88.4%) │
   │ Functions:    45/  45 (100.0%) │
   └─────────────────────────────────────────────────────────────┘

📄 src/analytics.ts
   Analytics module - statistical analysis for session data
   ┌─────────────────────────────────────────────────────────────┐
   │ Statements:    2/ 163 (  1.2%) │
   │ Branches:      0/ 105 (  0.0%) │
   │ Functions:     0/  37 (  0.0%) │
   └─────────────────────────────────────────────────────────────┘

❌ src/cli.ts
   CLI entry point - command-line interface including digest command
   ⚠️  NO COVERAGE DATA FOUND - File not included in test run

╔══════════════════════════════════════════════════════════════════════════════╗
║                         OVERALL DIGEST COMMAND COVERAGE                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

Total Statements: 419/958 (43.7%)
Total Branches:   233/457 (51.0%)
Total Functions:  85/155 (54.8%)

🔍 KEY FINDINGS:
   • High coverage in core logic files (sessionDigest.ts, errorGrouping.ts)
   • Low coverage in analytics.ts (1.2% statements - needs test enhancement)
   • Moderate coverage in TUI components (SessionDigest.ts component)
   • Missing coverage data for pathResolver.ts and cli.ts - integration gap

═══════════════════════════════════════════════════════════════════════════════

## DETAILED COMPONENT ANALYSIS

### 1. sessionDigest.ts (93.2% statements - EXCELLENT)
✅ **Strengths:**
- 100% function coverage - all functions are tested
- Strong statement coverage (93.2%) indicates comprehensive testing
- Good branch coverage (84.2%) shows most code paths are exercised

⚠️ **Areas for improvement:**
- 14 uncovered statements - edge cases in error handling or formatting
- 21 uncovered branches - complex conditional logic needs more test scenarios

### 2. errorGrouping.ts (98.6% statements - EXCELLENT)
✅ **Strengths:**
- Nearly perfect statement coverage (98.6%)
- 100% function coverage
- Strong branch coverage (88.4%)

⚠️ **Areas for improvement:**
- 2 uncovered statements - minimal gap, likely edge cases
- 5 uncovered branches - some categorization logic may need tests

### 3. SessionDigest.ts TUI Component (19.0% statements - POOR)
❌ **Critical Issues:**
- Very low statement coverage (19.0%)
- Low function coverage (28.3%)
- Many UI components and interactions are untested

🔧 **Immediate Action Needed:**
- Add unit tests for component rendering
- Test user interactions (keyboard navigation, display modes)
- Test integration with digest data
- Add tests for different digest states (loading, error, empty)

### 4. analytics.ts (1.2% statements - CRITICAL)
❌ **Critical Issues:**
- Minimal coverage - only 2/163 statements covered
- Zero branch and function coverage
- Major analytics functionality is completely untested

🔧 **Immediate Action Needed:**
- Priority: HIGH - This file is essentially untested
- Add comprehensive unit tests for all analytics functions
- Test statistical calculations and data aggregation
- Add tests for time-series analysis and reporting

### 5. pathResolver.ts (NO COVERAGE - CRITICAL GAP)
❌ **Critical Issues:**
- No coverage data indicates file may not be imported by any test
- Critical digest command functionality is untested
- Path validation and error handling are not covered

🔧 **Immediate Action Needed:**
- Create unit tests for resolveSource() function
- Test tilde expansion behavior
- Test filesystem validation and error cases
- Add integration tests for resolveFromOptions()

### 6. cli.ts (NO COVERAGE - CRITICAL GAP)
❌ **Critical Issues:**
- CLI entry point for digest command is untested
- Command-line argument parsing not covered
- Integration between CLI and digest logic not verified

🔧 **Immediate Action Needed:**
- Create CLI integration tests
- Test digest command invocation with various arguments
- Test error handling and user feedback
- Verify help text and command structure

═══════════════════════════════════════════════════════════════════════════════

## COVERAGE THRESHOLDS ANALYSIS

Vitest configuration sets these thresholds for digest command:
- Lines: 50%
- Functions: 50% 
- Branches: 50%
- Statements: 50%

**Current Status vs Thresholds:**
- ✅ Functions: 54.8% (exceeds 50% threshold)
- ✅ Branches: 51.0% (exceeds 50% threshold)
- ❌ Statements: 43.7% (below 50% threshold)
- ❓ Lines: Data unavailable in coverage format

## RECOMMENDATIONS

### High Priority
1. **Create pathResolver.ts tests** - Critical digest functionality is completely untested
2. **Add analytics.ts tests** - Major module with minimal coverage
3. **Create CLI integration tests** - Verify end-to-end digest command functionality

### Medium Priority  
4. **Enhance SessionDigest.ts component tests** - Improve UI test coverage from 19% to >50%
5. **Add edge case tests** - Cover remaining gaps in sessionDigest.ts and errorGrouping.ts

### Test Strategy
- Unit tests: Focus on individual functions and components
- Integration tests: Test digest command end-to-end with real data
- Component tests: Test TUI rendering and user interactions
- Error cases: Test failure modes and edge conditions

## VERIFICATION STATUS

✅ Coverage tool executed successfully  
✅ Line-by-line metrics generated  
✅ Percentage metrics calculated  
⚠️ Report includes most digest components (missing pathResolver.ts and cli.ts)  
✅ Raw coverage data saved to temporary location  

Generated by: vitest run --coverage
Coverage provider: v8
Report location: coverage/coverage-final.json