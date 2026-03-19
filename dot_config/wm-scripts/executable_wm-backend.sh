#!/usr/bin/env bash
# WM abstraction layer — provides common interface for workspace/window
# management scripts. Currently niri-only (aerospace support removed).
#
# Usage: source this file, then call wm_* functions.

STATE_FILE="$HOME/.config/wm-scripts/editor-workspaces.json"
NUMBERED_WORKSPACES="e1 e2 e3 e4 e5"

[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

wm_focused_workspace() {
    niri msg -j workspaces | jq -r '.[] | select(.is_focused) | .name // (.idx | tostring)'
}

wm_switch_workspace() {
    niri msg action focus-workspace "$1"
}

wm_move_focused_window() {
    niri msg action move-window-to-workspace "$1"
}

wm_mru_numbered_workspace() {
    # Returns the most recently focused numbered workspace (excluding $1),
    # derived from window focus_timestamps.
    local current="$1"

    niri msg -j windows | jq -r --argjson ws "$(niri msg -j workspaces)" --arg current "$current" '
        ($ws | map({(.id | tostring): .name}) | add) as $wsnames |
        map({ws: $wsnames[.workspace_id | tostring], ts: .focus_timestamp.secs}) |
        map(select(.ws != null and (.ws | test("^e[1-5]$")))) |
        map(select(.ws != $current)) |
        group_by(.ws) |
        map({ws: .[0].ws, ts: (map(.ts) | max)}) |
        sort_by(-.ts) |
        .[0].ws // empty
    '
}
