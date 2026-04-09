#!/bin/bash
# Preflight: verify Unraid environment is ready for chezmoi apply.
# Exits non-zero to abort if persistent storage or symlinks aren't set up.
set -euo pipefail

fail=0
err() { echo "FAIL: $1" >&2; fail=1; }

[ -d /mnt/user/appdata/home ] || err "persistent home not available (array not started?)"

for name in .local .config .cache; do
  [ -L "/root/$name" ] || err "/root/$name is not a symlink (run dotfiles_setup)"
done

if [ "$fail" -ne 0 ]; then
  echo "Aborting. Run dotfiles_setup first, or check that the array is started." >&2
  exit 1
fi
