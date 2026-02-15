#!/usr/bin/env bash
# Assign Zed editor windows to numbered workspaces.
#
# Scans all Zed windows and moves any that aren't on their correct workspace.
# Reads the state file for saved project→workspace mappings; never writes to it.
# Unmapped projects go to the first empty numbered workspace (fallback: last).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspaces.conf"
source "$SCRIPT_DIR/wm-backend.sh"

ALL_ZED=$(wm_list_editor_windows)
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
        OCCUPIED=$(wm_list_occupied_workspaces)
        # shellcheck disable=SC2086
        TARGET=$(echo $NUMBERED_WORKSPACES | awk '{print $NF}')  # Last numbered workspace as fallback

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

# Move windows, with focus on the last one
TOTAL=${#MOVES[@]}
for i in "${!MOVES[@]}"; do
    WINDOW_ID=$(echo "${MOVES[$i]}" | cut -d'|' -f1)
    TARGET=$(echo "${MOVES[$i]}" | cut -d'|' -f2)

    if [ $((i + 1)) -eq "$TOTAL" ]; then
        wm_move_window "$WINDOW_ID" "$TARGET" --focus
    else
        wm_move_window "$WINDOW_ID" "$TARGET"
    fi
done

[ "$TOTAL" -gt 0 ] && wm_post_move_hook
