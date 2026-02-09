#!/bin/bash
# Usage: update-editor-mapping.sh <target-workspace>

TARGET_WS="$1"
STATE_FILE="$HOME/.config/aerospace/editor-workspaces.json"

# Only track numbered workspaces - must match aerospace.toml and sketchybar spaces.sh
case "$TARGET_WS" in
  51|62|73|84|95) ;;
  *) exit 0 ;;
esac

# Get focused window info
WINDOW_INFO=$(aerospace list-windows --focused --format '%{app-bundle-id}|%{window-title}')
APP_ID=$(echo "$WINDOW_INFO" | cut -d'|' -f1)
WINDOW_TITLE=$(echo "$WINDOW_INFO" | cut -d'|' -f2-)

# Only track Zed (can add more editors later)
[ "$APP_ID" != "dev.zed.Zed" ] && exit 0

# Extract project name
PROJECT=$(echo "$WINDOW_TITLE" | sed 's/ — .*//')
[ "$PROJECT" = "Zed" ] && exit 0

# Ensure state file exists
[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

# Remove any existing mapping that prefix-matches this project
for key in $(jq -r 'keys[]' "$STATE_FILE"); do
  if [ "$PROJECT" = "$key" ] || \
     [[ "$PROJECT" == "$key-"* ]] || \
     [[ "$key" == "$PROJECT-"* ]]; then
    jq --arg k "$key" 'del(.[$k])' "$STATE_FILE" > "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
  fi
done

# Save new mapping with shortest prefix
jq --arg proj "$PROJECT" --arg ws "$TARGET_WS" '.[$proj] = $ws' "$STATE_FILE" > "$STATE_FILE.tmp"
mv "$STATE_FILE.tmp" "$STATE_FILE"
