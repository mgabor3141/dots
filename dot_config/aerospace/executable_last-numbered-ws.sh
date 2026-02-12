#!/usr/bin/env bash
# Resolve the most recently used numbered workspace (excluding current) and
# either switch to it or move the focused window there.
#
# Usage:
#   last-numbered-ws.sh switch   - focus the MRU numbered workspace
#   last-numbered-ws.sh move     - move focused window there (+ update editor mapping)

source ~/.config/aerospace/workspaces.conf

current=$(aerospace list-workspaces --focused)
mru=/tmp/aerospace-numbered-mru
target=""

# Find the most recent numbered workspace that isn't the current one
if [[ -f "$mru" ]]; then
  while IFS= read -r ws; do
    if [[ "$ws" != "$current" ]]; then
      target="$ws"
      break
    fi
  done < "$mru"
fi

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
    aerospace workspace "$target"
    ;;
  move)
    aerospace move-node-to-workspace --focus-follows-window "$target"
    ~/.config/aerospace/update-editor-mapping.sh "$target"
    sketchybar --trigger aerospace_node_moved
    ;;
esac
