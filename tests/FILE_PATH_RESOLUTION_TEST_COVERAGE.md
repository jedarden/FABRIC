# File Path Resolution Test Coverage

## Summary
Comprehensive test coverage analysis for the digest command's file path resolution logic. One coverage gap identified.

## Test Results (2026-07-28)

### ✅ All File Path Resolution Tests Pass
- **18 tests** in digest.integration.test.ts: **PASSING**
- **2631 total tests** in test suite: **PASSING**
- **Build**: TypeScript compilation successful
- **Type Safety**: `npx tsc --noEmit` - no type errors

## Code Path Coverage Analysis

### `resolveSource(source: string)` (src/cli.ts:52-63)
**Purpose**: Validates and resolves `--source` option paths with filesystem checks.

| Code Path | Line | Status | Test Coverage |
|-----------|------|--------|---------------|
| Tilde expansion branch | 53 | ✅ | `handles paths with tilde home expansion` |
| No tilde → fs.statSync | 53 | ✅ | `handles relative/absolute file paths correctly` |
| stat.isDirectory() = true | 56 | ✅ | `reads from all per-worker JSONL files` |
| stat.isDirectory() = false | 58 | ✅ | `resolves file path: resolved.kind is file` |
| fs.statSync throws error | 59 | ✅ | `handles non-existent file path gracefully` |

**Coverage**: 5/5 paths (100%) ✅

### `resolveFromOptions(source?: string, file?: string)` (src/cli.ts:95-99)
**Purpose**: Routes source resolution based on CLI option priority.

| Code Path | Line | Status | Test Coverage |
|-----------|------|--------|---------------|
| `--source` provided | 96 | ✅ | All `--source` option tests |
| `-f/--file` without tilde | 97 | ✅ | `-f/--file option still works for single files` |
| **`-f/--file` with tilde** | 97 | ❌ | **NO TEST - GAP IDENTIFIED** |
| Default (no args) | 98 | ✅ | `defaults to ~/.needle/logs/ directory when no args provided` |

**Coverage**: 3/4 paths (75%) ⚠️

## Coverage Gap Details

### Missing Test: `-f` Option with Tilde Expansion

**Location**: `src/cli.ts:97`
```typescript
if (file) return { kind: 'file', path: file.startsWith('~') ? file.replace('~', HOME) : file };
```

**Why This Is a Separate Code Path**:
1. **No validation**: Unlike `--source`, the `-f` option doesn't call `resolveSource()`
2. **No fs.statSync**: The expanded path is never checked for existence during resolution
3. **Different error behavior**: Non-existent paths fail later (during file read) vs early (during resolution)

**Current State**: The tilde expansion logic itself is tested via `--source` option, but the specific `-f` path with tilde is not exercised.

**Impact**: Medium - distinct code path with different validation behavior

**Risk Assessment**: Low - Simple string replacement, but worth testing for completeness

## Detailed Edge Case Coverage

### ✅ Edge Cases Covered (src/digest.integration.test.ts)

#### 1. **Non-existent File Paths**
- Test: `handles non-existent file path gracefully`
- Coverage: Validates error handling when source path doesn't exist
- Result: ✅ PASS

#### 2. **Relative File Paths**
- Test: `handles relative file paths correctly`
- Coverage: Tests files in current directory with just filename (no directory)
- Result: ✅ PASS

#### 3. **Absolute File Paths**
- Test: `handles absolute file paths correctly`
- Coverage: Tests full file paths from root
- Result: ✅ PASS

#### 4. **Tilde Home Expansion (--source)**
- Test: `handles paths with tilde home expansion`
- Coverage: Tests `~/path` expansion to `$HOME/path` via `--source` option
- Result: ✅ PASS

#### 5. **Empty String Source**
- Test: `handles empty string as source path`
- Coverage: Tests default behavior when `--source ""` is provided
- Result: ✅ PASS

#### 6. **Special Characters in Paths**
- Test: `handles file paths with special characters`
- Coverage: Tests spaces, parentheses, brackets, quotes in filenames
- Result: ✅ PASS

#### 7. **Directory Trailing Slashes**
- Test: `handles directory path with trailing slash`
- Coverage: Tests `path/` vs `path` equivalence
- Result: ✅ PASS

#### 8. **Relative Directory Paths**
- Test: `handles relative directory paths correctly`
- Coverage: Tests directory navigation from different working directories
- Result: ✅ PASS

### Path Resolution Validation

#### 9. **File Path Resolution**
- Test: `resolves file path: resolved.kind is file and resolved.path matches input`
- Coverage: Validates `resolved.kind === 'file'` and path matching
- Result: ✅ PASS

#### 10. **Helper Function Integration**
- Test: `resolves file path using createTempLogFile helper (bf-5qe4z)`
- Coverage: Tests integration with test helper functions
- Result: ✅ PASS

#### 11. **File Processing**
- Test: `correctly processes file source and shows kind=file`
- Coverage: Validates file content processing and logging
- Result: ✅ PASS

#### 12. **Path Existence Validation**
- Test: `validates path exists and exits with error for non-existent file`
- Coverage: Tests `resolveSource()` error handling
- Result: ✅ PASS

### ❌ Coverage Gaps

#### 13. **`-f` Option with Tilde Expansion**
- Test: **MISSING**
- Coverage: Tests `-f ~/path/to/file.jsonl` (distinct from `--source ~/path`)
- Result: ❌ NO TEST
- Priority: High
- Recommendation: Add test to `src/digest.integration.test.ts`

## Backward Compatibility

Tests verify backward compatibility with legacy options:
- ✅ `-f/--file` option still works for single files
- ✅ Default behavior (no args) uses `~/.needle/logs/`

## Implementation Details

### Core Functions Tested

**`resolveSource(source: string): ResolvedSource`** (src/cli.ts:52-63)
- ✅ Expands `~` to `$HOME`
- ✅ Calls `fs.statSync()` for validation
- ✅ Returns `{ kind: 'directory', path }` or `{ kind: 'file', path }`
- ✅ Exits with error message for non-existent paths
- ✅ **Coverage**: 100% (5/5 code paths)

**`resolveFromOptions(source?: string, file?: string): ResolvedSource`** (src/cli.ts:95-99)
- ✅ Prioritizes `--source` over `-f/--file`
- ✅ Defaults to `~/.needle/logs/` when neither provided
- ✅ Delegates to `resolveSource()` for validation
- ❌ Missing test for `-f` option with tilde expansion
- ⚠️ **Coverage**: 75% (3/4 code paths)

## Recommendations

### High Priority
1. **Add test for `-f` option with tilde expansion** to close the identified gap
   ```typescript
   test('handles -f option with tilde expansion', () => {
     const homeDir = process.env.HOME || process.env.USERPROFILE || '';
     const tempFileName = 'test-tilde-file.jsonl';
     const tempFilePath = join(homeDir, tempFileName);
     const testEvent = '{"ts":1709337600,"worker":"test-tilde-file","level":"info","msg":"Test"}\n';
     
     try {
       writeFileSync(tempFilePath, testEvent, 'utf8');
       
       const { stdout, stderr } = execCaptureStderr(
         `node ${DIST_CLI} digest -f ~/${tempFileName}`
       );
       
       expect(stderr).toContain('Loaded 1 events');
       expect(stdout).toContain('test-tilde-file');
     } finally {
       if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
     }
   });
   ```

2. **Add test for `-f` option with non-existent file** to verify late failure behavior
   - This would validate that `-f` doesn't do early validation like `--source`

### Medium Priority
3. **Add test for symbolic links** to verify `fs.statSync()` handles symlinks correctly
4. **Add test for very long file paths** (near OS limits) to verify path length handling

### Low Priority
5. **Document behavior with invalid HOME env var** (edge case)
6. **Consider adding test for unicode characters in paths** beyond current special character tests

## Overall Coverage Summary

| Component | Code Paths | Tested | Coverage |
|-----------|------------|--------|----------|
| `resolveSource()` | 5 | 5 | 100% ✅ |
| `resolveFromOptions()` | 4 | 3 | 75% ⚠️ |
| **Total** | **9** | **8** | **89%** |

## Conclusion

**Overall Status**: 8/9 code paths tested (89% coverage)

**Strengths**:
- Excellent coverage for `--source` option edge cases
- Comprehensive error handling validation
- Good backward compatibility testing
- Strong special character and path format coverage

**Gap Identified**:
- One specific code path in `resolveFromOptions()` line 97 where `-f` option with tilde expansion lacks explicit test coverage

**Impact Assessment**: 
- **Medium Priority**: This is a distinct code path with different validation behavior than the tested `--source` tilde expansion
- **Low Risk**: The tilde expansion logic is simple and well-tested in other contexts

**Recommendation**: Add the missing test case to achieve 100% code path coverage for file path resolution logic.
