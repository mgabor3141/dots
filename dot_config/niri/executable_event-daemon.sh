#!/usr/bin/env bash
# Niri event-stream daemon — watches for Zed editor windows and assigns
# them to numbered workspaces based on project→workspace mappings in
# editor-workspaces.json.
#
# Renames numbered workspaces to Zed project labels (shortest unique prefix)
# so the workspace bar shows project names instead of generic 1e–5e.
#
# Also works around a Zed rendering bug where the window content is frozen
# until resized, by nudging each new Zed window 1px down and back.
#
# Started via spawn-sh-at-startup in niri config.kdl.

LOGFILE="/tmp/niri-event-daemon.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] $*" >> "$LOGFILE"; }

WM_SCRIPTS="$HOME/.config/wm-scripts"
source "$WM_SCRIPTS/workspaces.conf"

# Wait for niri IPC to be ready
for _ in $(seq 1 30); do
    niri msg version &>/dev/null && break
    sleep 0.5
done

log "Daemon started. NUMBERED_WORKSPACES=$NUMBERED_WORKSPACES"

# Track which Zed windows we've already resize-nudged (once per window)
declare -A NUDGED

# Build index→default-name mapping for numbered workspaces
declare -A IDX_TO_DEFAULT
read -ra _nums <<< "$NUMBERED_WORKSPACES"
read -ra _defaults <<< "$NUMBERED_WS_DEFAULTS"
for _i in "${!_nums[@]}"; do
    IDX_TO_DEFAULT[${_nums[$_i]}]=${_defaults[$_i]}
done
unset _nums _defaults _i

nudge_zed_window() {
    local wid="$1"
    log "NUDGE wid=$wid starting (sleep 0.3)"
    sleep 0.3
    log "NUDGE wid=$wid resizing"
    niri msg action set-window-height --id "$wid" -- -1 2>> "$LOGFILE"
    sleep 0.1
    niri msg action set-window-height --id "$wid" -- +1 2>> "$LOGFILE"
    log "NUDGE wid=$wid done"
}

# Compute shortest unique prefix for a project name among all current Zed projects.
compute_project_label() {
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
            if [ "$other" != "$project" ]; then
                if [ "$other" = "$candidate" ] || [[ "$other" == "$candidate-"* ]]; then
                    is_unique=false
                    break
                fi
            fi
        done

        if [ "$is_unique" = true ]; then
            break
        fi
    done

    echo "$candidate"
}

# Refresh all numbered workspace names based on current Zed windows.
# Workspaces with Zed → project label, without → default name (1e–5e).
refresh_workspace_names() {
    local windows workspaces
    windows=$(niri msg -j windows)
    workspaces=$(niri msg -j workspaces)

    # Collect all Zed project names and which index they're on
    local -a all_projects=()
    local -A idx_to_project=()

    while IFS='|' read -r _wid _title ws_idx; do
        [ -z "$_wid" ] && continue
        local project="${_title%% — *}"
        [ "$project" = "Zed" ] || [ "$project" = "empty project" ] && continue
        all_projects+=("$project")
        idx_to_project[$ws_idx]="$project"
    done < <(echo "$windows" | jq -r --argjson ws "$workspaces" '
        ($ws | map({(.id | tostring): (.idx | tostring)}) | add) as $wsidx |
        .[] | select(.app_id == "dev.zed.Zed") |
        "\(.id)|\(.title)|\($wsidx[.workspace_id | tostring] // "")"
    ')

    log "REFRESH projects=[${all_projects[*]}] idx_map=[$(for k in "${!idx_to_project[@]}"; do echo -n "$k=${idx_to_project[$k]} "; done)]"

    # Update each numbered workspace
    for idx in "${!IDX_TO_DEFAULT[@]}"; do
        local default_name="${IDX_TO_DEFAULT[$idx]}"
        local current_name
        current_name=$(echo "$workspaces" | jq -r --argjson idx "$idx" '.[] | select(.idx == $idx) | .name // empty')

        if [ -n "${idx_to_project[$idx]:-}" ]; then
            local label
            label=$(compute_project_label "${idx_to_project[$idx]}" "${all_projects[@]}")
            if [ "$current_name" != "$label" ]; then
                log "RENAME idx=$idx '$current_name' -> '$label'"
                niri msg action set-workspace-name --workspace "$idx" "$label"
            fi
        else
            if [ "$current_name" != "$default_name" ]; then
                log "RESTORE idx=$idx '$current_name' -> '$default_name'"
                niri msg action set-workspace-name --workspace "$idx" "$default_name"
            fi
        fi
    done
}

while IFS= read -r line; do
    # Fast path: extract event type without full jq parse
    event_type="${line%%\":{*}"
    event_type="${event_type#*\"}"

    case "$event_type" in
        WindowOpenedOrChanged)
            app_id=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.app_id')

            if [ "$app_id" = "dev.zed.Zed" ]; then
                wid=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.id // empty')
                title=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.title // empty')
                ws_id=$(echo "$line" | jq -r '.WindowOpenedOrChanged.window.workspace_id // empty')
                log "EVENT WindowOpenedOrChanged wid=$wid title='$title' ws_id=$ws_id"
                "$WM_SCRIPTS/assign-editor-workspace.sh"
                refresh_workspace_names
                # One-time resize nudge to fix frozen rendering
                if [ -n "$wid" ] && [[ -z "${NUDGED[$wid]:-}" ]]; then
                    NUDGED[$wid]=1
                    log "NUDGE queued wid=$wid"
                    nudge_zed_window "$wid" &
                else
                    log "NUDGE skipped wid=$wid (already=${NUDGED[$wid]:-none}, wid_empty=$([ -n "$wid" ] && echo no || echo yes))"
                fi
            fi
            ;;
        WindowsChanged)
            # Bulk window update (e.g. startup, focus change) — check if any
            # Zed windows need assignment and refresh names
            zed_info=$(echo "$line" | jq -r '.WindowsChanged.windows[] | select(.app_id == "dev.zed.Zed") | "\(.id)|\(.title)|\(.workspace_id)"')
            if [ -n "$zed_info" ]; then
                log "EVENT WindowsChanged zed_windows: $(echo "$zed_info" | tr '\n' '; ')"
                "$WM_SCRIPTS/assign-editor-workspace.sh"
                refresh_workspace_names
            fi
            ;;
        WindowClosed)
            wid=$(echo "$line" | jq -r '.WindowClosed.id // empty')
            log "EVENT WindowClosed wid=$wid"
            refresh_workspace_names
            ;;
    esac
done < <(niri msg -j event-stream)
