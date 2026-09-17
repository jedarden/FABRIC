# Digest Command Source Files and Test Coverage Inventory

**Generated:** 2026-07-29  
**Purpose:** Document all source files implementing digest command functionality and corresponding test coverage

## Overview

The `fabric digest` command generates session summaries from NEEDLE worker log files. It supports both directory and file sources, with comprehensive path resolution, event aggregation, and markdown output formatting.

## Core Digest Command Implementation Files

### 1. CLI Entry Point
**File:** `src/cli.ts`  
**Role:** Digest command registration and option handling  
**Key Functions:**
- `digest` command definition with Commander.js
- Command option parsing: `--source`, `-f/--file`, `-o/--output`, `--worker`, `--since`, `--until`
- Digest execution flow: path resolution → event loading → digest generation → markdown output
- Integration with `SessionDigestGenerator` and `formatDigestAsMarkdown`

**Lines:** ~80 lines for digest command implementation  
**Dependencies:** `sessionDigest.ts`, `store.ts`, `directoryTailer.ts`, `parser.ts`, `costTracking.ts`

### 2. Core Digest Generation Logic
**File:** `src/sessionDigest.ts`  
**Role:** Session digest generation and markdown formatting  
**Key Classes/Functions:**
- `SessionDigestGenerator` - Main digest generation class
- `generateDigest()` - Extract beads, files, errors, workers, cost from events
- `extractBeadCompletions()` - Identify completed beads from event patterns
- `extractFileModifications()` - Aggregate file operations by path
- `extractErrors()` - Collect and categorize errors
- `generateWorkerSummaries()` - Per-worker activity statistics
- `formatDigestAsMarkdown()` - Convert digest to formatted markdown output

**Lines:** ~500 lines  
**Dependencies:** `types.ts`, `costTracking.ts`, `errorGrouping.ts`

### 2a. AI Narrative Layer (optional, added 2026-09-16)
**File:** `src/digestAi.ts`  
**Role:** Optional AI-generated narrative appended to the deterministic digest when `fabric digest --ai` is used  
**Key Functions:**
- `resolveDigestAiConfig()` - Resolve provider config from `FABRIC_DIGEST_AI_*` / `ANTHROPIC_API_KEY` env vars; returns null when no key is set
- `buildDigestAiPrompt()` - Render the digest's extracted data as a bounded prompt (caps: 20 workers / 20 beads / 15 files / 10 errors)
- `generateAiDigestNarrative()` - Call the Anthropic Messages API via `@anthropic-ai/sdk`; never throws, returns `{ ok } | { ok: false, reason }`
- `renderAiNarrativeSection()` - Format the narrative as a `## AI Narrative` markdown section

**Fallback:** missing key, provider error, timeout, malformed response, or refusal each degrade to the deterministic digest (stderr warning, exit 0).  
**Lines:** ~280 lines  
**Dependencies:** `@anthropic-ai/sdk`, `types.ts`  
**Tested in:** `src/digestAi.test.ts` (config resolution, prompt bounds, stub-client success/refusal/error/empty-response paths, section rendering) and `src/digest.integration.test.ts` (CLI-level `--ai` behavior: missing-key fallback, unreachable-provider fallback — both exit 0 with the deterministic digest intact — and `--ai-model` without `--ai` ignored with a warning)

### 3. Path Resolution Module
**File:** `src/pathResolver.ts`  
**Role:** Source path validation and resolution  
**Key Functions:**
- `resolveSource()` - Validate and classify paths as directory/file with tilde expansion
- `resolveFromOptions()` - CLI option precedence logic (source > file > default)

**Lines:** ~90 lines  
**Dependencies:** `types.ts`

**Code Paths Tested:**
- Path 1: Tilde expansion with directory → `{ kind: 'directory', path: expanded }`
- Path 2: Tilde expansion with file → `{ kind: 'file', path: expanded }`
- Path 3: Absolute path directory detection → `{ kind: 'directory', path: expanded }`
- Path 4: Absolute path file detection → `{ kind: 'file', path: expanded }`
- Path 5: Non-existent path error handling → `process.exit(1)`

### 4. Type Definitions
**File:** `src/types.ts`  
**Role:** TypeScript interfaces and types for digest functionality  
**Key Types:**
- `SessionDigest` - Complete digest structure
- `SessionDigestOptions` - Generation options (workers, time ranges, limits)
- `BeadCompletion` - Bead completion record
- `FileModificationSummary` - File operation aggregate
- `ErrorOccurrence` - Error record with category
- `WorkerSessionSummary` - Worker activity summary
- `ResolvedSource` - Path resolution result type

**Lines:** ~150 lines (digest-related portion)

### 5. Public API Export
**File:** `src/index.ts`  
**Role:** Export digest functionality for external use  
**Exports:**
- `SessionDigestGenerator`
- `formatDigestAsMarkdown`

**Lines:** ~2 lines

## Supporting Files

### 6. Error Categorization
**File:** `src/errorGrouping.ts`  
**Role:** Error grouping and categorization for digest error section  
**Usage:** Digest uses `ErrorGroupManager` to process and categorize errors

**Lines:** ~400 lines  
**Tested in:** `src/errorGrouping.test.ts`

### 7. Cost Tracking
**File:** `src/tui/utils/costTracking.ts`  
**Role:** Token usage and cost calculation for digest cost section  
**Usage:** Digest uses `CostTracker` to process token events and calculate costs

**Lines:** ~800 lines  
**Tested in:** `src/tui/utils/costTracking.test.ts` (token accounting, per-model cost calculation, 80%/95% budget-alert thresholds, burn rate, time series, formatting helpers)

### 8. Event Storage
**File:** `src/store.ts`  
**Role:** In-memory event store used by digest generator  
**Usage:** `SessionDigestGenerator` receives `EventStore` for event queries

**Lines:** ~1200 lines  
**Tested in:** `src/store.test.ts`

### 9. Event Parser
**File:** `src/parser.ts`  
**Role:** Parse JSON log lines into structured events  
**Usage:** Digest command uses parser to process log files

**Lines:** ~600 lines  
**Tested in:** `src/parser.real-logs.integration.test.ts`

### 10. Directory Tailer
**File:** `src/directoryTailer.ts`  
**Role:** Watch and read multiple JSONL files from directory  
**Usage:** Digest command uses for directory sources

**Lines:** ~300 lines  
**Tested in:** `src/directoryTailer.test.ts`

## Test Files

### 1. Digest Unit Tests
**File:** `src/sessionDigest.test.ts`  
**Coverage:** Unit tests for `SessionDigestGenerator` and `formatDigestAsMarkdown`  
**Test Suites:**
- `generateDigest()` - Empty state, bead completions, file modifications, errors, workers, statistics, time filtering, worker filtering, limits, cost data
- `formatDigestAsMarkdown()` - Empty digest, complete digest, cost omission, duration formatting

**Test Count:** 13 tests  
**Coverage Target:** Core digest generation logic

### 2. Digest Integration Tests
**File:** `src/digest.integration.test.ts`  
**Coverage:** Full CLI command integration tests  
**Test Suites:**
- Directory sources - Multiple per-worker JSONL files, correct worker/event counts, old file reading
- Source option edge cases - Non-existent paths, relative/absolute paths, tilde expansion, empty strings, special characters, trailing slashes, relative directories
- File path sources - File resolution, temp file helpers, single file processing, path validation
- Backward compatibility - Legacy `-f/--file` option
- Default behavior - No args defaults to `~/.needle/logs/`
- Output to file - `-o/--output` option
- AI narrative layer (`--ai`) - Missing-key fallback (exit 0, stderr warning, deterministic digest unchanged), unreachable-provider fallback (sentinel key + closed local `ANTHROPIC_BASE_URL` port → exit 0, no `## AI Narrative` section), `--ai-model` without `--ai` ignored with warning

**Test Count:** 20+ tests  
**Coverage Target:** End-to-end CLI behavior with real filesystem operations

### 3. Path Resolution Unit Tests
**File:** `src/pathResolver.test.ts`  
**Coverage:** Path resolution logic unit tests  
**Test Suites:**
- `resolveSource` coverage - 5 code paths (tilde dir, tilde file, absolute dir, absolute file, error handling)
- `resolveFromOptions` coverage - 4 code paths (source priority, file tilde, file no-tilde, default)
- Edge cases - Nested directories, unicode characters, mixed file extensions
- Coverage verification - Checklist verification tests

**Test Count:** 12 tests  
**Coverage Target:** 100% code path coverage for path resolution functions

## Test Coverage Summary

| Component | Source File | Test File | Coverage Status |
|-----------|-------------|-----------|-----------------|
| CLI Command | `src/cli.ts` | `src/digest.integration.test.ts` | ✅ Integration tests |
| Digest Generation | `src/sessionDigest.ts` | `src/sessionDigest.test.ts` | ✅ Unit tests |
| AI Narrative Layer | `src/digestAi.ts` | `src/digestAi.test.ts` + `src/digest.integration.test.ts` (`--ai` flag) | ✅ Unit + CLI integration tests |
| Path Resolution | `src/pathResolver.ts` | `src/pathResolver.test.ts` | ✅ 100% code path coverage |
| Types | `src/types.ts` | N/A | N/A (type definitions) |
| Error Grouping | `src/errorGrouping.ts` | `src/errorGrouping.test.ts` | ✅ Unit tests |
| Cost Tracking | `src/tui/utils/costTracking.ts` | `src/tui/utils/costTracking.test.ts` | ✅ Direct coverage |
| Event Store | `src/store.ts` | `src/store.test.ts` | ✅ Unit tests |
| Parser | `src/parser.ts` | `src/parser.real-logs.integration.test.ts` | ✅ Integration tests |
| Directory Tailer | `src/directoryTailer.ts` | `src/directoryTailer.test.ts` | ✅ Unit tests |

## File Inventory Statistics

**Total Source Files:** 11  
**Total Test Files:** 4  
**Estimated Total Lines:** ~5,100 lines (implementation + tests)

### Source File Breakdown
- Core digest implementation: ~960 lines (cli.ts, sessionDigest.ts, pathResolver.ts, digestAi.ts)
- Supporting modules: ~3,200 lines (store.ts, parser.ts, directoryTailer.ts, errorGrouping.ts, costTracking.ts)
- Type definitions: ~150 lines
- Public API: ~10 lines

### Test File Breakdown
- Unit tests: ~880 lines (sessionDigest.test.ts, pathResolver.test.ts, digestAi.test.ts)
- Integration tests: ~570 lines (digest.integration.test.ts)

## Coverage Verification

### Code Paths Covered
**Path Resolution (pathResolver.ts):**
- ✅ 5/5 paths in `resolveSource()` (100%)
- ✅ 4/4 paths in `resolveFromOptions()` (100%)

**Digest Generation (sessionDigest.ts):**
- ✅ Empty state handling
- ✅ Bead completion extraction
- ✅ File modification aggregation
- ✅ Error categorization and extraction
- ✅ Worker summary generation
- ✅ Cost data processing
- ✅ Time-based filtering
- ✅ Worker-based filtering
- ✅ Limit enforcement (max files, max errors)
- ✅ Markdown formatting

**CLI Integration (cli.ts + integration tests):**
- ✅ Directory source processing
- ✅ File source processing
- ✅ Option precedence (--source > -f > default)
- ✅ Output to file vs stdout
- ✅ Error handling for invalid paths
- ✅ Backward compatibility with legacy options
- ✅ `--ai` missing-key fallback (exit 0, stderr warning, deterministic digest unchanged)
- ✅ `--ai` provider-failure fallback (exit 0, no AI Narrative section)
- ✅ `--ai-model` without `--ai` ignored with a warning

## Gaps and Recommendations

### Current Coverage
✅ **Excellent coverage** for core digest functionality  
✅ **100% code path coverage** for path resolution  
✅ **Comprehensive integration tests** for CLI behavior  
✅ **Edge case testing** for special characters, unicode, nested paths

### Potential Improvements
⚠️ **Cost tracking** - Indirect coverage through digest tests, could benefit from dedicated cost validation  
⚠️ **Error grouping** - Tested separately but integration with digest could be more explicit  
⚠️ **Performance testing** - No tests for large file handling or performance characteristics

### Test Maintenance Notes
- Integration tests use real filesystem operations (require temp file cleanup)
- Some tests have 30s timeout for default behavior testing
- Fixture dependency: `tests/fixtures/needle-logs/` must exist for integration tests
- Tests assume specific NEEDLE log format (JSONL per-worker files)

## Conclusion

The digest command implementation has **comprehensive test coverage** across all core components:

1. **Path Resolution:** 100% code path coverage with edge case testing
2. **Digest Generation:** Full unit test coverage of all extraction and formatting logic
3. **CLI Integration:** End-to-end testing of all command options and behaviors
4. **Supporting Modules:** All dependencies have their own test suites

The **test-to-code ratio** is approximately **1:3** (tests:implementation), which indicates good coverage without being overly redundant. The three test files (unit, integration, path resolution) provide layered testing from unit-level logic to full CLI behavior.

**Status:** ✅ **Ready for production use** - All critical paths covered, edge cases tested, and integration validated.
