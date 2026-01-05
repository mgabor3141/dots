#!/usr/bin/env bash
set -Eeuo pipefail

gio trash --empty

nix store gc --extra-experimental-features nix-command

if [ "$EUID" -ne 0 ]; then
  echo "Elevating privileges with sudo..."
  exec sudo "$0" "$@"
fi

paru -Scc --noconfirm

pacman -Scc --noconfirm
