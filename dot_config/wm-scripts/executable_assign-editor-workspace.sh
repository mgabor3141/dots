#!/usr/bin/env bash
# Assign Zed editor windows to numbered workspaces.
#
# Two-pass approach:
#   Pass 1: Assign windows that have explicit state-file mappings.
#   Pass 2: Assign remaining windows to empty numbered workspaces.
# Windows already on their correct workspace aren't moved.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/workspaces.conf"
source "$SCRIPT_DIR/wm-backend.sh"

LOGFILE="/tmp/niri-event-daemon.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] ASSIGN: $*" >> "$LOGFILE"; }

ALL_ZED=$(wm_list_editor_windows)
if [ -z "$ALL_ZED" ]; then
    log "No Zed windows found"
    exit 0
fi

log "--- assign start ---"

# Parse all Zed windows into arrays
declare -a WIDS PROJECTS CURRENT_WSS
declare -A PROJECT_OF  # wid -> project

i=0
while IFS='|' read -r wid title ws; do
    project=$(echo "$title" | sed 's/ — .*//')
    # Skip settings and empty windows
    if [ "$project" = "Zed" ] || [ "$project" = "empty project" ]; then
        log "  wid=$wid SKIP project='$project'"
        continue
    fi
    WIDS+=("$wid")
    PROJECTS+=("$project")
    CURRENT_WSS+=("$ws")
    PROJECT_OF[$wid]="$project"
    log "  wid=$wid project='$project' current_ws=$ws"
    i=$((i + 1))
done <<< "$ALL_ZED"

[ ${#WIDS[@]} -eq 0 ] && { log "No valid Zed projects"; exit 0; }

log "STATE_FILE: $(cat "$STATE_FILE")"

# Track which workspaces are taken (by index/ref)
declare -A TAKEN      # ws -> wid (which window owns this workspace)
declare -A TARGET_OF  # wid -> target ws
MOVES=()

# Pass 1: State-mapped windows get priority
for idx in "${!WIDS[@]}"; do
    wid="${WIDS[$idx]}"
    project="${PROJECTS[$idx]}"

    target=""
    for key in $(jq -r 'keys[]' "$STATE_FILE"); do
        if [ "$project" = "$key" ] || \
           [[ "$project" == "$key-"* ]] || \
           [[ "$key" == "$PROJECT-"* ]]; then
            target=$(jq -r --arg k "$key" '.[$k]' "$STATE_FILE")
            break
        fi
    done

    if [ -n "$target" ]; then
        log "  PASS1 wid=$wid project='$project' state_target=$target current=${CURRENT_WSS[$idx]}"
        TARGET_OF[$wid]="$target"
        TAKEN[$target]="$wid"
        if [ "${CURRENT_WSS[$idx]}" != "$target" ]; then
            MOVES+=("$wid|$target")
        fi
    fi
done

# Pass 2: Unmapped windows — find an empty numbered workspace for each
for idx in "${!WIDS[@]}"; do
    wid="${WIDS[$idx]}"
    project="${PROJECTS[$idx]}"
    current="${CURRENT_WSS[$idx]}"

    # Already handled in pass 1
    [ -n "${TARGET_OF[$wid]:-}" ] && continue

    # Find first numbered workspace not taken
    target=""
    for ws in $NUMBERED_WORKSPACES; do
        if [ -z "${TAKEN[$ws]:-}" ]; then
            target="$ws"
            break
        fi
    done

    # Fallback: last numbered workspace
    if [ -z "$target" ]; then
        # shellcheck disable=SC2086
        target=$(echo $NUMBERED_WORKSPACES | awk '{print $NF}')
    fi

    log "  PASS2 wid=$wid project='$project' target=$target current=$current"
    TARGET_OF[$wid]="$target"
    TAKEN[$target]="$wid"
    if [ "$current" != "$target" ]; then
        MOVES+=("$wid|$target")
    fi
done

# Execute moves, focusing the last one
TOTAL=${#MOVES[@]}
log "MOVES: $TOTAL [$(printf '%s ' "${MOVES[@]}")]"
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
log "--- assign end ---"
