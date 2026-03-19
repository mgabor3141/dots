#!/usr/bin/env bash
# Niri event-stream daemon — auto-places Zed editor windows on numbered workspaces.
#
# Remembers which project was on which workspace (1–5) in a state file.
# When a Zed window opens, moves it to its remembered workspace (or first free one).
# When a Zed window is manually moved, updates the state file.
#
# Started via spawn-at-startup in niri config.kdl. Log at /tmp/niri-event-daemon.log.

trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

STATE_FILE="$HOME/.config/wm-scripts/editor-workspaces.json"
LOG="/tmp/niri-event-daemon.log"
NUMBERED_WORKSPACES="e1 e2 e3 e4 e5"

[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

log() { echo "$(date +%H:%M:%S.%3N) $*" >> "$LOG"; }

# Wait for niri IPC
for _ in $(seq 1 30); do niri msg version &>/dev/null && break; sleep 0.5; done

# ── Tracking ──
declare -A SEEN        # wid → 1
declare -A PENDING     # wid → 1 (windows with "empty project" title)
declare -A WIN_WS      # wid → workspace_id
declare -A WIN_PROJECT # wid → project name
for _arr in SEEN PENDING WIN_WS WIN_PROJECT; do
    declare -n _ref="$_arr"; _ref[_]=1; unset "_ref[_]"
done; unset _arr _ref

# ── Helpers ──

extract_project() {
    local title="$1" project="${1%% — *}"
    [[ "$project" == "Zed" || "$project" == "empty project" || -z "$project" ]] && return 1
    echo "$project"
}

ws_name_of_id() {
    niri msg -j workspaces | jq -r --argjson id "$1" '.[] | select(.id == $id) | .name // empty'
}

ws_id_of_window() {
    niri msg -j windows | jq --argjson wid "$1" '.[] | select(.id == $wid) | .workspace_id'
}

is_numbered() {
    case " $NUMBERED_WORKSPACES " in *" $1 "*) return 0 ;; esac
    return 1
}

state_get() {
    local val
    val=$(jq -r --arg p "$1" '.[$p] // empty' "$STATE_FILE")
    # Validate: must be a known numbered workspace (ignores stale/out-of-range values)
    is_numbered "$val" && echo "$val"
}

state_set() {
    jq --arg p "$1" --arg ws "$2" '.[$p] = $ws' "$STATE_FILE" > "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
}

used_workspaces() { jq -r '.[] | tostring' "$STATE_FILE" | sort -u; }

first_free_ws() {
    local used
    used=$(used_workspaces)
    for ws in $NUMBERED_WORKSPACES; do
        echo "$used" | grep -qx "$ws" || { echo "$ws"; return; }
    done
    echo "5"  # fallback to last
}

# ── Handlers ──

handle_new_window() {
    local wid="$1" title="$2" workspace_id="$3"

    local project
    if ! project=$(extract_project "$title"); then
        PENDING[$wid]=1
        log "pending wid=$wid title='$title'"
        return
    fi
    unset "PENDING[$wid]"

    SEEN[$wid]=1
    WIN_PROJECT[$wid]="$project"

    local target
    target=$(state_get "$project")
    if [ -z "$target" ]; then
        target=$(first_free_ws)
        state_set "$project" "$target"
        log "new: $project → ws $target (auto)"
    else
        log "new: $project → ws $target (saved)"
    fi

    # Move window if not already on the target workspace
    local current_ws
    current_ws=$(ws_name_of_id "$workspace_id")
    if [ "$current_ws" != "$target" ]; then
        niri msg action move-window-to-workspace --window-id "$wid" "$target" 2>/dev/null || true
        log "moved wid=$wid to ws $target"
    fi

    WIN_WS[$wid]=$(ws_id_of_window "$wid")
}

handle_workspace_change() {
    local wid="$1" new_ws_id="$2"
    local project="${WIN_PROJECT[$wid]:-}"
    [ -z "$project" ] && return

    WIN_WS[$wid]="$new_ws_id"

    local new_ws_name
    new_ws_name=$(ws_name_of_id "$new_ws_id")

    if is_numbered "$new_ws_name"; then
        state_set "$project" "$new_ws_name"
        log "moved: $project → ws $new_ws_name"
    fi
}

handle_window_closed() {
    local wid="$1"
    log "closed: wid=$wid project=${WIN_PROJECT[$wid]:-}"
    unset "SEEN[$wid]" "WIN_WS[$wid]" "WIN_PROJECT[$wid]"
}

# ── Startup: register existing Zed windows ──

log "=== daemon starting ==="
while IFS='|' read -r wid title ws_id; do
    [ -z "$wid" ] && continue
    local_project=$(extract_project "$title" 2>/dev/null) || continue
    SEEN[$wid]=1
    WIN_WS[$wid]="$ws_id"
    WIN_PROJECT[$wid]="$local_project"
    log "startup: wid=$wid project=$local_project"
done < <(niri msg -j windows | jq -r '.[] | select(.app_id == "dev.zed.Zed") | "\(.id)|\(.title)|\(.workspace_id)"')

echo -n "" > "$LOG"

# ── Main Loop ──

while IFS= read -r line; do
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
            elif [ "$workspace_id" != "${WIN_WS[$wid]:-}" ]; then
                handle_workspace_change "$wid" "$workspace_id"
            fi
            ;;

        WindowsChanged)
            if [ "${#PENDING[@]}" -gt 0 ]; then
                for pending_wid in "${!PENDING[@]}"; do
                    new_title=$(niri msg -j windows | jq -r --argjson wid "$pending_wid" '
                        .[] | select(.id == $wid) | .title // empty
                    ')
                    [ -z "$new_title" ] && continue
                    if extract_project "$new_title" &>/dev/null; then
                        new_ws_id=$(niri msg -j windows | jq --argjson wid "$pending_wid" '
                            .[] | select(.id == $wid) | .workspace_id
                        ')
                        log "resolved pending wid=$pending_wid: '$new_title'"
                        handle_new_window "$pending_wid" "$new_title" "$new_ws_id"
                    fi
                done
            fi
            ;;

        WindowClosed)
            wid=$(echo "$line" | jq -r '.WindowClosed.id')
            [ -n "${SEEN[$wid]:-}" ] && handle_window_closed "$wid"
            unset "PENDING[$wid]"
            ;;
    esac
done < <(niri msg -j event-stream)
