#!/usr/bin/env bash
# Move the focused column up/down through dynamic workspace slots.
#
# Usage: move-column-dynamic.sh up|down
#
# Behavior depends on the current workspace:
#   - On a dynamic workspace (N-*): moves to slot N±1 using slot arithmetic.
#     Creates the target workspace if it doesn't exist. The event daemon
#     handles renaming the placeholder, updating state, and cleaning up
#     the old workspace if it becomes empty.
#   - On a static workspace (A/Q/W/T): uses native niri move-column-to-workspace.
#
# Slot bounds: 1–5. Moving below slot 1 or above slot 5 is a no-op from
# dynamic workspaces.

MAIN_OUTPUT="DP-1"
STATIC_WS_COUNT=3

direction="$1"  # "up" or "down"

case "$direction" in
    up|down) ;;
    *)       echo "Usage: $0 up|down" >&2; exit 1 ;;
esac

# Get focused workspace
focused=$(niri msg -j workspaces | jq -r '
    .[] | select(.is_focused) | "\(.name // "")|\(.idx)"
')
ws_name="${focused%%|*}"

# If on a static workspace, use native move
if ! [[ "$ws_name" =~ ^[1-5]- ]]; then
    niri msg action "move-column-to-workspace-${direction}"
    exit 0
fi

# On a dynamic workspace — compute target slot
current_slot="${ws_name%%-*}"

if [ "$direction" = "down" ]; then
    target_slot=$(( current_slot + 1 ))
else
    target_slot=$(( current_slot - 1 ))
fi

# Bounds check
if (( target_slot < 1 || target_slot > 5 )); then
    exit 0
fi

# Check if target slot workspace already exists
target_ws=$(niri msg -j workspaces | jq -r --arg slot "$target_slot" '
    .[] | select(.output == "DP-1" and (.name // "" | startswith($slot + "-"))) | .name
' | head -1)

if [ -n "$target_ws" ]; then
    # Target exists — move there (merge)
    niri msg action move-column-to-workspace "$target_ws"
else
    # Target doesn't exist — create it
    # Move column to the trailing empty workspace, then name and sort it
    trailing=$(niri msg -j workspaces | jq '[.[] | select(.output == "DP-1")] | max_by(.idx) | .idx')
    niri msg action move-column-to-workspace "$trailing"

    # Name with placeholder — daemon will fill in the label
    niri msg action set-workspace-name --workspace "$trailing" "${target_slot}-"

    # Sort into correct position
    target_idx=$(( STATIC_WS_COUNT + target_slot ))
    niri msg action move-workspace-to-index --reference "${target_slot}-" "$target_idx"
fi
