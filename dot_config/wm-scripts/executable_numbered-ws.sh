#!/usr/bin/env bash
# Focus or move to a dynamic numbered workspace by slot prefix.
# Usage: numbered-ws.sh focus N    — focus workspace matching "N-*"
#        numbered-ws.sh move  N    — move focused column to workspace "N-*"
#                                    Creates the workspace only for Zed windows.
#
# On creation, names the workspace "N-" as a placeholder.
# The event daemon detects the move and fills in the proper label.

ACTION="$1"  # "focus" or "move"
SLOT="$2"    # 1-5

MAIN_OUTPUT="DP-1"
STATIC_WS_COUNT=3

# Find workspace name matching this slot
WS_NAME=$(niri msg -j workspaces | jq -r --arg slot "$SLOT" '
    .[] | select(.output == "DP-1" and (.name // "" | startswith($slot + "-"))) | .name
' | head -1)

case "$ACTION" in
    focus)
        [ -z "$WS_NAME" ] && exit 0
        niri msg action focus-workspace "$WS_NAME"
        ;;
    move)
        if [ -n "$WS_NAME" ]; then
            # Workspace exists — move there
            niri msg action move-column-to-workspace "$WS_NAME"
        else
            # Only create for Zed windows — others can't create new slots
            focused_app=$(niri msg -j focused-window | jq -r '.app_id // empty')
            [ "$focused_app" != "dev.zed.Zed" ] && exit 0

            # Create workspace: move to trailing empty, name it, sort it
            trailing=$(niri msg -j workspaces | jq '[.[] | select(.output == "DP-1")] | max_by(.idx) | .idx')
            niri msg action move-column-to-workspace "$trailing"
            niri msg action set-workspace-name --workspace "$trailing" "${SLOT}-"

            # Sort: move to correct position
            target_idx=$(( STATIC_WS_COUNT + SLOT ))
            niri msg action move-workspace-to-index --reference "${SLOT}-" "$target_idx"
        fi
        ;;
esac
