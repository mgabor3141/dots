#!/usr/bin/env bash
# Called by exec-on-workspace-change to track numbered workspace MRU in /tmp.
# If the focused workspace is numbered, move it to the top of the MRU file.

source ~/.config/aerospace/workspaces.conf

case " $NUMBERED_WORKSPACES " in
  *" $AEROSPACE_FOCUSED_WORKSPACE "*)
    mru=/tmp/aerospace-numbered-mru
    { echo "$AEROSPACE_FOCUSED_WORKSPACE"; grep -v "^$AEROSPACE_FOCUSED_WORKSPACE$" "$mru" 2>/dev/null; } > "$mru.tmp"
    mv "$mru.tmp" "$mru"
    ;;
esac
