#!/usr/bin/env bash
# Resolve the most recently used numbered workspace (excluding current) and
# either switch to it or move the focused window there.
#
# Usage:
#   last-numbered-ws.sh switch   - focus the MRU numbered workspace
#   last-numbered-ws.sh move     - move focused window there (+ update editor mapping)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspaces.conf"
source "$SCRIPT_DIR/wm-backend.sh"

current=$(wm_focused_workspace)
target=$(wm_mru_numbered_workspace "$current")

# Fallback: pick the first numbered workspace that isn't current
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
    switch)
        wm_switch_workspace "$target"
        ;;
    move)
        wm_move_focused_window "$target"
        "$SCRIPT_DIR/update-editor-mapping.sh" "$target"
        wm_post_move_hook
        ;;
esac
