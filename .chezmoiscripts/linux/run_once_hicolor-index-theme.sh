#!/usr/bin/env bash
trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Ensure the user hicolor icon theme directory has an index.theme.
# Without it, icons installed to ~/.local/share/icons/hicolor (by Steam,
# Lutris, chezmoi, etc.) may not be found by the icon theme lookup,
# particularly SVGs in the scalable/ directory.

src="/usr/share/icons/hicolor/index.theme"
dest="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/index.theme"

if [[ ! -f "$dest" && -f "$src" ]]; then
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "Copied hicolor index.theme to $dest"

  if command -v gtk-update-icon-cache > /dev/null 2>&1; then
    gtk-update-icon-cache -f "$(dirname "$dest")" 2>/dev/null || true
  fi
fi
