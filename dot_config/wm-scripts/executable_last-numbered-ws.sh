#!/usr/bin/env bash
# Focus or move to the most recently used numbered workspace (excluding current).
#
# Usage:
#   last-numbered-ws.sh switch   - focus the MRU numbered workspace
#   last-numbered-ws.sh move     - move focused window there

trap 'echo "Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/wm-backend.sh"

current=$(wm_focused_workspace)
target=$(wm_mru_numbered_workspace "$current")

# Fallback: first numbered workspace that isn't current
if [[ -z "$target" ]]; then
    for ws in $NUMBERED_WORKSPACES; do
        if [[ "$ws" != "$current" ]]; then
            target="$ws"
            break
        fi
    done
fi

[[ -z "$target" ]] && exit 0

case "${1:-switch}" in
    switch) wm_switch_workspace "$target" ;;
    move)   wm_move_focused_window "$target" ;;
esac
