#!/bin/bash
# Keep the hicolor icon-theme cache in sync with icon files managed by chezmoi.
# Without this, launchers that read ~/.local/share/icons/hicolor/icon-theme.cache
# will not see newly applied icons until the cache happens to be rebuilt by
# something else.
#
# -t (without -f) makes this a no-op unless the cache is genuinely stale, and
# still creates it when missing, so it is cheap enough to run on every apply.
# Do NOT add -f: it forces a rewrite every time, defeating -t.
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

command -v gtk-update-icon-cache >/dev/null || exit 0

for theme in hicolor; do
    dir="$HOME/.local/share/icons/$theme"
    [ -d "$dir" ] || continue
    gtk-update-icon-cache -q -t "$dir"
done
