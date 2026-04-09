#!/bin/bash
# Preflight check: verify the Unraid environment is ready for chezmoi apply.
# This runs before any files are written. Exits non-zero to abort if not ready.

set -euo pipefail

errors=0

check() {
  if ! eval "$1"; then
    echo "FAIL: $2" >&2
    errors=$((errors + 1))
  fi
}

# Array must be started (persistent storage available)
check '[ -d /mnt/user/appdata ]' "/mnt/user/appdata not available (array not started?)"

# Persistent home must exist and be writable
check '[ -d /mnt/user/appdata/home ]' "/mnt/user/appdata/home does not exist"
check '[ -w /mnt/user/appdata/home ]' "/mnt/user/appdata/home is not writable"

# Key symlinks must be in place in /root (dotfiles_setup must have run)
# These are what make the persistent files accessible at runtime paths
for name in .local .config .cache; do
  check "[ -L /root/$name ]" "/root/$name is not a symlink (run dotfiles_setup)"
done

if [ "$errors" -gt 0 ]; then
  echo "" >&2
  echo "Aborting chezmoi apply. Run dotfiles_setup first, or check that the array is started." >&2
  exit 1
fi
