#!/usr/bin/env bash
# WM abstraction layer — auto-detects niri or aerospace and provides
# a common interface for workspace/window management scripts.
#
# Usage: source this file, then call wm_* functions.
#
# Workspace references:
#   - Aerospace: workspace names (e.g. "51", "62")
#   - Niri: workspace names — static ("A","Q","W","T") or dynamic ("1-dots","2-go60")

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/editor-workspaces.json"
MRU_FILE="/tmp/wm-numbered-mru"  # Only used by aerospace backend

[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

# ── WM Detection ──

if niri msg version &>/dev/null; then
    _WM=niri
elif command -v aerospace &>/dev/null; then
    _WM=aerospace
else
    echo "No supported WM detected" >&2
    exit 1
fi

# ── Niri backend ──

_niri_list_editor_windows() {
    # Returns: id|title|workspace_name per line
    niri msg -j windows | jq -r --argjson ws "$(niri msg -j workspaces)" '
        ($ws | map({(.id | tostring): .name}) | add) as $wsnames |
        .[] | select(.app_id == "dev.zed.Zed") |
        "\(.id)|\(.title)|\($wsnames[.workspace_id | tostring] // "")"
    '
}

_niri_list_occupied_workspaces() {
    niri msg -j windows | jq -r --argjson ws "$(niri msg -j workspaces)" '
        ($ws | map({(.id | tostring): .name}) | add) as $wsnames |
        .[].workspace_id | tostring | $wsnames[.] // empty
    ' | sort -u
}

_niri_move_window() {
    local wid="$1" target="$2" focus="${3:---focus false}"
    if [ "$focus" = "--focus" ]; then
        niri msg action move-window-to-workspace --window-id "$wid" --focus true "$target"
    else
        niri msg action move-window-to-workspace --window-id "$wid" --focus false "$target"
    fi
}

_niri_focused_window() {
    niri msg -j focused-window | jq -r '"\(.app_id)|\(.title)"'
}

_niri_focused_workspace() {
    niri msg -j workspaces | jq -r '.[] | select(.is_focused) | .name // (.idx | tostring)'
}

_niri_switch_workspace() {
    niri msg action focus-workspace "$1"
}

_niri_move_focused_window() {
    niri msg action move-window-to-workspace "$1"
}

_niri_post_move_hook() {
    : # no-op on niri
}

_niri_mru_numbered_workspace() {
    # Returns the name of the most recently focused dynamic workspace (excluding $1).
    # Dynamic workspaces match "N-*" pattern. Derived from focus_timestamps.
    local current="$1"

    niri msg -j windows | jq -r --argjson ws "$(niri msg -j workspaces)" --arg current "$current" '
        ($ws | map({(.id | tostring): .name}) | add) as $wsnames |
        map({ws: $wsnames[.workspace_id | tostring], ts: .focus_timestamp.secs}) |
        map(select(.ws != null and (.ws | test("^[0-9]+-")))) |
        map(select(.ws != $current)) |
        group_by(.ws) |
        map({ws: .[0].ws, ts: (map(.ts) | max)}) |
        sort_by(-.ts) |
        .[0].ws // empty
    '
}

# ── Aerospace backend ──

_aerospace_list_editor_windows() {
    aerospace list-windows --monitor all --app-bundle-id dev.zed.Zed --format '%{window-id}|%{window-title}|%{workspace}'
}

_aerospace_list_occupied_workspaces() {
    aerospace list-workspaces --monitor all --empty no
}

_aerospace_move_window() {
    local wid="$1" target="$2" focus="$3"
    if [ "$focus" = "--focus" ]; then
        aerospace move-node-to-workspace --window-id "$wid" "$target" --focus-follows-window
    else
        aerospace move-node-to-workspace --window-id "$wid" "$target"
    fi
}

_aerospace_focused_window() {
    aerospace list-windows --focused --format '%{app-bundle-id}|%{window-title}'
}

_aerospace_focused_workspace() {
    aerospace list-workspaces --focused
}

_aerospace_switch_workspace() {
    aerospace workspace "$1"
}

_aerospace_move_focused_window() {
    aerospace move-node-to-workspace --focus-follows-window "$1"
}

_aerospace_post_move_hook() {
    sketchybar --trigger aerospace_node_moved 2>/dev/null
}

_aerospace_mru_numbered_workspace() {
    local current="$1"
    if [[ -f "$MRU_FILE" ]]; then
        while IFS= read -r ws; do
            if [[ "$ws" != "$current" ]]; then
                echo "$ws"
                return
            fi
        done < "$MRU_FILE"
    fi
}

# ── Dispatch to detected WM ──

wm_list_editor_windows()      { "_${_WM}_list_editor_windows" "$@"; }
wm_list_occupied_workspaces() { "_${_WM}_list_occupied_workspaces" "$@"; }
wm_move_window()              { "_${_WM}_move_window" "$@"; }
wm_focused_window()           { "_${_WM}_focused_window" "$@"; }
wm_focused_workspace()        { "_${_WM}_focused_workspace" "$@"; }
wm_switch_workspace()         { "_${_WM}_switch_workspace" "$@"; }
wm_move_focused_window()      { "_${_WM}_move_focused_window" "$@"; }
wm_post_move_hook()           { "_${_WM}_post_move_hook" "$@"; }
wm_mru_numbered_workspace()   { "_${_WM}_mru_numbered_workspace" "$@"; }
