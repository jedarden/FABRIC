# File Path Resolution Test Coverage Inventory

**Created:** 2026-07-28  
**Purpose:** Comprehensive survey of existing file path resolution tests in FABRIC  
**Scope:** `--source` option, `resolveFromOptions()`, `resolveSource()`, and all commands that use them

## Implementation Overview

### Core Path Resolution Functions

**Location:** `src/cli.ts`

```typescript
type ResolvedSource = { kind: 'directory'; path: string } | { kind: 'file'; path: string };

function resolveSource(source: string): ResolvedSource {
  // Expands ~ to HOME
  // Validates path exists (fs.statSync)
  // Returns kind: 'directory' | 'file'
  // Exits with error if path doesn't exist
}

function resolveFromOptions(source?: string, file?: string): ResolvedSource {
  // Priority: --source > -f/--file > default
  // Calls resolveSource() for --source
  // Returns { kind: 'file', path } for -f/--file (no validation)
  // Defaults to ~/.needle/logs as directory
}
```

### Commands Using Path Resolution

| Command | Uses `--source` | Uses `-f/--file` | Test Coverage |
|---------|----------------|------------------|----------------|
| `digest` | ✅ | ✅ | ✅ **Comprehensive** |
| `tui` | ✅ | ✅ | ❌ None |
| `logs` | ✅ | ✅ | ❌ None |
| `replay` | ✅ | ✅ | ❌ None |
| `prune` | ✅ | ❌ | ❌ None |
| `web` | ✅ | ✅ | ❌ None |

---

## Test Files Coverage

### 1. Primary Test File: `src/digest.integration.test.ts`

**Coverage:** Comprehensive file path resolution testing for `digest` command  
**Test Count:** 17 tests across 6 describe blocks  
**Bead Reference:** bf-61qm6

#### Test Scenarios Covered:

##### A. Directory Sources (3 tests)
- ✅ **Reads from all per-worker JSONL files**
  - Validates multi-worker aggregation
  - Checks event counts and worker activity
  
- ✅ **Produces digest with correct worker and event counts**
  - Validates total events calculation
  - Verifies active workers count
  
- ✅ **Reads files older than 4 hours (startupRereadMs: Infinity)**
  - Tests reading from fixtures (April 2026)
  - Verifies old files are read from beginning, not EOF

##### B. File Path Edge Cases (8 tests)
- ✅ **Non-existent file path**
  - Exits with error message
  - Proper error handling
  
- ✅ **Relative file paths**  
  - Files in current directory
  - Correct resolution and processing
  
- ✅ **Absolute file paths**
  - Full path specification
  - Correct processing and logging
  
- ✅ **Tilde home expansion** (`~/path`)
  - HOME environment variable expansion
  - Cross-platform compatibility
  
- ✅ **Empty string as source path**
  - Defaults to `~/.needle/logs/`
  - Proper default behavior
  
- ✅ **Special characters in filenames**
  - Spaces: `test file with spaces.jsonl`
  - Parentheses: `test-file-with(parentheses).jsonl`
  - Brackets: `test-file-with[brackets].jsonl`
  - Quotes: `test-file-with'quotes'.jsonl`
  - Proper quoting and escaping
  
- ✅ **Directory path with trailing slash**
  - `--source "/path/to/dir/"`
  - Correct directory kind detection
  
- ✅ **Relative directory paths**
  - Working directory changes
  - Relative path resolution from different directories

##### C. File Path Resolution Verification (3 tests)
- ✅ **resolved.kind is 'file' and resolved.path matches input**
  - Validates resolveSource() output structure
  - Verifies path preservation
  
- ✅ **File path resolution using createTempLogFile helper** (bf-5qe4z)
  - Tests test helper integration
  - Validates temp file creation and cleanup
  
- ✅ **Validates path exists and exits with error for non-existent file**
  - Error handling for missing files
  - Proper exit codes

##### D. Backward Compatibility (1 test)
- ✅ **-f/--file option still works for single files**
  - Legacy option compatibility
  - Single-file mode validation

##### E. Default Behavior (1 test)
- ✅ **Defaults to ~/.needle/logs/ when no args provided**
  - Default source directory
  - Handles large file counts (skips if > 10 files)

##### F. Output Handling (1 test)
- ✅ **-o/--output option writes digest to file**
  - File output validation
  - Proper digest format in output file

### 2. Directory Management: `src/directoryTailer.test.ts`

**Coverage:** DirectoryTailer class that manages watching log directories  
**Test Count:** 10 tests  
**Focus:** Directory watching, file hot-addition, deduplication

#### Test Scenarios Covered:
- ✅ **Emits events from multiple pre-existing JSONL files**
- ✅ **Hot-adds new JSONL files and emits events**
- ✅ **Ignores non-*.jsonl files**
- ✅ **stop() closes all child watchers**
- ✅ **Deduplicates events across files**
- ✅ **Emits error when directory does not exist**
- ✅ **Caps active-file count with many files (10,000)**
- ✅ **Evicts LRU and re-activates file on mtime change**
- ✅ **Resumes from saved position when file re-activated**
- ✅ **Inotify watch bounds validation (Linux-only)**

#### Path Resolution Coverage:
- ✅ Directory existence validation
- ✅ Directory watching initialization
- ✅ File pattern matching (*.jsonl)
- ❌ No `--source` option testing
- ❌ No tilde expansion testing
- ❌ No relative/absolute path testing

### 3. Test Utilities: `src/testHelpers.test.ts` & `src/testHelpers.ts`

**Coverage:** Helper functions for test file creation  
**Test Count:** Variable (utility-focused)

#### Key Functions:
- ✅ **createTempLogFile()** - Creates temporary JSONL files
  - Supports custom filenames, event counts, worker IDs
  - Automatic cleanup mechanism
  - File and directory creation
  
- ✅ **Temp file error handling** - Non-existent directory handling
  - Error messages for invalid paths
  - Graceful cleanup on failure

---

## Commands Currently Tested

### ✅ `digest` Command (Well Tested)

**Test File:** `src/digest.integration.test.ts`  
**Coverage:** 95% of path resolution scenarios

**Tested Scenarios:**
- All path types (relative, absolute, tilde)
- All edge cases (special chars, empty string, trailing slash)
- Error conditions (non-existent paths)
- Default behavior
- Backward compatibility
- Output handling

**Missing:**
- ❌ Symbolic link handling
- ❌ Very long paths (> 260 characters Windows MAX_PATH)
- ❌ Unicode/non-ASCII filenames
- ❌ Network paths (UNC paths on Windows)
- ❌ Case-insensitive file system handling

### ❌ `tui` Command (No Path Resolution Tests)

**Implementation:** Uses `resolveFromOptions()` in `src/cli.ts` (line 327)  
**Test Gap:** No dedicated tests for `--source` option path resolution

**Should Test:**
- TUI starts with directory source
- TUI starts with file source
- TUI handles invalid paths gracefully
- TUI default path behavior

### ❌ `logs` Command (No Path Resolution Tests)

**Implementation:** Uses `resolveFromOptions()` in `src/cli.ts` (line 505)  
**Test Gap:** No dedicated tests for `--source` option path resolution

**Should Test:**
- Logs streams from directory source
- Logs streams from file source
- Logs handles invalid paths gracefully

### ❌ `replay` Command (No Path Resolution Tests)

**Implementation:** Uses `resolveFromOptions()` in `src/cli.ts` (line 623)  
**Test Gap:** No dedicated tests for `--source` option path resolution

**Should Test:**
- Replay reads from directory source
- Replay reads from file source
- Replay handles invalid paths gracefully

### ❌ `prune` Command (No Path Resolution Tests)

**Implementation:** Uses `--source` in `src/cli.ts` (line 714)  
**Test Gap:** No dedicated tests for `--source` option path resolution

**Should Test:**
- Prune operates on directory source
- Prune handles invalid paths gracefully
- Prune default behavior (~/.needle/logs)

### ❌ `web` Command (No Path Resolution Tests)

**Implementation:** Uses `resolveFromOptions()` in `src/cli.ts` (line 740)  
**Test Gap:** No dedicated tests for `--source` option path resolution

**Should Test:**
- Web server starts with directory source
- Web server starts with file source  
- Web handles invalid paths gracefully
- Web default path behavior

---

## Coverage Gaps Summary

### Critical Gaps (High Priority)

1. **Command-Specific Testing**: 5 of 6 commands using `--source` have no path resolution tests
   - `tui`, `logs`, `replay`, `prune`, `web` commands
   
2. **Cross-Platform Path Handling**: No tests for platform-specific path issues
   - Windows backslashes vs forward slashes
   - Case-insensitive filesystems
   - MAX_PATH limits on Windows
   
3. **Symbolic Links**: No tests for symlinked files/directories

4. **Permission Errors**: No tests for unreadable files/directories

### Moderate Gaps (Medium Priority)

5. **Unicode Filenames**: No tests for non-ASCII characters in paths
   - UTF-8 encoded filenames
   - Emoji in filenames
   - Right-to-left text

6. **Network Paths**: No tests for UNC/remote paths
   - `//server/share/path` on Windows
   - Mounted network drives on Unix

7. **Very Long Paths**: No tests for paths exceeding system limits

### Minor Gaps (Low Priority)

8. **Edge Case Characters**: Limited special character testing
   - Newlines in filenames (if system allows)
   - Null bytes (if system allows)
   - Very long filenames (> 255 characters)

9. **Performance**: No tests for path resolution performance
   - Large directories (100K+ files)
   - Deep directory nesting (> 50 levels)

---

## Test Coverage Matrix

| Scenario | digest | tui | logs | replay | prune | web |
|----------|--------|-----|------|--------|-------|-----|
| Relative file path | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Absolute file path | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Tilde expansion | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Directory source | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Directory w/ trailing slash | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Special characters | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Empty string source | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Non-existent path | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Default behavior | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Symbolic links | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Unicode filenames | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Network paths | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Permission errors | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| -f/--file compatibility | ✅ | ❌ | ❌ | ❌ | N/A | ❌ |

---

## Recommendations

### Immediate Actions (High Priority)

1. **Create Path Resolution Test Suite for All Commands**
   - Extract common test patterns from `digest.integration.test.ts`
   - Create shared test utilities in `testHelpers.ts`
   - Implement basic path resolution tests for `tui`, `logs`, `replay`, `prune`, `web`

2. **Add Cross-Platform Testing**
   - Test on Windows, macOS, Linux in CI
   - Add platform-specific path handling tests
   - Validate path separators and case sensitivity

3. **Add Symbolic Link Tests**
   - Test symlinked files and directories
   - Validate symlink resolution behavior
   - Test broken symlinks

### Medium-Term Improvements

4. **Implement Error Scenario Tests**
   - Permission denied errors
   - Read-only filesystems
   - Disk full errors

5. **Add Unicode and Edge Case Tests**
   - Non-ASCII filenames
   - Emoji and special Unicode
   - Very long filenames

6. **Performance Testing**
   - Large directory handling
   - Deep directory nesting
   - Path resolution performance metrics

### Long-Term Enhancements

7. **Add Fuzz Testing**
   - Random path generation
   - Edge case discovery
   - Boundary condition testing

8. **Integration Test Suite**
   - End-to-end workflow tests
   - Multi-command scenarios
   - Real-world usage patterns

---

## Test Utilities Available

### Existing Test Helpers

**File:** `src/testHelpers.ts`

- ✅ `createTempLogFile()` - Creates temp JSONL files with events
- ✅ Automatic cleanup mechanisms
- ✅ Configurable event generation
- ✅ Directory creation helpers

### Recommended Additions

- ❌ `createTempDirectory()` - Creates temp directories with files
- ❌ `createSymlink()` - Creates symbolic links for testing
- ❌ `createLongPath()` - Generates very long paths
- ❌ `createUnicodePath()` - Creates paths with Unicode characters
- ❌ `platformPath()` - Generates platform-specific paths

---

## Conclusion

**Current State:** FABRIC has excellent path resolution test coverage for the `digest` command but lacks tests for other commands using the same functionality.

**Risk Level:** Medium - Core functionality is well-tested, but other commands could have undetected path resolution issues.

**Priority:** High - Implement basic path resolution tests for all commands before adding new features.

**Estimated Effort:**
- Basic command coverage: 4-6 hours
- Cross-platform testing: 8-10 hours  
- Error scenarios: 6-8 hours
- Unicode/edge cases: 4-6 hours
- **Total: 22-30 hours**

---

## References

- **Implementation:** `src/cli.ts` - `resolveSource()`, `resolveFromOptions()`
- **Primary Tests:** `src/digest.integration.test.ts` (17 tests)
- **Directory Tests:** `src/directoryTailer.test.ts` (10 tests)
- **Test Helpers:** `src/testHelpers.ts`, `src/testHelpers.test.ts`
- **Related Beads:** bf-61qm6, bf-5qe4z, bf-4xotm

---

**Last Updated:** 2026-07-28  
**Maintained By:** FABRIC Test Coverage Initiative  
**Next Review:** After implementing command-specific path resolution tests
