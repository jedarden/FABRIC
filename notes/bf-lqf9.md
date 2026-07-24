# bf-lqf9: Cycle Detection in findCriticalPath - VERIFICATION

## Status

**COMPLETED** - Fix was already implemented in commit `1f03561` on 2026-07-22.

## Acceptance Criteria Verification

### 1. ✅ longestPath() tracks nodes on active recursion stack
**Verified in `src/tui/dagUtils.ts:433`:**
```typescript
const visiting = new Set<string>(); // Track nodes on the recursion stack to detect cycles
```

### 2. ✅ Returns bounded/zero-length result when cycle detected
**Verified in `src/tui/dagUtils.ts:436-439`:**
```typescript
// Cycle detection: if this node is already being visited, return zero-length result
if (visiting.has(nodeId)) {
  return { length: 0, path: [] };
}
```

### 3. ✅ Two previously skipped tests are un-skipped and pass
**Verified in `src/tui/dagUtils.test.ts`:**
- Line 323-339: `it('should detect cycles', ...)` - ACTIVE (not skipped)
- Line 1055-1067: `it('should handle self-referential dependency', ...)` - ACTIVE (not skipped)

Both tests pass:
- `should detect cycles`: Tests 2-node cycle (bd-1 ↔ bd-2)
- `should handle self-referential dependency`: Tests single-node cycle (bd-1 → bd-1)

### 4. ✅ npm test passes with no remaining cycle-related skips
**Verified:**
- All 2518 tests pass
- Only 2 unrelated skips exist (in other test files)
- All 59 tests in `src/tui/dagUtils.test.ts` pass

### 5. ✅ Manual verification with cycle fixture
**Tested:** Created 2-node cycle fixture (bd-1 ↔ bd-2) and verified:
- `buildDependencyGraph()` returns without stack overflow
- `getDagStats()` returns successfully
- `hasCycle` is reported as `true` for the component

## Fix Implementation Details

**Commit:** `1f03561d4d06eaaf9dd3ac8bcd1fad2f714caa19`

**Changes:**
1. Added `visiting` Set to track nodes on recursion stack (line 433)
2. Added early return when cycle detected (lines 436-439)
3. Added node to `visiting` set before recursion (line 447)
4. Removed node from `visiting` set after recursion (line 471)

**Test Changes:**
- Removed `.skip` from two previously-skipped cycle tests
- Both tests now pass without stack overflow

## Impact

With this fix, FABRIC can safely handle bead dependency graphs containing cycles:
- No stack overflow crashes when opening DAG view
- Cycle detection (`hasCycle: true`) works correctly
- Critical path calculation gracefully handles cycles
- Realistic operator errors (circular `blocks` dependencies) don't crash the app
