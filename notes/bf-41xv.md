# Fix for user-1001.slice Memory Limits

## Problem
The user-1001.slice had:
- `MemoryMax=32G` (hard cap - OOM kill at limit)
- `MemorySwapMax=0` (swap disabled)

This caused hard process kills when memory hit 32G instead of allowing the kernel to reclaim memory gracefully or use swap.

## Solution
Changed to:
- `MemoryHigh=32G` (soft cap - kernel applies pressure and reclaims)
- `MemoryMax=infinity` (no hard kill)
- `MemorySwapMax=infinity` (can use system swap)

## Configuration Files
Persistent configs in `/etc/systemd/system.control/user-1001.slice.d/`:
- `50-MemoryHigh.conf`: `MemoryHigh=34359738368` (32G)
- `50-MemoryMax.conf`: `MemoryMax=infinity`
- `50-MemorySwapMax.conf`: `MemorySwapMax=infinity`

## Verification
```bash
# Current cgroup values
cat /sys/fs/cgroup/user.slice/user-1001.slice/memory.high     # 34359738368 (32G)
cat /sys/fs/cgroup/user.slice/user-1001.slice/memory.max      # max (unlimited)
cat /sys/fs/cgroup/user.slice/user-1001.slice/memory.swap.max # max (unlimited)

# systemd properties
systemctl show user-1001.slice | grep -E "MemoryMax|MemoryHigh|MemorySwapMax"
```

## How It Was Done
```bash
sudo systemctl set-property -- user-1001.slice MemoryMax=infinity MemorySwapMax=infinity MemoryHigh=32G
```

The `systemctl set-property` command without `--runtime` makes the changes persistent across reboots by creating drop-in files in `/etc/systemd/system.control/`.
