#!/usr/bin/env bash
# Resolve the most recently used numbered workspace (excluding current) and
# either switch to it or move the focused window there.
#
# Usage:
#   last-numbered-ws.sh switch   - focus the MRU numbered workspace
#   last-numbered-ws.sh move     - move focused window there

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspaces.conf"
source "$SCRIPT_DIR/wm-backend.sh"

current=$(wm_focused_workspace)
target=$(wm_mru_numbered_workspace "$current")

# Fallback: pick the first dynamic workspace that isn't current
if [[ -z "$target" ]]; then
    if [[ "$_WM" == "niri" ]]; then
        target=$(niri msg -j workspaces | jq -r --arg current "$current" '
            [.[] | select(.output == "DP-1" and (.name // "" | test("^[0-9]+-")) and .name != $current)]
            | sort_by(.name) | .[0].name // empty
        ')
    else
        for ws in $NUMBERED_WORKSPACES; do
            if [[ "$ws" != "$current" ]]; then
                target="$ws"
                break
            fi
        done
    fi
fi

[[ -z "$target" ]] && exit 0

case "${1:-switch}" in
    switch)
        wm_switch_workspace "$target"
        ;;
    move)
        wm_move_focused_window "$target"
        # On niri, the event daemon detects workspace changes and updates state.
        # On aerospace, we need to update explicitly.
        if [[ "$_WM" == "aerospace" ]]; then
            "$SCRIPT_DIR/update-editor-mapping.sh" "$target"
        fi
        wm_post_move_hook
        ;;
esac
