# Test Failures Report
**Date:** 2026-07-28
**Command:** `npm test`
**Test Framework:** Vitest v4.1.10

## Summary Statistics

- **Total Test Files:** 74
- **Passed Test Files:** 72
- **Failed Test Files:** 2
- **Total Tests:** 2,631
  - Passed: 2,597
  - Failed: 32
  - Skipped: 2
- **Duration:** 44.86s

## Failed Test Files

### 1. `src/normalizerHostExtraction.test.ts`
**Tests:** 15 | **Failed:** 7 | **Duration:** 28ms

#### Failure Details

All 7 failures share the same root cause: inability to mock `os.hostname()` in ESM mode.

1. **Test:** `extracts host from needle.host attribute`
   - **Line:** 17:8
   - **Error:** `TypeError: Cannot redefine property: hostname`
   - **Root Cause:** Cannot spy on export "hostname" - Module namespace is not configurable in ESM

2. **Test:** `extracts host from service.instance.id when needle.host is absent`
   - **Line:** 17:8
   - **Error:** `TypeError: Cannot redefine property: hostname`

3. **Test:** `falls back to localhost when neither attribute is present`
   - **Line:** 17:8
   - **Error:** `TypeError: Cannot redefine property: hostname`

4. **Test:** `handles empty string values correctly`
   - **Line:** 17:8
   - **Error:** `TypeError: Cannot redefine property: hostname`

5. **Test:** `prioritizes needle.host over service.instance.id`
   - **Line:** 17:8
   - **Error:** `TypeError: Cannot redefine property: hostname`

6. **Test:** `falls back to localhost when no host attributes present`
   - **Line:** 120:25
   - **Error:** `AssertionError: expected 'lab' to be 'localhost'` (Object.is equality)
   - **Expected:** `"localhost"`
   - **Received:** `"lab"`

7. **Test:** `uses localhost when both attributes are missing`
   - **Line:** 251:25
   - **Error:** `AssertionError: expected 'lab' to be 'localhost'` (Object.is equality)
   - **Expected:** `"localhost"`
   - **Received:** `"lab"`

#### Problem Code Location
```typescript
// src/normalizerHostExtraction.test.ts:17
beforeEach(() => {
  // Mock os.hostname() to return 'localhost' for consistent testing
  vi.spyOn(os, 'hostname').mockReturnValue('localhost');
  // ...
});
```

### 2. `src/parser.test.ts`
**Tests:** 164 | **Failed:** 25 | **Duration:** 529ms

#### Failure Details

All 25 failures share the same root cause as the normalizer tests.

**Failed Tests:**
1. `should parse a minimal valid log line` (21ms)
2. `should parse a log line with all optional fields`
3. `should preserve additional non-standard fields`
4. `should accept all valid log levels`
5. `should parse NEEDLE format with ISO timestamp`
6. `should extract bead_id from data payload`
7. `should extract duration_ms from data payload`
8. `should infer error level from event name`
9. `should infer warn level from event name`
10. `should infer debug level from event name`
11. `should default to info level for normal events`
12. `should preserve additional data fields`
13. `should flatten worker to runner-provider-model-identifier format`
14. `should return null for empty string`
15. `should return null for whitespace-only string`
16. `should return null for non-JSON string`
17. `should return null for malformed JSON`
18. `should return null when ts is missing`
19. `should return null when ts is not a number`
20. `should return null when worker is missing`
21. `should return null when worker is not a string`
22. `should return null when level is missing`
23. `should return null when level is invalid`
24. `should return null when msg is missing`
25. `should return null when msg is not a string`

#### Problem Code Location
```typescript
// src/parser.test.ts:24
beforeEach(() => {
  // Mock os.hostname() to return 'localhost' for consistent testing
  vi.spyOn(os, 'hostname').mockReturnValue('localhost');
  delete process.env.HOSTNAME;
  delete process.env.HOST;
  // ...
});
```

## Root Cause Analysis

### Primary Issue: ESM Module Mocking Constraint

**Error Message:**
```
TypeError: Cannot spy on export "hostname". 
Module namespace is not configurable in ESM. 
See: https://vitest.dev/guide/browser/#limitations
```

**Explanation:**
- The project is using ESM (ECMAScript Modules)
- Vitest cannot spy on properties of module namespaces in ESM mode
- `os.hostname()` is an exported property from the `os` module
- The current test setup attempts to mock this, which fails

**Impact:**
- Tests cannot control the hostname value
- Tests expect `'localhost'` but receive the actual machine hostname (`'lab'`)
- All assertions that check for `'localhost'` fail

### File Path Resolution Issues

**Question:** Are any failures related to file path resolution?

**Answer:** **No.** 

All 32 test failures are caused by the hostname mocking issue, not by file path resolution. The failures occur because:
1. The mock setup fails silently in some cases
2. Tests run against the actual system hostname (`'lab'`)
3. Assertions expect `'localhost'` but get `'lab'`

## Recommendations

### Option 1: Use Manual Dependency Injection (Recommended)
Instead of mocking `os.hostname()`, inject the hostname as a parameter or use a wrapper function:

```typescript
// Create a hostname wrapper
export function getHostname(): string {
  return os.hostname();
}

// In tests, mock the wrapper instead
vi.spyOn(hostnameModule, 'getHostname').mockReturnValue('localhost');
```

### Option 2: Use Environment Variables
Configure tests to set environment variables that override hostname detection:

```typescript
beforeEach(() => {
  process.env.FORCE_HOSTNAME = 'localhost';
});
```

### Option 3: Adjust Test Assertions
Make tests hostname-agnostic by accepting any non-empty hostname:

```typescript
expect(event!.host).toBeTruthy();
expect(event!.host).toHaveLengthGreaterThan(0);
```

### Option 4: Switch to CommonJS
If mocking is critical, consider switching the project from ESM to CommonJS (note: this is a significant architectural change).

## Test Infrastructure Note

The tests are otherwise healthy:
- **2,597 tests passed successfully**
- **Only 32 failed (1.2% failure rate)**
- All failures trace to a single root cause

The test suite demonstrates good coverage and stability once the hostname mocking issue is resolved.

## Additional Information

**Vitest Documentation:**
https://vitest.dev/guide/browser/#limitations

**Affected Code Locations:**
- `src/normalizerHostExtraction.test.ts:17`
- `src/parser.test.ts:24`

**Actual System Hostname:** `lab`
**Expected Hostname (in tests):** `localhost`
