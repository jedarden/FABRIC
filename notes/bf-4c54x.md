# Digest Default Source Verification (bf-4c54x)

## Task Verification

Verified that the digest command's default source is correctly set to `~/.needle/logs/` as a directory, not `~/.needle/logs/workers.log` as a single file.

## Current Implementation

The digest command already correctly implements the required behavior:

1. **Default Source** (line 48 in `src/cli.ts`):
   ```typescript
   return { kind: 'directory', path: `${HOME}/.needle/logs` };
   ```

2. **Resolution Logic** (`resolveFromOptions` function):
   - If `--source` is provided: uses `resolveSource()` to detect file vs directory
   - If `-f/--file` is provided: treats as single file
   - If neither provided: defaults to `~/.needle/logs/` as **directory**

3. **Digest Command** (line 700):
   ```typescript
   const resolved = resolveFromOptions(options.source, options.file);
   ```

## Acceptance Criteria Verification

✅ **With no --source or -f arguments, digest defaults to ~/.needle/logs/ directory**
   - Verified: Running `fabric digest` shows "FABRIC Digest - Analyzing: /home/coding/.needle/logs (directory)"

✅ **The default is resolved through resolveFromOptions (directory path)**
   - Verified: The `resolveFromOptions` function returns `{ kind: 'directory', path: ... }` for the default case

✅ **Running `fabric digest` with no arguments against a real NEEDLE install produces a non-empty digest**
   - Verified: Digest loaded 118,466 events and produced a complete session digest with worker activity

✅ **The old default workers.log is no longer referenced as the primary fallback**
   - Verified: The default is the directory path, not workers.log
   - Note: workers.log is still used for TUI hot reload (lines 161-192), not for digest defaults

## Historical Context

- Commit `632f35a` (April 22, 2026): "route --source directory to DirectoryTailer, drop workers.log suffix" - this established the pattern for directory sources
- Commit `52640c8` (July 24, 2026): "fix(replay): add directory source support" - confirmed the pattern matches across commands
- The digest command already follows this pattern with `resolveFromOptions`

## Conclusion

**Status: COMPLETE** - The digest command already implements the required behavior correctly. No code changes needed.

## Test Output

```
$ fabric digest
FABRIC Digest - Analyzing: /home/coding/.needle/logs (directory)
Loaded 118466 events
# Session Digest
...
```
