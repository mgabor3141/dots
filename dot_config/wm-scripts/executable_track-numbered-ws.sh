#!/usr/bin/env bash
# Track numbered workspace MRU in a file. Called with the focused workspace
# name as $1. If it's a numbered workspace, push it to the top of the MRU file.
#
# Only needed on aerospace (called from exec-on-workspace-change).
# On niri, MRU is derived from window focus_timestamps instead.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspaces.conf"
source "$SCRIPT_DIR/wm-backend.sh"

WS="${1:-}"
[ -z "$WS" ] && exit 0

case " $NUMBERED_WORKSPACES " in
    *" $WS "*)
        { echo "$WS"; grep -v "^${WS}$" "$MRU_FILE" 2>/dev/null; } > "$MRU_FILE.tmp"
        mv "$MRU_FILE.tmp" "$MRU_FILE"
        ;;
esac
