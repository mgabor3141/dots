#!/usr/bin/env bash
# Focus or move to a dynamic numbered workspace by slot prefix.
# Usage: numbered-ws.sh focus N    — focus workspace matching "N-*"
#        numbered-ws.sh move  N    — move focused column to workspace "N-*"
#
# If no workspace with that prefix exists, the command is silently ignored.

ACTION="$1"  # "focus" or "move"
SLOT="$2"    # 1-5

# Find workspace name matching this slot
WS_NAME=$(niri msg -j workspaces | jq -r --arg slot "$SLOT" '
    .[] | select(.output == "DP-1" and (.name // "" | startswith($slot + "-"))) | .name
' | head -1)

if [ -z "$WS_NAME" ]; then
    # No workspace for this slot — nothing to do
    exit 0
fi

case "$ACTION" in
    focus)
        niri msg action focus-workspace "$WS_NAME"
        ;;
    move)
        niri msg action move-column-to-workspace "$WS_NAME"
        ;;
esac
