#!/usr/bin/env bash
# Niri event-stream daemon — manages dynamic Zed editor workspaces.
#
# Assigns Zed windows to numbered workspaces, creating/destroying
# workspaces dynamically. Workspace names follow "N-label" format
# (e.g. "1-dots", "2-go60") so keybinds can target by prefix.
#
# Also nudges new Zed windows (1px resize) to work around a rendering bug.
#
# State file maps project names to slot numbers: {"chezmoi": 1, "go60": 2}
# Started manually or via spawn-sh-at-startup in niri config.kdl.

set -euo pipefail

WM_SCRIPTS="$HOME/.config/wm-scripts"
STATE_FILE="$WM_SCRIPTS/editor-workspaces.json"
LOG="/tmp/niri-event-daemon.log"
# No upper slot limit — slots are created as needed
# Number of static workspaces on DP-1 (A, Q, W) — dynamic slots start after these
STATIC_WS_COUNT=3
MAIN_OUTPUT="DP-1"

[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

log() { echo "$(date +%H:%M:%S.%3N) $*" >> "$LOG"; }

# Wait for niri IPC
for _ in $(seq 1 30); do
    niri msg version &>/dev/null && break
    sleep 0.5
done

# ── In-memory tracking ──
declare -A SEEN        # wid → 1: windows we've processed (assigned + nudged)
declare -A WIN_WS      # wid → workspace_id: last known workspace for manual-move detection
declare -A WIN_PROJECT # wid → project name: for cleanup on close

# ── Helpers ──

# Extract project name from Zed window title ("project — file" → "project")
extract_project() {
    local title="$1"
    local project="${title%% — *}"
    # Skip settings window and empty projects
    if [[ "$project" == "Zed" || "$project" == "empty project" || -z "$project" ]]; then
        return 1
    fi
    echo "$project"
}

# Compute display label for a project (shortest unique prefix, special aliases)
compute_label() {
    local project="$1"
    shift
    local -a all_projects=("$@")

    case "$project" in
        chezmoi) echo "dots"; return ;;
    esac

    IFS='-' read -ra words <<< "$project"
    local candidate=""

    for word in "${words[@]}"; do
        if [ -z "$candidate" ]; then
            candidate="$word"
        else
            candidate="$candidate-$word"
        fi

        local is_unique=true
        for other in "${all_projects[@]}"; do
            if [[ "$other" != "$project" && ("$other" == "$candidate" || "$other" == "$candidate-"*) ]]; then
                is_unique=false
                break
            fi
        done
        $is_unique && break
    done
    echo "$candidate"
}

# Get all current Zed projects (for unique-prefix computation)
get_all_projects() {
    niri msg -j windows | jq -r '.[] | select(.app_id == "dev.zed.Zed") | .title' | while read -r title; do
        extract_project "$title" 2>/dev/null || true
    done | sort -u
}

# Find workspace name matching slot prefix "N-*" on main output
find_slot_workspace() {
    local slot="$1"
    niri msg -j workspaces | jq -r --arg slot "$slot" '
        .[] | select(.output == "DP-1" and (.name // "" | startswith($slot + "-"))) | .name
    '
}

# Get the slot number from a workspace name ("2-go60" → "2")
slot_from_ws_name() {
    local name="$1"
    if [[ "$name" =~ ^([0-9]+)- ]]; then
        echo "${BASH_REMATCH[1]}"
    fi
}

# Find the trailing empty workspace index on DP-1 (always exists)
trailing_empty_idx() {
    niri msg -j workspaces | jq '[.[] | select(.output == "DP-1")] | max_by(.idx) | .idx'
}

# Get the workspace internal ID that contains a given window
ws_id_of_window() {
    local wid="$1"
    niri msg -j windows | jq --argjson wid "$wid" '.[] | select(.id == $wid) | .workspace_id'
}

# Check if a workspace (by name) has any Zed windows on it
ws_has_zed() {
    local ws_name="$1"
    local ws_id
    ws_id=$(niri msg -j workspaces | jq -r --arg name "$ws_name" '.[] | select(.name == $name) | .id')
    [ -z "$ws_id" ] && return 1
    local count
    count=$(niri msg -j windows | jq --argjson wsid "$ws_id" '[.[] | select(.app_id == "dev.zed.Zed" and .workspace_id == $wsid)] | length')
    [ "$count" -gt 0 ]
}

# Read state file: project → slot
state_get() {
    jq -r --arg p "$1" '.[$p] // empty' "$STATE_FILE"
}

# Write state file: project → slot
state_set() {
    local project="$1" slot="$2"
    local tmp="$STATE_FILE.tmp"
    jq --arg p "$project" --argjson s "$slot" '.[$p] = $s' "$STATE_FILE" > "$tmp"
    mv "$tmp" "$STATE_FILE"
}

# Get all used slot numbers from state file
used_slots() {
    jq -r '.[] | tostring' "$STATE_FILE" | sort -n
}

# Find first available slot (1, 2, 3, ...)
first_free_slot() {
    local used
    used=$(used_slots)
    local n=1
    while echo "$used" | grep -qx "$n"; do
        n=$(( n + 1 ))
    done
    echo "$n"
}

# Sort dynamic workspaces: each "N-*" goes to index STATIC_WS_COUNT + N
sort_workspaces() {
    local ws_json
    ws_json=$(niri msg -j workspaces)

    # Collect dynamic workspace names on DP-1, sorted by slot number
    local names
    names=$(echo "$ws_json" | jq -r '
        [.[] | select(.output == "DP-1" and (.name // "" | test("^[0-9]+-")))]
        | sort_by(.name | split("-")[0] | tonumber)
        | .[].name
    ')

    [ -z "$names" ] && return

    while read -r name; do
        local slot="${name%%-*}"
        local target_idx=$(( STATIC_WS_COUNT + slot ))
        niri msg action move-workspace-to-index --reference "$name" "$target_idx" 2>/dev/null || true
    done <<< "$names"
}

# Delete a workspace by name (unset name → auto-GC when empty and unfocused)
delete_workspace() {
    local ws_name="$1"
    log "delete_workspace: $ws_name"
    niri msg action unset-workspace-name "$ws_name" 2>/dev/null || true
}

# Create or reuse workspace for a slot, move window there
# Returns the workspace name
ensure_workspace_and_move() {
    local slot="$1" label="$2" wid="$3"
    local ws_name="${slot}-${label}"

    # Check if workspace already exists
    local existing
    existing=$(find_slot_workspace "$slot")

    if [ -n "$existing" ]; then
        # Workspace exists — rename if label changed
        if [ "$existing" != "$ws_name" ]; then
            niri msg action set-workspace-name --workspace "$existing" "$ws_name" 2>/dev/null || true
            log "renamed workspace $existing → $ws_name"
        fi
        # Move window there if not already on it
        local current_ws_id
        current_ws_id=$(ws_id_of_window "$wid")
        local target_ws_id
        target_ws_id=$(niri msg -j workspaces | jq -r --arg name "$ws_name" '.[] | select(.name == $name) | .id')
        if [ "$current_ws_id" != "$target_ws_id" ]; then
            niri msg action move-window-to-workspace --window-id "$wid" "$ws_name" 2>/dev/null || true
            log "moved window $wid to existing workspace $ws_name"
        fi
    else
        # Create new workspace: move window to trailing empty, then name it
        local trailing
        trailing=$(trailing_empty_idx)
        niri msg action move-window-to-workspace --window-id "$wid" "$trailing" 2>/dev/null || true
        niri msg action set-workspace-name --workspace "$trailing" "$ws_name" 2>/dev/null || true
        log "created workspace $ws_name (moved wid $wid to idx $trailing)"
    fi

    sort_workspaces
    echo "$ws_name"
}

# Nudge Zed window to fix frozen rendering (background)
nudge_zed_window() {
    local wid="$1"
    sleep 0.3
    niri msg action set-window-height --id "$wid" -- -1 2>/dev/null || true
    sleep 0.1
    niri msg action set-window-height --id "$wid" -- +1 2>/dev/null || true
    log "nudged window $wid"
}

# Refresh workspace labels using shortest-unique-prefix
refresh_labels() {
    local -a all_projects=()
    readarray -t all_projects < <(get_all_projects)
    [ ${#all_projects[@]} -eq 0 ] && return

    local ws_json
    ws_json=$(niri msg -j workspaces)

    # For each dynamic workspace, recompute label
    local names
    names=$(echo "$ws_json" | jq -r '.[] | select(.output == "DP-1" and (.name // "" | test("^[0-9]+-"))) | .name')
    [ -z "$names" ] && return

    local win_json
    win_json=$(niri msg -j windows)

    while read -r name; do
        local slot="${name%%-*}"
        local current_label="${name#*-}"

        local ws_id
        ws_id=$(echo "$ws_json" | jq -r --arg name "$name" '.[] | select(.name == $name) | .id')

        # Get all Zed project names on this workspace
        local -a ws_projects=()
        readarray -t ws_projects < <(echo "$win_json" | jq -r --argjson wsid "$ws_id" '
            [.[] | select(.app_id == "dev.zed.Zed" and .workspace_id == $wsid)] | .[].title
        ')

        # Check if current label still matches any window on the workspace
        local label_valid=false
        for title in "${ws_projects[@]}"; do
            local proj
            proj=$(extract_project "$title" 2>/dev/null) || continue
            local lbl
            lbl=$(compute_label "$proj" "${all_projects[@]}")
            if [ "$current_label" = "$lbl" ]; then
                label_valid=true
                break
            fi
        done

        if ! $label_valid; then
            # Current label is stale — pick the first valid project
            for title in "${ws_projects[@]}"; do
                local proj
                proj=$(extract_project "$title" 2>/dev/null) || continue
                local new_label
                new_label=$(compute_label "$proj" "${all_projects[@]}")
                if [ "$current_label" != "$new_label" ]; then
                    niri msg action set-workspace-name --workspace "$name" "${slot}-${new_label}" 2>/dev/null || true
                    log "relabeled ${name} → ${slot}-${new_label}"
                fi
                break
            done
        fi
    done <<< "$names"
}

# ── Event Handlers ──

handle_new_window() {
    local wid="$1" title="$2" workspace_id="$3"

    local project
    project=$(extract_project "$title") || return

    SEEN[$wid]=1
    WIN_PROJECT[$wid]="$project"
    log "new Zed window $wid: project=$project"

    # 1. Look up or assign slot
    local slot
    slot=$(state_get "$project")
    if [ -z "$slot" ]; then
        slot=$(first_free_slot)
        state_set "$project" "$slot"
        log "assigned slot $slot to $project (new)"
    fi

    # 2. Compute label
    local -a all_projects=()
    readarray -t all_projects < <(get_all_projects)
    local label
    label=$(compute_label "$project" "${all_projects[@]}")

    # 3. Ensure workspace exists and move window there
    ensure_workspace_and_move "$slot" "$label" "$wid"

    # 4. Track workspace for manual-move detection
    WIN_WS[$wid]=$(ws_id_of_window "$wid")

    # 5. Refresh all labels (adding a project may change unique prefixes)
    refresh_labels

    # 6. Nudge in background
    nudge_zed_window "$wid" &
}

handle_workspace_change() {
    local wid="$1" title="$2" new_ws_id="$3"

    local project="${WIN_PROJECT[$wid]:-}"
    [ -z "$project" ] && return

    local old_ws_id="${WIN_WS[$wid]:-}"
    WIN_WS[$wid]="$new_ws_id"

    log "workspace change: wid=$wid project=$project old_ws=$old_ws_id new_ws=$new_ws_id"

    # Find what slot the new workspace is (if it's a dynamic one)
    local new_ws_name
    new_ws_name=$(niri msg -j workspaces | jq -r --argjson wsid "$new_ws_id" '.[] | select(.id == $wsid) | .name // empty')
    local new_slot
    new_slot=$(slot_from_ws_name "$new_ws_name")

    if [ -n "$new_slot" ]; then
        # Moved to a dynamic workspace — update state
        state_set "$project" "$new_slot"
        log "updated state: $project → slot $new_slot"
    fi

    # Check if old workspace is now empty of Zed
    if [ -n "$old_ws_id" ]; then
        local old_ws_name
        old_ws_name=$(niri msg -j workspaces | jq -r --argjson wsid "$old_ws_id" '.[] | select(.id == $wsid) | .name // empty')
        local old_slot
        old_slot=$(slot_from_ws_name "$old_ws_name")
        if [ -n "$old_slot" ] && ! ws_has_zed "$old_ws_name"; then
            delete_workspace "$old_ws_name"
            log "cleaned up empty workspace $old_ws_name"
        fi
    fi

    refresh_labels
    sort_workspaces
}

handle_window_closed() {
    local wid="$1"
    local project="${WIN_PROJECT[$wid]:-}"

    unset "SEEN[$wid]"
    unset "WIN_WS[$wid]"
    unset "WIN_PROJECT[$wid]"

    log "window closed: wid=$wid project=$project"

    # Check all dynamic workspaces — delete any that lost all Zed windows
    local ws_json
    ws_json=$(niri msg -j workspaces)
    local names
    names=$(echo "$ws_json" | jq -r '.[] | select(.output == "DP-1" and (.name // "" | test("^[0-9]+-"))) | .name')
    [ -z "$names" ] && return

    while read -r name; do
        if ! ws_has_zed "$name"; then
            delete_workspace "$name"
            log "cleaned up workspace $name after close"
        fi
    done <<< "$names"

    refresh_labels
    sort_workspaces
}

# ── Main Loop ──

log "=== daemon starting ==="
# ── Startup: populate SEEN from existing Zed windows ──
# This prevents the daemon from re-assigning windows that were already
# placed before the daemon (re)started.
while IFS='|' read -r wid title ws_id; do
    [ -z "$wid" ] && continue
    local_project=$(extract_project "$title" 2>/dev/null) || continue
    SEEN[$wid]=1
    WIN_WS[$wid]="$ws_id"
    WIN_PROJECT[$wid]="$local_project"
    log "startup: registered existing wid=$wid project=$local_project ws=$ws_id"
done < <(niri msg -j windows | jq -r '.[] | select(.app_id == "dev.zed.Zed") | "\(.id)|\(.title)|\(.workspace_id)"')

echo -n "" > "$LOG"  # truncate log

while IFS= read -r line; do
    # Fast-path: extract event type without full jq parse
    event_type="${line%%\":{*}"
    event_type="${event_type#*\"}"

    case "$event_type" in
        WindowOpenedOrChanged)
            app_id=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.app_id')
            [ "$app_id" != "dev.zed.Zed" ] && continue

            wid=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.id')
            title=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.title')
            workspace_id=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.workspace_id')

            if [ -z "${SEEN[$wid]:-}" ]; then
                handle_new_window "$wid" "$title" "$workspace_id"
            else
                # Already seen — check for workspace change (manual move)
                if [ "$workspace_id" != "${WIN_WS[$wid]:-}" ]; then
                    handle_workspace_change "$wid" "$title" "$workspace_id"
                fi
                # Title-only changes: ignore (project name doesn't change)
            fi
            ;;

        WindowClosed)
            wid=$(echo "$line" | jq -r '.WindowClosed.id')
            [ -n "${SEEN[$wid]:-}" ] && handle_window_closed "$wid"
            ;;
    esac
done < <(niri msg -j event-stream)
