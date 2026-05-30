#!/usr/bin/env bash
# Tini is PID 1. This script starts gmuxd in the background (if installed) so
# it manages its own lifecycle — `gmuxd restart` doesn't take down the
# container — then exec's `sleep infinity` to keep the container alive
# regardless of gmuxd state. Tini reaps gmuxd's double-fork zombies and any
# orphaned session processes.
#
# Bootstrap (first run after `docker compose up`):
#   docker exec -it devbox bash
#   chezmoi init --apply https://github.com/<you>/dotfiles
#   devbox global install
# On the next container restart, gmuxd is on PATH and gets auto-started here.
set -euo pipefail

# First-run seed: if the bind-mounted $HOME doesn't have the image's baked
# dotfiles, copy them in. `cp -an` is no-clobber so re-running is a no-op.
# This is what restores .profile (nix on PATH), .nix-profile symlink, etc.
if [ ! -e "$HOME/.bashrc" ] && [ -d /opt/home-skel ]; then
  cp -an /opt/home-skel/. "$HOME/"
fi

if command -v gmuxd >/dev/null; then
  gmuxd start || true
fi

exec sleep infinity
