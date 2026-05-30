# user-1001.slice Memory Fix (Bead bf-41xv)

## Summary
Replaced MemoryMax hard cap with MemoryHigh soft cap and enabled cgroup swap for user-1001.slice on NixOS.

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

## Changes Made

### NixOS Configuration (`/etc/nixos/configuration.nix`)
Fixed syntax error with `writeTextDir` (needed parentheses around the call) and configured:

```nix
systemd.tmpfiles.rules = [
  "L+ /etc/systemd/system/user-1001.slice.d/50-memory.conf - - - - /etc/systemd/system-user-slices/user-1001.slice.d/50-memory.conf"
];

systemd.packages = [
  (pkgs.writeTextDir "etc/systemd/system-user-slices/user-1001.slice.d/50-memory.conf" ''
    [Slice]
    # MemoryHigh applies soft memory pressure (reclaim) instead of hard OOM kill
    MemoryHigh=32G
    # Do not set MemoryMax - allow emergency usage if needed
    # Do not set MemorySwapMax - allow cgroup to use system swap
  '')
];
```

### Verification
After `nixos-rebuild switch`:
```bash
cat /sys/fs/cgroup/user.slice/user-1001.slice/memory.max      # max (unlimited)
cat /sys/fs/cgroup/user.slice/user-1001.slice/memory.high     # 34359738368 (32G)
cat /sys/fs/cgroup/user.slice/user-1001.slice/memory.swap.max # max (unlimited)
```

The NixOS-generated config in `/nix/store/.../user-1001.slice.d/50-memory.conf` contains the correct settings.

## Why This Matters
- **Before**: MemoryMax=32G meant hard OOM kill at the limit
- **After**: MemoryHigh=32G allows the kernel to apply gradual memory pressure and reclaim pages, giving processes time to respond before OOM
- Swap overflow provides an additional 24GB buffer for memory spikes

## Date
2026-05-30
