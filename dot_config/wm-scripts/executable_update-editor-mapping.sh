#!/usr/bin/env bash
# Save a project→workspace mapping when a window is manually moved to a
# numbered workspace. Only tracks Zed editor windows.
#
# Usage: update-editor-mapping.sh <target-workspace>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspaces.conf"
source "$SCRIPT_DIR/wm-backend.sh"

TARGET_WS="$1"

# Only track numbered workspaces
if ! echo "$NUMBERED_WORKSPACES" | grep -qw "$TARGET_WS"; then
    exit 0
fi

# Get focused window info
WINDOW_INFO=$(wm_focused_window)
APP_ID=$(echo "$WINDOW_INFO" | cut -d'|' -f1)
WINDOW_TITLE=$(echo "$WINDOW_INFO" | cut -d'|' -f2-)

# Only track Zed
[ "$APP_ID" != "dev.zed.Zed" ] && exit 0

# Extract project name
PROJECT=$(echo "$WINDOW_TITLE" | sed 's/ — .*//')
[ "$PROJECT" = "Zed" ] || [ "$PROJECT" = "empty project" ] && exit 0

# Remove any existing mapping that prefix-matches this project
for key in $(jq -r 'keys[]' "$STATE_FILE"); do
    if [ "$PROJECT" = "$key" ] || \
       [[ "$PROJECT" == "$key-"* ]] || \
       [[ "$key" == "$PROJECT-"* ]]; then
        jq --arg k "$key" 'del(.[$k])' "$STATE_FILE" > "$STATE_FILE.tmp"
        mv "$STATE_FILE.tmp" "$STATE_FILE"
    fi
done

# Save new mapping
jq --arg proj "$PROJECT" --arg ws "$TARGET_WS" '.[$proj] = $ws' "$STATE_FILE" > "$STATE_FILE.tmp"
mv "$STATE_FILE.tmp" "$STATE_FILE"
