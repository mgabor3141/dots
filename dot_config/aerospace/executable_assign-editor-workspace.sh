#!/bin/bash

source "$HOME/.config/aerospace/workspaces.conf"
STATE_FILE="$HOME/.config/aerospace/editor-workspaces.json"

# Ensure state file exists
[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

# Get focused window info
WINDOW_INFO=$(aerospace list-windows --focused --format '%{window-id}|%{window-title}')
WINDOW_ID=$(echo "$WINDOW_INFO" | cut -d'|' -f1)
WINDOW_TITLE=$(echo "$WINDOW_INFO" | cut -d'|' -f2-)

# Extract project name (first part before " — ")
PROJECT=$(echo "$WINDOW_TITLE" | sed 's/ — .*//')

# Skip settings window (handled as floating)
[ "$PROJECT" = "Zed" ] && exit 0

# Find matching prefix in mappings (hyphen-delimited)
TARGET=""
MATCH_KEY=""

for key in $(jq -r 'keys[]' "$STATE_FILE"); do
  # Check if either is a prefix of the other (hyphen-delimited)
  if [ "$PROJECT" = "$key" ] || \
     [[ "$PROJECT" == "$key-"* ]] || \
     [[ "$key" == "$PROJECT-"* ]]; then
    TARGET=$(jq -r --arg k "$key" '.[$k]' "$STATE_FILE")
    MATCH_KEY="$key"
    break
  fi
done

if [ -n "$TARGET" ]; then
  # If new project name is shorter, update the key
  if [ ${#PROJECT} -lt ${#MATCH_KEY} ]; then
    jq --arg old "$MATCH_KEY" --arg new "$PROJECT" --arg ws "$TARGET" \
      'del(.[$old]) | .[$new] = $ws' "$STATE_FILE" > "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
  fi
else
  # Find first empty numbered workspace
  OCCUPIED=$(aerospace list-workspaces --monitor all --empty no)
  TARGET="95"  # Default fallback

  for ws in $NUMBERED_WORKSPACES; do
    if ! echo "$OCCUPIED" | grep -q "^${ws}$"; then
      TARGET="$ws"
      break
    fi
  done

  # Save the mapping
  jq --arg proj "$PROJECT" --arg ws "$TARGET" '.[$proj] = $ws' "$STATE_FILE" > "$STATE_FILE.tmp"
  mv "$STATE_FILE.tmp" "$STATE_FILE"
fi

# Move window and follow focus
aerospace move-node-to-workspace --window-id "$WINDOW_ID" "$TARGET" --focus-follows-window

# Trigger sketchybar update
sketchybar --trigger aerospace_node_moved TARGET_WORKSPACE="$TARGET"
