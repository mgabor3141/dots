# Headless (Unraid) only: agent/user scratch space on the cache SSD. Unraid's
# /tmp is a directory on the 16G rootfs ramdisk; filling it wedges the OS.
# Guarded on the pool being mounted (not just the dir existing) so a stray dir
# on rootfs can't hijack it. The path only exists on that box, so this is a
# no-op everywhere else. Mirrors the block in ~/.profile.
if test -d /mnt/cache/tmp; and mountpoint -q /mnt/cache 2>/dev/null
    set -gx TMPDIR /mnt/cache/tmp
end
