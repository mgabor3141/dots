#!/usr/bin/env bash
# Navigate up/down to the next non-empty workspace, skipping empty ones.
#
# Usage: skip-empty-workspace.sh up|down
#
# Designed for niri — aerospace handles this via its own navigation model.

direction="$1"  # "up" or "down"

case "$direction" in
    up|down) ;;
    *)       echo "Usage: $0 up|down" >&2; exit 1 ;;
esac

# Get current workspace info
current=$(niri msg -j workspaces | jq -r '
    .[] | select(.is_focused) | "\(.id)|\(.output)"
')
current_id="${current%%|*}"
current_output="${current#*|}"

# Find the next non-empty workspace in the given direction.
target=$(niri msg -j workspaces | jq -r \
    --arg dir "$direction" \
    --argjson cid "$current_id" \
    --arg out "$current_output" '
    [.[] | select(.output == $out)] | sort_by(.idx) |
    (map(.id) | index($cid)) as $pos |
    if $dir == "up" then
        [.[0:$pos] | reverse | .[] | select(.active_window_id != null)] | first
    else
        [.[$pos+1:] | .[] | select(.active_window_id != null)] | first
    end |
    if . then (.name // (.idx | tostring)) else empty end
')

if [ -n "$target" ]; then
    niri msg action focus-workspace "$target"
else
    # No non-empty workspace found; fall back to native action
    niri msg action "focus-workspace-${direction}"
fi
