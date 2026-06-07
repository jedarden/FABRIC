# Bead bf-2q9r: Per-needle-worker MemoryMax ceiling (4 GB)

## Summary

Added per-needle-worker MemoryMax ceiling (4 GB) via systemd-run scope wrapper so no single worker can exhaust the cgroup's available memory.

## Implementation

**Approach:** systemd transient scope with MemoryMax=4G

Modified needle adapter configs to wrap worker invocation with:
```bash
systemd-run --user --scope -p MemoryMax=4G bash -c '...'
```

**Files modified:**
- `/home/coding/.config/needle/adapters/claude-code-glm-4.7.yaml` (already had MemoryMax)
- `/home/coding/.config/needle/adapters/claude-code-glm-5.yaml` (added MemoryMax)
- `/home/coding/.config/needle/adapters/claude-code-glm-5-1.yaml` (added MemoryMax)

## Verification

Checked active systemd scopes:
```bash
$ systemctl --user show run-p857080-i9244556.scope -p MemoryMax
MemoryMax=4294967296  # 4 GB

$ systemctl --user show run-p857080-i9244556.scope -p MemoryCurrent
MemoryCurrent=647168  # ~632 KB
```

## Rationale

With only a cgroup-level soft limit (user-1001.slice MemoryHigh), one runaway worker could still consume all available memory before pressure kills it. The per-process MemoryMax bounds each Claude Code session at 4 GB RSS, ensuring 6 workers + fabric-web + VSCode stay well under 32 GB total.

## Notes

- MemoryMax is a hard limit — the process is OOM-killed if it exceeds 4 GB
- This complements (not replaces) the user-1001.slice MemoryHigh soft limit
- systemd-run scope automatically cleanup when process exits
- Backups created: `.pre-memorycap.bak` files
