# Bead bd-o0x: Worker Count Badge - Already Implemented

## Summary

The requested feature to add a worker count badge to the TUI header is **already fully implemented** in the codebase.

## Existing Implementation

### Location: `src/tui/app.ts`

#### 1. `getWorkerStats()` method (lines 124-135)
Returns worker counts by status:
- `total`: total number of workers
- `active`: count of workers with status 'active'
- `idle`: count of workers with status 'idle'
- `error`: count of workers with status 'error'

#### 2. `getHeaderContent()` method (lines 140-180)
Builds the header content with:
- "FABRIC - Worker Activity Monitor" title
- Optional filter indicator (when CLI filters are active)
- Worker count badge with color-coded status indicators
  - Green for active workers
  - Yellow for idle workers
  - Red for error workers
  - Format: `[2 active | 1 idle]` (only shows statuses with >0 workers)

#### 3. `updateHeader()` method (lines 185-189)
Updates the header content when called.

#### 4. Real-time updates
The header badge updates in real-time via:
- `addEvent()` method (line 2049): calls `updateHeader()` after each event
- `setViewMode('default')` (line 1569): restores header when returning to default view
- Various command handlers: update header with status messages

### Example Output

```
FABRIC - Worker Activity Monitor  [3 active | 1 idle]
FABRIC - Worker Activity Monitor  [2 active | 1 idle | 1 error]
```

## Verification

- All TUI app tests pass (44/44 tests)
- The implementation uses blessed tags for color formatting
- Worker counts are fetched from the `InMemoryEventStore` via `store.getWorkers()`
