# Snapper & Limine Boot Config

Manages two system config files for btrfs snapshot cleanup and limine boot entries:

- **`/etc/snapper/configs/root`** — Snapper cleanup policy for the root btrfs subvolume
- **`/etc/default/limine`** — Limine bootloader config including snapshot boot entries

## Key Settings

### Snapper (`snapper-root`)

- `QGROUP=""` — Space-aware cleanup is **intentionally disabled**. btrfs quotas cause severe system hangs and write performance degradation. Number-based cleanup is sufficient.
- `NUMBER_LIMIT="20"` / `NUMBER_LIMIT_IMPORTANT="10"` — Max snapshot counts for automatic number cleanup. The `snapper-cleanup.timer` runs hourly and enforces these limits.

### Limine (`limine`)

- `MAX_SNAPSHOT_ENTRIES=4` — Limits snapshot boot entries on `/boot`. Each entry copies kernel+initramfs (~450MB for 2 kernels) onto the FAT32 ESP. With a 2GB `/boot`, only 2-3 entries fit alongside the current kernels.

## Why These Values

The boot partition is 2GB FAT32 (no dedup/hardlinks). Each snapshot boot entry needs a full copy of initramfs+vmlinuz for every installed kernel. With two kernels (cachyos + cachyos-lts), that's ~450MB per unique kernel version. Setting `MAX_SNAPSHOT_ENTRIES` higher than 3 risks exceeding the 85% boot partition usage limit, which causes `limine-snapper-sync` to stop creating entries and show persistent notifications.

## Why Not btrfs Quotas

Snapper supports space-aware cleanup via `QGROUP` + `SPACE_LIMIT`/`FREE_LIMIT`, which requires `btrfs quota enable`. **Do not enable this.** btrfs quota accounting causes severe performance issues — multi-second system freezes, input lag, and general unresponsiveness. The qgroup metadata updates add write amplification to every COW operation. Number-based cleanup (`NUMBER_LIMIT`) is simple and effective without the overhead.
