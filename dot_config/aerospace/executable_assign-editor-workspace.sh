#!/bin/bash

source "$HOME/.config/aerospace/workspaces.conf"
STATE_FILE="$HOME/.config/aerospace/editor-workspaces.json"

# Ensure state file exists
[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

# Get all Zed windows with their current workspace
ALL_ZED=$(aerospace list-windows --monitor all --app-bundle-id dev.zed.Zed --format '%{window-id}|%{window-title}|%{workspace}')
[ -z "$ALL_ZED" ] && exit 0

# Collect windows that need moving: "window-id|target-workspace"
MOVES=()

while IFS='|' read -r WINDOW_ID WINDOW_TITLE CURRENT_WS; do
  # Extract project name (first part before " — ")
  PROJECT=$(echo "$WINDOW_TITLE" | sed 's/ — .*//')

  # Skip settings and empty windows
  [ "$PROJECT" = "Zed" ] || [ "$PROJECT" = "empty project" ] && continue

  # Check state file for a saved mapping (read-only)
  TARGET=""
  for key in $(jq -r 'keys[]' "$STATE_FILE"); do
    if [ "$PROJECT" = "$key" ] || \
       [[ "$PROJECT" == "$key-"* ]] || \
       [[ "$key" == "$PROJECT-"* ]]; then
      TARGET=$(jq -r --arg k "$key" '.[$k]' "$STATE_FILE")
      break
    fi
  done

  # No saved mapping — find first empty numbered workspace
  if [ -z "$TARGET" ]; then
    OCCUPIED=$(aerospace list-workspaces --monitor all --empty no)
    TARGET="95"  # Default fallback

    for ws in $NUMBERED_WORKSPACES; do
      if ! echo "$OCCUPIED" | grep -q "^${ws}$"; then
        TARGET="$ws"
        break
      fi
    done
  fi

  # Queue move if window is not already on the correct workspace
  [ "$CURRENT_WS" != "$TARGET" ] && MOVES+=("$WINDOW_ID|$TARGET")

done <<< "$ALL_ZED"

# Move windows, with focus-follows-window on the last one
TOTAL=${#MOVES[@]}
for i in "${!MOVES[@]}"; do
  WINDOW_ID=$(echo "${MOVES[$i]}" | cut -d'|' -f1)
  TARGET=$(echo "${MOVES[$i]}" | cut -d'|' -f2)

  if [ $((i + 1)) -eq "$TOTAL" ]; then
    aerospace move-node-to-workspace --window-id "$WINDOW_ID" "$TARGET" --focus-follows-window
  else
    aerospace move-node-to-workspace --window-id "$WINDOW_ID" "$TARGET"
  fi

  sketchybar --trigger aerospace_node_moved TARGET_WORKSPACE="$TARGET"
done
